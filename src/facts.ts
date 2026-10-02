/**
 * Gathers everything a report needs about one joiner, within a deadline.
 *
 * All of it comes through `ctx.vrchat`, which reads VRCNext's data without touching its dialogs:
 * the profile (age verification, friend state), the avatar the player wears and its ranks, the
 * groups they show, and VRCNext's own timeline for the rejoin check. The lookups run in
 * parallel and each one degrades to "unknown" on its own rather than holding up the report.
 */

import { TIMELINE_GAP, parseLocation, publicImageUrl, trustScore, userEventRows, type ImageSubject, type PerformanceRank, type TrustScore, type VrcInstance, type VrcTimelineEvent, type VrchatApi } from '@vrcnext/plugin-api';

import { LOG_LINES } from './activity.js';
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
  /**
   * Whether a picture neither the lookups nor VRCNext's records could supply may cost one more
   * uncached lookup. The club's `allowExtraApiRequests` answer; nothing else spends a request.
   */
  readonly extraApiRequests?: boolean;
  /** Told what each picture's address was and which one was used. */
  readonly onImages?: (note: string) => void;
}

/**
 * Keeps a picture only if something other than this machine could load it, and says which.
 *
 * A report's pictures fail invisibly — Discord fetches them from its own servers, gets nothing
 * from a `localhost` address, and renders a field with no image and no error — so the one
 * useful thing to record is what the address actually was.
 *
 * Three places are asked, cheapest first, and the note says which one answered:
 *
 * 1. **What the lookups already handed over.** For a picture VRCNext has not cached yet that is
 *    VRChat's own address, and using it costs nothing.
 * 2. **The address VRCNext recorded** when it downloaded the file, through
 *    {@link VrchatApi.originalImageUrl} — one indexed lookup in a database on this machine.
 * 3. **One uncached lookup**, and only when the club opted in with `allowExtraApiRequests`. This is
 *    the only step that may make VRCNext ask VRChat again, which is why it is off by default and
 *    last: it is worth a request only once the two free answers have both come up empty.
 */
type Candidates = readonly (readonly [string, string | undefined])[];

interface ImageFallback {
  readonly vrchat: VrchatApi;
  readonly subject: ImageSubject;
  readonly signal: AbortSignal;
  /** Opt-in only; absent means the club did not allow the extra request. */
  readonly refetch?: (() => Promise<Candidates>) | undefined;
}

/** The first candidate something other than this machine could load, and what the rest were. */
function firstPublic(candidates: Candidates, seen: string[]): readonly [string, string] | undefined {
  for (const [source, url] of candidates) {
    if (url === undefined || url === '') continue;
    if (publicImageUrl(url) !== '') return [source, url];
    seen.push(`${source}=${url}`);
  }
  return undefined;
}

async function pickImage(
  what: string,
  candidates: Candidates,
  fallback: ImageFallback,
  note: ((text: string) => void) | undefined,
): Promise<string> {
  const seen: string[] = [];
  const found = firstPublic(candidates, seen);
  if (found !== undefined) {
    note?.(`${what}: using ${found[0]} (${found[1]})`);
    return found[1];
  }
  if (seen.length === 0) {
    note?.(`${what}: nothing to show; VRCNext gave no address`);
    return '';
  }
  // Checked here as well as in the host: this is the value that goes into the embed, and a local
  // address reaching Discord is the silent failure this whole function exists to prevent.
  const stored = publicImageUrl(
    await fallback.vrchat.originalImageUrl(fallback.subject, { signal: fallback.signal }),
  );
  if (stored !== '') {
    note?.(`${what}: ${seen.join(', ')} is this machine only; using the address VRCNext recorded (${stored})`);
    return stored;
  }
  if (fallback.refetch !== undefined) {
    const fresh = await fallback.refetch().catch(() => []);
    const again = firstPublic(fresh, seen);
    if (again !== undefined) {
      note?.(`${what}: nothing local could be shown, so it was looked up again; using ${again[0]} (${again[1]})`);
      return again[1];
    }
    note?.(`${what}: dropped, and looking it up again did not help (${seen.join(', ')})`);
    return '';
  }
  note?.(`${what}: dropped, only this machine could load ${seen.join(', ')}, and VRCNext recorded no other address`
    + '; turn on "Allow making extra API requests" to let it look again');
  return '';
}

