import { describe, expect, it } from 'vitest';

import { activityLog } from './activity.js';

const LOTUS = 'wrld_aaaa1111-2222-3333-4444-555566667777:12345~group(grp_x)~groupAccessType(public)';

function event(type: string, timestamp: string, location = '', worldName = ''): {
  type: string; timestamp: string; location: string; worldName: string;
} {
  return { type, timestamp, location, worldName };
}

describe('activityLog', () => {
  it('reads VRCNext\'s types as things a person did, newest first', () => {
    const log = activityLog([
      event('friend_online', '2026-09-27T10:00:00Z'),
      event('friend_gps', '2026-09-27T12:00:00Z', LOTUS, 'DragonZ Lotus'),
      event('friend_avatar', '2026-09-27T11:00:00Z'),
    ]);
    expect(log.split('\n')).toEqual([
      '- Visited `DragonZ Lotus #12345` (Group Public) <t:1790510400:R>',
      '- Changed avatar <t:1790506800:R>',
      '- Came online <t:1790503200:R>',
    ]);
  });

  it('keeps only the newest few', () => {
    // Nine visits to nine different instances, so nothing collapses and the cap is what bites.
    const many = Array.from({ length: 9 }, (_, i) =>
      event('instance_join', `2026-09-2${String(i + 1)}T10:00:00Z`, `wrld_w:${String(i)}~public`, 'World'));
    expect(activityLog(many).split('\n')).toHaveLength(5);
    expect(activityLog(many, 2).split('\n')).toHaveLength(2);
  });

  it('collapses the same thing happening twice and names a group it is told about', () => {
    const log = activityLog([
      event('instance_join', '2026-09-27T12:00:00Z', LOTUS, 'DragonZ Lotus'),
      event('instance_join', '2026-09-27T11:00:00Z', LOTUS, 'DragonZ Lotus'),
    ], 5, (id) => (id === 'grp_x' ? 'Lotus Crew' : undefined));
    expect(log).toBe('- Visited `DragonZ Lotus #12345` by `Lotus Crew` (Group Public) ×2 <t:1790510400:R>');
  });

  it('says what a moderation record actually was', () => {
    const blocked = { ...event('moderation', '2026-09-27T12:00:00Z'), notifType: 'block', message: 'on' };
    expect(activityLog([blocked])).toBe('- Blocked by you <t:1790510400:R>');
  });

  it('is empty when VRCNext knows nothing, so the field is dropped', () => {
    expect(activityLog(undefined)).toBe('');
    expect(activityLog([])).toBe('');
  });

  it('still shows a type it has no wording for', () => {
    expect(activityLog([event('friend_something_new', '2026-09-27T10:00:00Z')]))
      .toBe('- Something new <t:1790503200:R>');
  });
});

describe('activityLog, on a record it cannot place', () => {
  it('leaves out an event whose timestamp does not parse', () => {
    const log = activityLog([
      event('friend_online', 'whenever'),
      event('friend_avatar', '2026-09-27T11:00:00Z'),
    ]);
    expect(log).toBe('- Changed avatar <t:1790506800:R>');
  });
});
