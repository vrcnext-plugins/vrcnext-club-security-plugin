/**
 * Gathers everything a report needs about one joiner, within a deadline.
 *
 * All of it comes through `ctx.vrchat`, which reads VRCNext's data without touching its dialogs:
 * the profile (age verification, friend state), the avatar the player wears and its ranks, the
 * groups they show, and VRCNext's own timeline for the rejoin check. The lookups run in
 * parallel and each one degrades to "unknown" on its own rather than holding up the report.
 */

import { TIMELINE_GAP, parseLocation, publicImageUrl, trustRankLabel, trustScore, userEventRows, type ImageSubject, type PerformanceRank, type SqlApi, type TrustScore, type VrcInstance, type VrcModerations, type VrcTimelineEvent, type VrchatApi } from '@vrcnext/plugin-api';

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
  readonly iosRank: PerformanceRank;
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

  // The three profile cards. All of it is on the profile payload VRCNext already sends, except
  // `dbEntries`, which is a count no payload carries.

  /** VRChat's own standing word for their tags: Visitor, New User, User, Known User, Trusted. */
  readonly trustRank: string;
  /** How many times VRCNext has recorded meeting them, first meet included. */
  readonly meets: number | undefined;
  readonly firstMeetDate: string;
  readonly lastSeen: string;
  readonly totalTimeSeconds: number | undefined;
  /**
   * Rows in VRCNext's database that mention them, counted the way VRCNext selects a timeline:
   * events they are the subject or sender of, plus every instance they were present in.
   * `undefined` without the `sql` permission, or when the query failed.
   */
  readonly dbEntries: number | undefined;
  /**
   * Every instance VRCNext ever recorded them in, as raw locations. `undefined` without the
   * `sql` permission, and the count then falls back to the ten-record timeline.
   */
  readonly seenLocations: readonly string[] | undefined;
  /**
   * The oldest record VRCNext holds about them, so the log's pinned last line is the real first
   * one rather than the oldest of the ten the page returned. `undefined` without `sql`.
   */
  readonly oldestEvent: VrcTimelineEvent | undefined;
  /** What *you* have done to them. Each flag `undefined` when that list was not loaded. */
  readonly moderations: VrcModerations;
  readonly languages: readonly string[];
  readonly dateJoined: string;
  readonly lastLogin: string;
  readonly lastActivity: string;
  readonly pronouns: string;
  readonly status: string;
  readonly statusDescription: string;
  /** Your private note on them, and VRCNext's own memo. */
  readonly note: string;
  readonly bio: string;
  readonly allowAvatarCopying: boolean | undefined;
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
  iosRank: '',
  groupIds: undefined,
  rejoin: UNKNOWN_REJOIN,
  timeline: undefined,
  timelineGroups: new Map(),
  trust: undefined,
  trustRank: '',
  meets: undefined,
  firstMeetDate: '',
  lastSeen: '',
  totalTimeSeconds: undefined,
  dbEntries: undefined,
  seenLocations: undefined,
  oldestEvent: undefined,
  moderations: { blocked: undefined, muted: undefined, chatMuted: undefined, avatarHidden: undefined, interactOff: undefined },
  languages: [],
  dateJoined: '',
  lastLogin: '',
  lastActivity: '',
  pronouns: '',
  status: '',
  statusDescription: '',
  note: '',
  bio: '',
  allowAvatarCopying: undefined,
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
  /**
   * Read-only SQL, for the one number the page cannot answer.
   *
   * reuse: `getTimelineForUser` is hardcoded to ten records (`TimelineController.cs`), so how
   * many records exist at all is not a question any page state or push can answer at any cost.
   * Absent when the club has not granted `sql`, and the row is then left out rather than guessed.
   */
  readonly sql?: SqlApi;
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

async function avatarFacts(vrchat: VrchatApi, joiner: Joiner, lookup: AvatarLookup): Promise<Pick<Facts, 'avatarId' | 'avatarName' | 'avatarImageUrl' | 'pcRank' | 'questRank' | 'iosRank'>> {
  const { instance, signal, note } = lookup;
  const known = instance?.users.find((u) => u.id === joiner.userId);
  let avatarId = known?.avatarId ?? '';
  let avatarName = known?.avatarName ?? '';
  if (avatarId === '') {
    const found = await vrchat.instanceAvatar(joiner.userId, { signal });
    avatarId = found?.avatarId ?? '';
    avatarName = found?.avatarName ?? avatarName;
  }
  if (avatarId === '') return { avatarId: '', avatarName, avatarImageUrl: '', pcRank: '', questRank: '', iosRank: '' };
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
        // reuse: the cached reply is what came back without a usable picture, so asking
        // again is the only thing left to try. Behind the club's own `allowExtraApiRequests`.
        const fresh = await vrchat.avatar(avatarId, { signal, cached: false });
        return [
          ['refetched avatar.thumbnailImageUrl', fresh?.thumbnailImageUrl],
          ['refetched avatar.imageUrl', fresh?.imageUrl],
        ];
      },
    }, note),
    pcRank: avatar?.pcRank ?? '',
    questRank: avatar?.questRank ?? '',
    iosRank: avatar?.iosRank ?? '',
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

/**
 * How many rows in VRCNext's database mention this player.
 *
 * The same selection VRCNext's own timeline query uses — `ep.user_id = $uid OR e.user_id = $uid
 * OR e.sender_id = $uid` — so the number answers "how much of this is about them", not "how many
 * tables mention them". An unreadable database answers `undefined`, never 0: nothing recorded
 * and nothing readable must not look alike.
 */