interface AvatarLookup {
  readonly instance: VrcInstance | undefined;
  readonly signal: AbortSignal;
  readonly note?: ((text: string) => void) | undefined;
  readonly extraApiRequests?: boolean | undefined;
}

async function avatarFacts(vrchat: VrchatApi, joiner: Joiner, lookup: AvatarLookup): Promise<Pick<Facts, 'avatarId' | 'avatarName' | 'avatarImageUrl' | 'pcRank' | 'questRank'>> {
  const { instance, signal, note } = lookup;
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
    avatarImageUrl: await pickImage('avatar thumbnail', [
      ['avatar.thumbnailImageUrl', avatar?.thumbnailImageUrl],
      ['avatar.imageUrl', avatar?.imageUrl],
    ], {
      vrchat,
      subject: { kind: 'avatar', id: avatarId },
      signal,
      refetch: lookup.extraApiRequests !== true ? undefined : async () => {
        const fresh = await vrchat.avatar(avatarId, { signal, cached: false });
        return [
          ['refetched avatar.thumbnailImageUrl', fresh?.thumbnailImageUrl],
          ['refetched avatar.imageUrl', fresh?.imageUrl],
        ];
      },
    }, note),
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
  options: Pick<CollectOptions, 'signal' | 'onImages' | 'extraApiRequests'>,
): Promise<Facts> {
  if (joiner.userId === '') return UNKNOWN_FACTS;
  const avatar = await avatarFacts(vrchat, joiner, {
    instance,
    signal: options.signal,
    note: options.onImages,
    extraApiRequests: options.extraApiRequests,
  }).catch(() => undefined);
  return { ...UNKNOWN_FACTS, ...(avatar ?? {}) };
}

/**
 * Names for the groups the log will mention.
 *
 * Mostly free: VRCNext caches the name of every group its own screens have shown, so
 * `vrchat.name` answers without a request for the clubs the user actually goes to. Only the
 * ones it has never resolved cost a lookup.
 *
 * Bounded twice over — by the same call the log itself makes, so only the instances that
 * survive deduplication into the rows that get printed can need a name, the pinned oldest one
 * included, and a report is not worth a dozen group lookups. A lookup that fails leaves the
 * line without the "by …" part rather than holding up the report.
 */
async function groupNames(
  vrchat: VrchatApi,
  timeline: readonly VrcTimelineEvent[] | undefined,
  signal: AbortSignal,
): Promise<ReadonlyMap<string, string>> {
  const ids = [...new Set(
    userEventRows(timeline, { limit: LOG_LINES, oldest: true })
      .filter((row) => row !== TIMELINE_GAP)
      .map((row) => parseLocation(row.event.location).groupId)
      .filter((id) => id !== ''),
  )];
  const found = await Promise.all(ids.map(async (id) => {
    const known = vrchat.name('group', id);
    if (known !== undefined) return [id, known] as const;
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
    avatarFacts(vrchat, joiner, { instance, signal, note: options.onImages, extraApiRequests: options.extraApiRequests }).catch(() => undefined),
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
    // VRCNext's own `imageUrl` is its image cache on this machine, which nothing outside the app
    // can load; VRChat serves `currentAvatarImageUrl` itself, so that is the profile picture a
    // report can actually show. Either way the value is checked rather than trusted.
    userImageUrl: await pickImage('profile picture', [
      ['user.currentAvatarImageUrl', user?.currentAvatarImageUrl],
      ['user.imageUrl', user?.imageUrl],
      ['instanceUser.imageUrl', inInstance?.imageUrl],
    ], {
      vrchat,
      subject: { kind: 'user', id: joiner.userId },
      signal: options.signal,
      refetch: options.extraApiRequests !== true ? undefined : async () => {
        const fresh = await vrchat.user(joiner.userId, { signal: options.signal, cached: false });
        return [
          ['refetched user.currentAvatarImageUrl', fresh?.currentAvatarImageUrl],
          ['refetched user.imageUrl', fresh?.imageUrl],
        ];
      },
    }, options.onImages),
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
