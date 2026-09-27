import assert from 'node:assert/strict';
import { test } from 'vitest';

import { rejoinIn } from './history.js';

const HERE = 'wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:12345~group(grp_1)~groupAccessType(plus)~region(eu)';
const SAME_INSTANCE_OTHER_MODIFIERS = 'wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:12345~group(grp_1)';
const SAME_WORLD_OTHER_INSTANCE = 'wrld_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:99999~region(eu)';

test('a visit they left and came back to is a rejoin, timed at the earlier visit', () => {
  const r = rejoinIn([
    { timestamp: '2026-09-27T11:59:58Z', location: HERE },                 // this join
    { timestamp: '2026-09-27T10:00:00Z', location: SAME_WORLD_OTHER_INSTANCE },
    { timestamp: '2026-09-27T09:00:00Z', location: SAME_INSTANCE_OTHER_MODIFIERS },
    { timestamp: '2026-09-20T20:00:00Z', location: HERE },
  ], HERE);
  assert.equal(r.seenHere, true);
  assert.equal(r.lastAt, '2026-09-27T09:00:00Z');
});

test('the arrival itself is not an earlier visit, however long ago it was recorded', () => {
  // The case that made every report say "rejoined": VRChat records the GPS move well before
  // the log line arrives, and a replay runs on someone standing here right now.
  assert.equal(rejoinIn([{ timestamp: '2026-09-27T08:00:00Z', location: HERE }], HERE).seenHere, false);
  assert.equal(rejoinIn([
    { timestamp: '2026-09-27T11:00:00Z', location: HERE },
    { timestamp: '2026-09-27T08:00:00Z', location: SAME_INSTANCE_OTHER_MODIFIERS },
  ], HERE).seenHere, false);
});

test('an avatar or status change says nothing about where they were', () => {
  assert.equal(rejoinIn([
    { timestamp: '2026-09-27T11:59:00Z', location: '' },
    { timestamp: '2026-09-27T11:00:00Z', location: HERE },
  ], HERE).seenHere, false);
});

test('the same world in another instance, or nothing at all, is not a rejoin', () => {
  assert.equal(rejoinIn([{ timestamp: '2026-09-27T10:00:00Z', location: SAME_WORLD_OTHER_INSTANCE }], HERE).seenHere, false);
  assert.equal(rejoinIn([], HERE).seenHere, false);
});

test('no answer from VRCNext is unknown, not no', () => {
  assert.equal(rejoinIn(undefined, HERE).seenHere, undefined);
});
