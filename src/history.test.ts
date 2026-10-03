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

const THEM = 'usr_45d5c503-0783-4bf7-a01a-d26007200aea';

test('sessions settle a rejoin the records alone cannot see', () => {
  // Deahtpink in Fjord Party Club #43154 on 2026-10-03, straight out of VRCNext's database.
  // Two events, both in this instance and nothing anywhere else between them and now, so the
  // records read as one unbroken visit and the report said "joined". The session list on the
  // `instance_join` says otherwise: here 21:51–22:47, gone thirteen minutes, back at 23:00.
  const events = [
    { timestamp: '2026-10-03T21:51:36Z', location: HERE },
    {
      timestamp: '2026-10-03T21:10:14Z',
      location: HERE,
      players: [{
        userId: THEM,
        displayName: 'Deahtpink',
        joinedAts: ['2026-10-03T21:51:36Z', '2026-10-03T23:00:53Z'],
        leftAts: ['2026-10-03T22:47:17Z', '2026-10-03T23:02:53Z'],
      }],
    },
  ];
  assert.equal(rejoinIn(events, HERE).seenHere, false, 'without the user id there is nothing to look up');
  const r = rejoinIn(events, HERE, THEM);
  assert.equal(r.seenHere, true);
  assert.equal(r.lastAt, '2026-10-03T21:51:36Z', 'the visit they came back from, not this one');
});

test('one session in this instance is a first visit, whatever the records look like', () => {
  const r = rejoinIn([{
    timestamp: '2026-10-03T21:10:14Z',
    location: HERE,
    players: [{ userId: THEM, displayName: 'Deahtpink', joinedAts: ['2026-10-03T21:51:36Z'], leftAts: [] }],
  }], HERE, THEM);
  assert.equal(r.seenHere, false);
  assert.equal(r.lastAt, undefined);
});

test('sessions for someone else are not an answer about this player', () => {
  // Falls through to the records, which do show a visit they came back from.
  const r = rejoinIn([
    { timestamp: '2026-09-27T11:59:58Z', location: HERE, players: [{ userId: 'usr_other', displayName: 'Someone', joinedAts: ['2026-09-27T11:00:00Z', '2026-09-27T11:59:58Z'], leftAts: [] }] },
    { timestamp: '2026-09-27T10:00:00Z', location: SAME_WORLD_OTHER_INSTANCE },
    { timestamp: '2026-09-20T20:00:00Z', location: HERE },
  ], HERE, THEM);
  assert.equal(r.seenHere, true);
  assert.equal(r.lastAt, '2026-09-20T20:00:00Z');
});
