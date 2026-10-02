import assert from 'node:assert/strict';
import { test } from 'vitest';

import { defaultsFor, type VrcInstance, type VrcTimelineEvent } from '@vrcnext/plugin-api';

import { eventCount } from './events.js';
import { preset as presetSchema, type Preset } from './settings.js';

const GROUP = 'grp_11111111-2222-3333-4444-555555555555';
const WORLD = 'wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/** A group-plus location in the club's own world. */
function club(instanceId: string): string {
  return `${WORLD}:${instanceId}~group(${GROUP})~groupAccessType(plus)`;
}

function preset(overrides: Partial<Preset> = {}): Preset {
  return { ...defaultsFor(presetSchema), ...overrides };
}

function at(type: string, location: string, timestamp: string): VrcTimelineEvent {
  return { id: `${type}-${timestamp}-${location}`, type, timestamp, location, worldName: 'DragonZ Lotus' };
}

function instance(location: string): Pick<VrcInstance, 'location' | 'worldId' | 'instanceType' | 'groupId'> {
  return { location, worldId: WORLD, instanceType: 'group-plus', groupId: GROUP };
}

test('each instance counts once, however many records it filed', () => {
  const events = [
    at('instance_join', club('111'), '2026-09-01T10:00:00Z'),
    at('meet_again', club('111'), '2026-09-01T10:00:30Z'),
    at('friend_gps', club('111'), '2026-09-01T18:00:00Z'),
    at('meet_again', club('222'), '2026-09-15T10:00:00Z'),
  ];
  assert.equal(eventCount(preset({ group: GROUP }), events, instance(club('333'))), 3);
});

test('the instance they are in now is counted, and only once when the timeline already has it', () => {
  const events = [at('meet_again', club('111'), '2026-09-01T10:00:00Z')];
  assert.equal(eventCount(preset({ group: GROUP }), events, instance(club('111'))), 1, 'already in the history');
  assert.equal(eventCount(preset({ group: GROUP }), events, instance(club('222'))), 2, 'a place the history missed');
  assert.equal(eventCount(preset({ group: GROUP }), [], instance(club('222'))), 1, 'no history, but they are here');
});

test("only instances the preset would have reported on count", () => {
  const elsewhere = 'wrld_cccccccc-cccc-cccc-cccc-cccccccccccc:9~public';
  const events = [
    at('meet_again', club('111'), '2026-09-01T10:00:00Z'),
    at('instance_join', elsewhere, '2026-09-02T10:00:00Z'),
    // No location at all: an avatar change says nothing about where they were.
    at('friend_avatar', '', '2026-09-03T10:00:00Z'),
  ];
  assert.equal(eventCount(preset({ group: GROUP }), events, instance(club('111'))), 1);
  assert.equal(eventCount(preset(), events, instance(club('111'))), 2, 'a preset that filters nothing counts both');
});

test('no timeline means no count, so the title says nothing rather than guessing', () => {
  assert.equal(eventCount(preset({ group: GROUP }), undefined, instance(club('111'))), undefined);
});
