/**
 * Gathers everything a report needs about one joiner, within a deadline.
 *
 * All of it comes through `ctx.vrchat`, which reads VRCNext's data without touching its dialogs:
 * the profile (age verification, friend state), the avatar the player wears and its ranks, the
 * groups they show, and VRCNext's own timeline for the rejoin check. The lookups run in
 * parallel and each one degrades to "unknown" on its own rather than holding up the report.
 */

import type { PerformanceRank, VrcInstance, VrchatApi } from '@vrcnext/plugin-api';

import { rejoinIn, UNKNOWN_REJOIN, type Rejoin } from './history.js';

export interface Joiner {
  readonly name: string;
  /** Empty for accounts VRChat still logs with a legacy id. */
  readonly userId: string;
}

export interface Facts {
  readonly ageVerified: boolean | undefined;
  /** `18+`, `verified`, `hidden` or `''`. */
  readonly ageVerificationStatus: string;
  readonly isFriend: boolean | undefined;
  readonly platform: string;
  readonly avatarId: string;
  readonly avatarName: string;
  readonly avatarImageUrl: string;
  readonly pcRank: PerformanceRank;
  readonly questRank: PerformanceRank;
  /** Groups the player shows publicly; `undefined` when VRCNext did not answer. */
  readonly groupIds: readonly string[] | undefined;
  readonly rejoin: Rejoin;
}

export const UNKNOWN_FACTS: Facts = {
  ageVerified: undefined,
  ageVerificationStatus: '',
  isFriend: undefined,
  platform: '',
  avatarId: '',
  avatarName: '',
  avatarImageUrl: '',
  pcRank: '',
  questRank: '',
  groupIds: undefined,
  rejoin: UNKNOWN_REJOIN,
};

export interface CollectOptions {
  readonly deadlineMs: number;
  readonly signal: AbortSignal;
  /** Which groups matter; membership is only looked up when one is set. */
  readonly wantsGroups: boolean;
}

async function avatarFacts(vrchat: VrchatApi, joiner: Joiner, instance: VrcInstance | undefined, signal: AbortSignal): Promise<Pick<Facts, 'avatarId' | 'avatarName' | 'avatarImageUrl' | 'pcRank' | 'questRank'>> {
  const known = instance?.users.find((u) => u.id === joiner.userId);
  let avatarId = known?.avatarId ?? '';
  let avatarName = known?.avatarName ?? '';
  if (avatarId === '') {
    const found = await vrchat.instanceAvatar(joiner.userId, { signal });
    avatarId = found?.avatarId ?? '';
    avatarName = found?.avatarName ?? avatarName;
  }
  if (avatarId === '') return { avatarId: '', avatarName, avatarImageUrl: '', pcRank: '', questRank: '' };
  const avatar = await vrchat.avatar(avatarId, { signal });
  return {
    avatarId,
    avatarName: avatar?.name ?? avatarName,
    avatarImageUrl: avatar?.thumbnailImageUrl ?? '',
    pcRank: avatar?.pcRank ?? '',
    questRank: avatar?.questRank ?? '',
  };
}

/**
 * Just the avatar, for a player already here who changed into a new one. Nothing else is
 * re-read: their age status and memberships did not change when their avatar did.
 */
export async function collectAvatarFacts(
  vrchat: VrchatApi,
  joiner: Joiner,
  instance: VrcInstance | undefined,
  signal: AbortSignal,
): Promise<Facts> {
  if (joiner.userId === '') return UNKNOWN_FACTS;
  const avatar = await avatarFacts(vrchat, joiner, instance, signal).catch(() => undefined);
  return { ...UNKNOWN_FACTS, ...(avatar ?? {}) };
}

/** Runs every lookup in parallel and returns whatever arrived before the deadline. */
export async function collectFacts(
  vrchat: VrchatApi,
  joiner: Joiner,
  instance: VrcInstance | undefined,
  options: CollectOptions,
): Promise<Facts> {
  if (joiner.userId === '') return UNKNOWN_FACTS;
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(options.deadlineMs)]);
  const joinedAt = Date.now();
  const location = instance?.location ?? '';
  const [user, avatar, groups, timeline] = await Promise.all([
    vrchat.user(joiner.userId, { signal }),
    avatarFacts(vrchat, joiner, instance, signal).catch(() => undefined),
    options.wantsGroups ? vrchat.userGroups(joiner.userId, { signal }).then((g) => g.map((x) => x.id), () => undefined) : Promise.resolve(undefined),
    location === '' ? Promise.resolve(undefined) : vrchat.userTimeline(joiner.userId, { signal }).catch(() => undefined),
  ]);
  const inInstance = instance?.users.find((u) => u.id === joiner.userId);
  return {
    ageVerified: user?.ageVerified ?? inInstance?.ageVerified,
    ageVerificationStatus: user?.ageVerificationStatus ?? inInstance?.ageVerificationStatus ?? '',
    isFriend: user?.isFriend,
    platform: user?.platform ?? inInstance?.platform ?? '',
    ...(avatar ?? { avatarId: '', avatarName: '', avatarImageUrl: '', pcRank: '', questRank: '' }),
    groupIds: groups,
    rejoin: location === '' ? UNKNOWN_REJOIN : rejoinIn(timeline, location, joinedAt),
  };
}
