import assert from 'node:assert/strict';
import { test } from 'vitest';

import type { VrchatApi } from '@vrcnext/plugin-api';

import { EXAMPLE_INSTANCE, instanceFrom, selfCheck } from './replay.js';

const GROUP = 'grp_11111111-2222-3333-4444-555555555555';
const WORLD = 'wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('an instance is rebuilt from the location VRCNext recorded', () => {
  const instance = instanceFrom(`${WORLD}:12345~group(${GROUP})~groupAccessType(plus)~region(eu)`, 'Sample Club');

  assert.equal(instance.worldId, WORLD);
  assert.equal(instance.worldName, 'Sample Club');
  assert.equal(instance.instanceId, '12345');
  assert.equal(instance.groupId, GROUP);
  assert.equal(instance.instanceType, 'group-plus');
  assert.equal(instance.region, 'eu');
});

test('with nothing recorded the world id stands in for its name and nothing is invented', () => {
  const instance = instanceFrom('', '');
  assert.deepEqual([instance.worldId, instance.worldName, instance.instanceType], ['', '', '']);
  assert.deepEqual(instance.users, []);
});

/** Just enough of `ctx.vrchat` for `selfCheck`: an account, and whatever timeline is given. */
function vrchat(self: { id: string; displayName: string } | undefined, timeline: readonly { timestamp: string; location: string; worldName: string }[] = []): VrchatApi {
  return {
    self: () => self,
    userTimeline: () => Promise.resolve(timeline),
    world: () => Promise.resolve(undefined),
  } as unknown as VrchatApi;
}

const ME = { id: 'usr_me', displayName: 'Blu' };

test('checking yourself with VRChat closed falls back to where you last were', async () => {
  const replay = await selfCheck({
    vrchat: vrchat(ME, [{ timestamp: '2026-09-28T10:00:00Z', location: `${WORLD}:12345~public`, worldName: 'Jellybean' }]),
    signal: new AbortController().signal,
    currentInstance: undefined,
  });
  assert.ok(replay);
  assert.equal(replay.joiner.userId, 'usr_me');
  assert.equal(replay.located, true);
  assert.equal(replay.instance.worldName, 'Jellybean');
  assert.equal(replay.instance.instanceId, '12345');
});

test('with nowhere to stand it uses a stand-in, and says so', async () => {
  const replay = await selfCheck({ vrchat: vrchat(ME), signal: new AbortController().signal, currentInstance: undefined });
  assert.ok(replay);
  assert.equal(replay.located, false, 'the caller warns rather than presenting the stand-in as real');
  assert.equal(replay.instance, EXAMPLE_INSTANCE);
});

test('before login there is no account to check', async () => {
  assert.equal(await selfCheck({ vrchat: vrchat(undefined), signal: new AbortController().signal, currentInstance: undefined }), undefined);
});
