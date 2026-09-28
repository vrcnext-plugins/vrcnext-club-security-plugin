/**
 * Gathers everything a report needs about one joiner, within a deadline.
 *
 * All of it comes through `ctx.vrchat`, which reads VRCNext's data without touching its dialogs:
 * the profile (age verification, friend state), the avatar the player wears and its ranks, the
 * groups they show, and VRCNext's own timeline for the rejoin check. The lookups run in
 * parallel and each one degrades to "unknown" on its own rather than holding up the report.
 */

import { parseLocation, recentUserEvents, trustScore, type PerformanceRank, type TrustScore, type VrcInstance, type VrcTimelineEvent, type VrchatApi } from '@vrcnext/plugin-api';

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
  /** The joiner's profile picture, for the embed's author line. `''` when unreadable. */
  readonly userImageUrl: string;
  readonly avatarId: string;
  readonly avatarName: string;
  readonly avatarImageUrl: string;
  readonly pcRank: PerformanceRank;
  readonly questRank: PerformanceRank;
  /** Groups the player shows publicly; `undefined` when VRCNext did not answer. */
  readonly groupIds: readonly string[] | undefined;
  readonly rejoin: Rejoin;
  /**
   * VRCNext's own recent records for this player, newest first. Used for the rejoin check and
   * for the short activity log a report may show; `undefined` when VRCNext did not answer.
   */
  readonly timeline: readonly VrcTimelineEvent[] | undefined;
  /**
   * Names for the groups whose instances appear in {@link timeline}, by `grp_…`. A record only
   * carries the id, and a log line that said `grp_9f2…` would be worse than saying nothing.
   */
  readonly timelineGroups: ReadonlyMap<string, string>;
  /**
   * The profile score VRCNext used to show on every profile; `undefined` when the profile
   * itself could not be read, since a score out of nothing would read as distrust.
   */
  readonly trust: TrustScore | undefined;
}

export const UNKNOWN_FACTS: Facts = {
  ageVerified: undefined,
  ageVerificationStatus: '',
  isFriend: undefined,
  platform: '',
  userImageUrl: '',
  avatarId: '',
  avatarName: '',
  avatarImageUrl: '',
  pcRank: '',
  questRank: '',
  groupIds: undefined,
  rejoin: UNKNOWN_REJOIN,
  timeline: undefined,
  timelineGroups: new Map(),
  trust: undefined,
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

/**
 * Names for the groups the log will mention, looked up after the timeline is in.
 *
 * Bounded on purpose: only the instances that survive deduplication into the visible lines can
 * need a name, and a report is not worth a dozen group lookups. A lookup that fails leaves the
 * line without the "by …" part rather than holding up the report.
 */
async function groupNames(
  vrchat: VrchatApi,
  timeline: readonly VrcTimelineEvent[] | undefined,
  signal: AbortSignal,
): Promise<ReadonlyMap<string, string>> {
  const ids = [...new Set(
    recentUserEvents(timeline)
      .map((entry) => parseLocation(entry.event.location).groupId)
      .filter((id) => id !== ''),
  )];
  const found = await Promise.all(ids.map(async (id) => {
    const group = await vrchat.group(id, { signal }).catch(() => undefined);
    return [id, group?.name ?? ''] as const;
  }));
  return new Map(found.filter(([, name]) => name !== ''));
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
  const location = instance?.location ?? '';
  const [user, avatar, groups, timeline] = await Promise.all([
    vrchat.user(joiner.userId, { signal }),
    avatarFacts(vrchat, joiner, instance, signal).catch(() => undefined),
    options.wantsGroups ? vrchat.userGroups(joiner.userId, { signal }).then((g) => g.map((x) => x.id), () => undefined) : Promise.resolve(undefined),
    vrchat.userTimeline(joiner.userId, { signal }).catch(() => undefined),
  ]);
  const timelineGroups = await groupNames(vrchat, timeline, signal);
  const inInstance = instance?.users.find((u) => u.id === joiner.userId);
  return {
    ageVerified: user?.ageVerified ?? inInstance?.ageVerified,
    ageVerificationStatus: user?.ageVerificationStatus ?? inInstance?.ageVerificationStatus ?? '',
    isFriend: user?.isFriend,
    platform: user?.platform ?? inInstance?.platform ?? '',
    userImageUrl: user?.imageUrl ?? inInstance?.imageUrl ?? '',
    ...(avatar ?? { avatarId: '', avatarName: '', avatarImageUrl: '', pcRank: '', questRank: '' }),
    groupIds: groups,
    rejoin: location === '' ? UNKNOWN_REJOIN : rejoinIn(timeline, location),
    timeline,
    timelineGroups,
    // Badges and uploaded content are not in what VRCNext pushes, so those criteria are left
    // out of the total rather than counted as failures.
    trust: user === undefined ? undefined : trustScore({
      tags: user.tags,
      dateJoined: user.dateJoined,
      ageVerified: user.ageVerified,
      ageVerificationStatus: user.ageVerificationStatus,
      bio: user.bio,
      groupCount: user.groups.length,
    }),
  };
}
