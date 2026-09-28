/**
 * The test button: the last join VRCNext recorded, run through the presets again.
 *
 * Made-up reports would say nothing useful, because what a report contains is exactly what the
 * preset asked to be checked. So the test replays a real one: the most recent player VRCNext
 * saw near you, the instance it saw them in, and their real profile and avatar. Every preset
 * then evaluates them with its own requirements, which is what the user is testing.
 *
 * None of it needs VRChat to be running — VRCNext keeps the recent players and their timeline
 * in its own database — so a club's webhook can be set up with the game closed.
 */

import { newestFirst, parseLocation, type VrcInstance, type VrchatApi } from '@vrcnext/plugin-api';

import type { Joiner } from './facts.js';

export interface Replay {
  readonly joiner: Joiner;
  readonly instance: VrcInstance;
  /** Whether this is where they were met, or a stand-in because the location was not recorded. */
  readonly located: boolean;
}

/** An instance as far as a location string describes one; the rest is what a report never reads. */
export function instanceFrom(location: string, worldName: string): VrcInstance {
  const at = parseLocation(location);
  return {
    location,
    worldId: at.worldId,
    worldName: worldName === '' ? at.worldId : worldName,
    worldThumbnailUrl: '',
    instanceId: at.instanceId,
    instanceType: at.instanceType,
    groupId: at.groupId,
    region: at.region,
    userCount: 0,
    capacity: 0,
    users: [],
  };
}

/** The most recent timeline event that says where it happened. */
function lastLocation(events: readonly { timestamp: string; location: string; worldName: string }[]): { location: string; worldName: string } | undefined {
  return newestFirst(events).find((event) => event.location !== '');
}

export interface ReplayOptions {
  readonly vrchat: VrchatApi;
  readonly signal: AbortSignal;
  /** Used when the recorded location is unknown, and preferred when you are in one. */
  readonly currentInstance: VrcInstance | undefined;
}

/**
 * A stand-in instance for a test with nothing to stand on: a public instance of a world that
 * does not exist. Obvious in a report rather than plausible, because a report that looked real
 * but was not would be the worst of the three outcomes.
 */
export const EXAMPLE_INSTANCE = instanceFrom(
  'wrld_00000000-0000-0000-0000-000000000000:00000~public',
  'Example World',
);

/**
 * You, and where you last were — for "how would this preset treat me?".
 *
 * Every filter the real path applies to you is deliberately skipped by the caller: the point is
 * to see the verdict you would get, and the code that normally makes sure you never report
 * yourself would otherwise make that impossible to find out. Where you are comes from the
 * instance when VRChat is running, from your own newest located record when it is not, and from
 * {@link EXAMPLE_INSTANCE} when VRCNext has neither.
 *
 * `undefined` only before VRChat login, when there is no account to check.
 */
export async function selfCheck(options: ReplayOptions): Promise<Replay | undefined> {
  const { vrchat, signal } = options;
  const me = vrchat.self();
  if (me === undefined) return undefined;
  const joiner: Joiner = { name: me.displayName, userId: me.id };

  const current = options.currentInstance;
  if (current !== undefined) return { joiner, instance: current, located: true };

  const timeline = await vrchat.userTimeline(me.id, { signal }).catch(() => []);
  const where = lastLocation(timeline);
  if (where === undefined) return { joiner, instance: EXAMPLE_INSTANCE, located: false };
  const world = await vrchat.world(parseLocation(where.location).worldId, { signal }).catch(() => undefined);
  return { joiner, instance: instanceFrom(where.location, world?.name ?? where.worldName), located: true };
}

/**
 * The last player VRCNext recorded near you, and where. `undefined` when it has recorded
 * nobody, which is the only case the caller has to explain to the user.
 */
export async function lastJoin(options: ReplayOptions): Promise<Replay | undefined> {
  const { vrchat, signal } = options;
  const me = vrchat.self();
  const recent = await vrchat.recentPlayers({ signal });
  const player = recent.find((user) => user.id !== '' && user.id !== me?.id);
  if (player === undefined) return undefined;
  const joiner: Joiner = { name: player.displayName, userId: player.id };

  const current = options.currentInstance;
  if (current !== undefined) return { joiner, instance: current, located: true };

  const timeline = await vrchat.userTimeline(player.id, { signal }).catch(() => []);
  const where = lastLocation(timeline);
  if (where === undefined) return { joiner, instance: instanceFrom('', ''), located: false };
  const world = await vrchat.world(parseLocation(where.location).worldId, { signal }).catch(() => undefined);
  return { joiner, instance: instanceFrom(where.location, world?.name ?? where.worldName), located: true };
}
