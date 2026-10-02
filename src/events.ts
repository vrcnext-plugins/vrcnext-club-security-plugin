/**
 * How many times a preset has seen a player — the number the report title counts.
 *
 * "Rejoined" says they have been in *this* instance before. It says nothing about the club: a
 * player who has been to eleven of a group's nights and none of them twice is new to every
 * instance and a regular to the door. This counts the instances in VRCNext's history of them
 * that the preset would have reported on, which is the club's own history of that person.
 *
 * One per instance, however long they stayed and however many records VRCNext filed: a weekend
 * spent in one room was one night out.
 *
 * ## What the number can see
 *
 * VRCNext's records are what it kept, not all of VRChat's history: they reach back to when
 * VRCNext was installed. So this is "the nth event we know about", and it can only grow as
 * VRCNext keeps watching. It is never wrong about an instance it does see, and never counts one
 * twice.
 *
 * With the `sql` permission the count is over every instance in VRCNext's database. Without it,
 * the only source is `getTimelineForUser`, which is hardcoded to **ten records** — so an
 * ungranted club sees a number that stops climbing at ten and should read it as "at least".
 */

import { instancesSeen, parseLocation, type VrcInstance, type VrcTimelineEvent } from '@vrcnext/plugin-api';

import { presetMatches } from './filters.js';
import type { Preset } from './settings.js';

/**
 * The instances in this history that `preset` watches, counting the one they are in now.
 *
 * `undefined` when VRCNext did not answer with a timeline: a title saying "the 1st event" to
 * someone's hundredth visit is worse than a title that does not count at all, so the caller
 * drops the words instead of guessing.
 */
export function eventCount(
  preset: Preset,
  events: readonly VrcTimelineEvent[] | undefined,
  instance: Pick<VrcInstance, 'location' | 'worldId' | 'instanceType' | 'groupId'>,
  seenLocations?: readonly string[],
): number | undefined {
  // Every instance in the database when the club granted `sql`, and the ten-record timeline
  // ten-record slice when it did not — see the ceiling described above.
  const places = seenLocations !== undefined
    ? seenLocations.map((location) => parseLocation(location)).filter((place) => place.key !== '')
    : events === undefined ? undefined : instancesSeen(events);
  if (places === undefined) return undefined;
  const counted = new Set(
    places
      .filter((place) => presetMatches(preset, place))
      .map((place) => place.key),
  );
  // The timeline usually already holds this arrival — VRChat's GPS move reaches VRCNext before
  // the report is written — so the instance they are in now is added only when it is missing,
  // and identified the same way {@link instancesSeen} identifies the rest.
  const here = parseLocation(instance.location).key;
  if (here !== '' && presetMatches(preset, instance)) counted.add(here);
  return counted.size;
}
