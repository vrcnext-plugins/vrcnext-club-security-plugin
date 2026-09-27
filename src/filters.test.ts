import assert from 'node:assert/strict';
import { test } from 'vitest';

import { defaultsFor } from '@vrcnext/plugin-api';

import { describePreset, matchingPresets, presetMatches, type InstanceShape } from './filters.js';
import { preset as presetSchema, type Preset } from './settings.js';

const GROUP = 'grp_11111111-2222-3333-4444-555555555555';
const WORLD = 'wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function preset(overrides: Partial<Preset> = {}): Preset {
  return { ...defaultsFor(presetSchema), ...overrides };
}

function instance(overrides: Partial<InstanceShape> = {}): InstanceShape {
  return { worldId: WORLD, instanceType: 'group-public', groupId: GROUP, ...overrides };
}

test('an empty preset matches every instance', () => {
  assert.equal(presetMatches(preset(), instance()), true);
  assert.equal(presetMatches(preset(), instance({ instanceType: 'public', groupId: '' })), true);
});

test('instance types are exact, group and worlds compare case-insensitively', () => {
  assert.equal(presetMatches(preset({ instanceTypes: ['group-plus'] }), instance()), false);
  assert.equal(presetMatches(preset({ instanceTypes: ['group-plus', 'group-public'] }), instance()), true);
  assert.equal(presetMatches(preset({ group: GROUP.toUpperCase() }), instance()), true);
  assert.equal(presetMatches(preset({ group: GROUP }), instance({ groupId: 'grp_other' })), false);
  assert.equal(presetMatches(preset({ worlds: [WORLD.toUpperCase()] }), instance()), true);
  assert.equal(presetMatches(preset({ worlds: ['wrld_other'] }), instance()), false);
});

test('matchingPresets skips disabled ones and keeps order', () => {
  const a = preset({ name: 'a' });
  const b = preset({ name: 'b', enabled: false });
  const c = preset({ name: 'c', worlds: ['wrld_other'] });
  assert.deepEqual(matchingPresets([a, b, c], instance()).map((p) => p.name), ['a']);
});

test('describePreset names what is restricted', () => {
  assert.equal(describePreset(preset()), 'every instance');
  assert.equal(describePreset(preset({ instanceTypes: ['group-plus'], group: GROUP, worlds: [WORLD, 'wrld_b'] })), 'types: group-plus · one group · 2 worlds');
});