async function dbEntriesFor(sql: SqlApi | undefined, userId: string): Promise<number | undefined> {
  if (sql === undefined) return undefined;
  try {
    const value = await sql.value(
      'vrcnext',
      'SELECT (SELECT count(*) FROM event_players WHERE user_id = ?1)'
      + ' + (SELECT count(*) FROM events WHERE user_id = ?1 OR sender_id = ?1) AS n',
      [userId],
    );
    return typeof value === 'number' ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every instance VRCNext has ever recorded this player in.
 *
 * reuse: `getTimelineForUser` answers with ten records (`TimelineController.cs`), so the page
 * cannot count a history longer than that at any cost — a regular with sixty nights looks
 * identical to one with ten. The selection matches VRCNext's own: records they are the subject
 * or sender of, plus every instance they were present in.
 *
 * Locations, not a count, because which of them a preset watches is decided by
 * `presetMatches` over a parsed location, and that parse lives in one place rather than being
 * half-reimplemented in SQL. One query per joiner, shared by every preset.
 */
async function seenLocationsFor(sql: SqlApi | undefined, userId: string): Promise<readonly string[] | undefined> {
  if (sql === undefined) return undefined;
  try {
    const rows = await sql.rows(
      'vrcnext',
      "SELECT DISTINCT location FROM events WHERE location != ''"
      + ' AND (user_id = ?1 OR id IN (SELECT event_id FROM event_players WHERE user_id = ?1))',
      [userId],
    );
    return rows.map((row) => (typeof row['location'] === 'string' ? row['location'] : '')).filter((l) => l !== '');
  } catch {
    return undefined;
  }
}

/**
 * The oldest record VRCNext holds about this player — usually the day you met.
 *
 * reuse: the pinned last line of the activity log is meant to be the first thing VRCNext ever
 * saw of them, and ten records cannot reach it for anyone you have met more than ten
 * events ago. One row, ordered in SQLite rather than in the page.
 */
async function oldestEventFor(sql: SqlApi | undefined, userId: string): Promise<VrcTimelineEvent | undefined> {
  if (sql === undefined) return undefined;
  try {
    const rows = await sql.rows(
      'vrcnext',
      'SELECT id, type, timestamp, location, world_name, world_id, user_id, user_name FROM events'
      + ' WHERE user_id = ?1 OR id IN (SELECT event_id FROM event_players WHERE user_id = ?1)'
      + " ORDER BY timestamp ASC LIMIT 1",
      [userId],
    );
    const row = rows[0];
    if (row === undefined) return undefined;
    const text = (key: string): string => (typeof row[key] === 'string' ? row[key] : '');
    if (text('timestamp') === '') return undefined;
    return {
      id: text('id'),
      type: text('type'),
      timestamp: text('timestamp'),
      location: text('location'),
      worldName: text('world_name'),
      worldId: text('world_id'),
      userId: text('user_id'),
      userName: text('user_name'),
    };
  } catch {
    return undefined;
  }
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
  const [user, avatar, groups, timeline, dbEntries, seenLocations, oldestEvent] = await Promise.all([
    vrchat.user(joiner.userId, { signal }),
    avatarFacts(vrchat, joiner, { instance, signal, note: options.onImages, extraApiRequests: options.extraApiRequests }).catch(() => undefined),
    options.wantsGroups ? vrchat.userGroups(joiner.userId, { signal }).then((g) => g.map((x) => x.id), () => undefined) : Promise.resolve(undefined),
    vrchat.userTimeline(joiner.userId, { signal }).catch(() => undefined),
    dbEntriesFor(options.sql, joiner.userId),
    seenLocationsFor(options.sql, joiner.userId),
    oldestEventFor(options.sql, joiner.userId),
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
        // reuse: same bargain as the avatar above, and behind the same setting.
        const fresh = await vrchat.user(joiner.userId, { signal: options.signal, cached: false });
        return [
          ['refetched user.currentAvatarImageUrl', fresh?.currentAvatarImageUrl],
          ['refetched user.imageUrl', fresh?.imageUrl],
        ];
      },
    }, options.onImages),
    ...(avatar ?? { avatarId: '', avatarName: '', avatarImageUrl: '', pcRank: '', questRank: '', iosRank: '' }),
    groupIds: groups,
    rejoin: location === '' ? UNKNOWN_REJOIN : rejoinIn(timeline, location, joiner.userId),
    timeline,
    timelineGroups,
    // Badges and uploaded content are not in what VRCNext pushes, so those criteria are left
    // out of the total rather than counted as failures.
    // reuse: every one of these is on the profile payload VRCNext already sent, and the
    // moderation flags are read straight from the page arrays it keeps. No extra lookup.
    trustRank: user === undefined ? '' : trustRankLabel(user.tags),
    meets: user?.meets,
    firstMeetDate: user?.firstMeetDate ?? '',
    lastSeen: user?.lastSeen ?? '',
    totalTimeSeconds: user?.totalTimeSeconds,
    dbEntries,
    seenLocations,
    oldestEvent,
    moderations: vrchat.moderations(joiner.userId),
    languages: user?.languages ?? [],
    dateJoined: user?.dateJoined ?? '',
    lastLogin: user?.lastLogin ?? '',
    lastActivity: user?.lastActivity ?? '',
    pronouns: user?.pronouns ?? '',
    status: user?.status ?? '',
    statusDescription: user?.statusDescription ?? '',
    note: user?.note ?? user?.memo ?? '',
    bio: user?.bio ?? '',
    allowAvatarCopying: user?.allowAvatarCopying,
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
