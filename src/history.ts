/**
 * Whether a joiner has been in this exact instance with you before, from VRCNext's own timeline.
 *
 * `ctx.vrchat.userTimeline` returns the ten most recent timeline events involving the player,
 * each with a timestamp and the location it happened in. VRCNext keeps those in SQLite, so they
 * survive restarts and reach back to when VRCNext was installed. The check is strict on purpose:
 * same world and same instance id, not "met somewhere".
 *
 * Two answers, in order of how much they know: the sessions VRCNext recorded for the person in
 * this instance, which settle it outright, and failing those the shape of the records around
 * them. See {@link sessionRejoin} and {@link wanderRejoin}.
 */

import { newestFirst, parseLocation, type VrcTimelineEvent } from '@vrcnext/plugin-api';

export interface Rejoin {
  /** `undefined` when VRCNext did not answer in time. */
  readonly seenHere: boolean | undefined;
  /** When the earlier visit was recorded, as VRCNext's timestamp. */
  readonly lastAt: string | undefined;
}

export const UNKNOWN_REJOIN: Rejoin = { seenHere: undefined, lastAt: undefined };

/** Looks for an earlier, separate visit to this instance. */
export function rejoinIn(
  events: readonly TimelineRecord[] | undefined,
  location: string,
  userId?: string,
): Rejoin {
  if (events === undefined) return UNKNOWN_REJOIN;
  const key = parseLocation(location).key;
  if (key === '') return { seenHere: false, lastAt: undefined };
  return sessionRejoin(events, key, userId) ?? wanderRejoin(events, key);
}

type TimelineRecord = Pick<VrcTimelineEvent, 'timestamp' | 'location' | 'players'>;

/**
 * The answer VRCNext actually wrote down, when it wrote one down.
 *
 * An `instance_join` carries a session list per person: every time they arrived and every time
 * they left. More than one arrival in this instance is a rejoin, with nothing to infer — and it
 * catches the case the records cannot, where both visits are inside the same run and the player
 * went somewhere VRCNext never saw. `undefined` when nothing recorded sessions here: VRCX
 * imports carry none, and neither does any record that is not an `instance_join`.
 */
function sessionRejoin(
  events: readonly TimelineRecord[],
  key: string,
  userId: string | undefined,
): Rejoin | undefined {
  if (userId === undefined || userId === '') return undefined;
  const arrivals: string[] = [];
  let sessions = false;
  for (const event of events) {
    if (parseLocation(event.location).key !== key) continue;
    const player = event.players?.find((p) => p.userId === userId);
    if (player === undefined || player.joinedAts.length === 0) continue;
    sessions = true;
    arrivals.push(...player.joinedAts);
  }
  if (!sessions) return undefined;
  // One visit per arrival, so the one before the latest is the visit they came back from.
  const sorted = [...new Set(arrivals)].sort();
  const previous = sorted.at(-2);
  return previous === undefined ? { seenHere: false, lastAt: undefined } : { seenHere: true, lastAt: previous };
}

/**
 * Failing sessions, whether the records *around* this instance show them leaving and returning.
 *
 * Clock arithmetic cannot do this: the event that records *this* arrival is usually minutes
 * old by the time a report is written — VRChat pushes the friend's GPS move before the log
 * line reaches VRCNext, and a replay runs on someone standing in the instance right now.
 * Treating any old event here as an earlier visit made every report a rejoin.
 *
 * So the question is asked as a person would: did they go somewhere else in between? The
 * newest run of events in this instance describes the visit they are on. Only an event here
 * that sits *behind* an event somewhere else is a visit they came back from. Events with no
 * location — an avatar or status change — say nothing about where they were, and are skipped.
 *
 * Which is why it is the second answer, not the first: a player who left this instance and came
 * back without VRCNext seeing where they went has every record in one place, and reads as one
 * unbroken visit. {@link sessionRejoin} is the one that knows better.
 */
function wanderRejoin(events: readonly TimelineRecord[], key: string): Rejoin {
  const located = newestFirst(events)
    .map((event) => ({ timestamp: event.timestamp, key: parseLocation(event.location).key }))
    .filter((event) => event.key !== '');
  const wentElsewhere = located.findIndex((event) => event.key !== key);
  if (wentElsewhere === -1) return { seenHere: false, lastAt: undefined };
  const before = located.slice(wentElsewhere).find((event) => event.key === key);
  return before === undefined
    ? { seenHere: false, lastAt: undefined }
    : { seenHere: true, lastAt: before.timestamp };
}
