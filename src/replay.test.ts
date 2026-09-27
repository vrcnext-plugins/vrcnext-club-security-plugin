import assert from 'node:assert/strict';
import { test } from 'vitest';

import { instanceFrom } from './replay.js';

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
