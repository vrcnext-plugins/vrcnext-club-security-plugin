/**
 * Whether a joiner has been in this exact instance with you before, from VRCNext's own timeline.
 *
 * `ctx.vrchat.userTimeline` returns the ten most recent timeline events involving the player,
 * each with a timestamp and the location it happened in. VRCNext keeps those in SQLite, so they
 * survive restarts and reach back to when VRCNext was installed. The check is strict on purpose:
 * same world and same instance id, not "met somewhere".
 */

import { parseLocation, type VrcTimelineEvent } from '@vrcnext/plugin-api';

export interface Rejoin {
  /** `undefined` when VRCNext did not answer in time. */
  readonly seenHere: boolean | undefined;
  /** When the earlier visit was recorded, as VRCNext's timestamp. */
  readonly lastAt: string | undefined;
}

export const UNKNOWN_REJOIN: Rejoin = { seenHere: undefined, lastAt: undefined };

/**
 * Looks for an earlier event in the same instance. Events from this join are excluded by
 * timestamp: anything at or after `joinedAt` (with a few seconds of slack) describes this
 * visit, not an earlier one.
 */
export function rejoinIn(
  events: readonly Pick<VrcTimelineEvent, 'timestamp' | 'location'>[] | undefined,
  location: string,
  joinedAt: number,
): Rejoin {
  if (events === undefined) return UNKNOWN_REJOIN;
  const key = parseLocation(location).key;
  if (key === '') return { seenHere: false, lastAt: undefined };
  const earlier = events
    .filter((e) => parseLocation(e.location).key === key)
    .filter((e) => {
      const at = Date.parse(e.timestamp);
      return Number.isFinite(at) && at < joinedAt - 5_000;
    })
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const last = earlier[0];
  return { seenHere: last !== undefined, lastAt: last?.timestamp };
}
