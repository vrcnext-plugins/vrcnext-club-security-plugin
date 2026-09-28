/**
 * Whether a joiner has been in this exact instance with you before, from VRCNext's own timeline.
 *
 * `ctx.vrchat.userTimeline` returns the ten most recent timeline events involving the player,
 * each with a timestamp and the location it happened in. VRCNext keeps those in SQLite, so they
 * survive restarts and reach back to when VRCNext was installed. The check is strict on purpose:
 * same world and same instance id, not "met somewhere".
 */

import { newestFirst, parseLocation, type VrcTimelineEvent } from '@vrcnext/plugin-api';

export interface Rejoin {
  /** `undefined` when VRCNext did not answer in time. */
  readonly seenHere: boolean | undefined;
  /** When the earlier visit was recorded, as VRCNext's timestamp. */
  readonly lastAt: string | undefined;
}

export const UNKNOWN_REJOIN: Rejoin = { seenHere: undefined, lastAt: undefined };

/**
 * Looks for an earlier, separate visit to this instance.
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
 */
export function rejoinIn(
  events: readonly Pick<VrcTimelineEvent, 'timestamp' | 'location'>[] | undefined,
  location: string,
): Rejoin {
  if (events === undefined) return UNKNOWN_REJOIN;
  const key = parseLocation(location).key;
  if (key === '') return { seenHere: false, lastAt: undefined };
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
