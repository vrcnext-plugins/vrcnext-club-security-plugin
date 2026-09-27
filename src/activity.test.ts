import { describe, expect, it } from 'vitest';

import { activityLog, code, discordTime } from './activity.js';

const LOTUS = 'wrld_aaaa1111-2222-3333-4444-555566667777:12345~group(grp_x)~groupAccessType(public)';

function event(type: string, timestamp: string, location = '', worldName = ''): {
  type: string; timestamp: string; location: string; worldName: string;
} {
  return { type, timestamp, location, worldName };
}

describe('discordTime', () => {
  it('renders the epoch second Discord wants', () => {
    expect(discordTime('2026-09-27T13:55:03.346Z')).toBe('<t:1790517303:R>');
    expect(discordTime(1_790_517_303_346)).toBe('<t:1790517303:R>');
  });

  it('gives nothing for a timestamp it cannot read, rather than NaN', () => {
    expect(discordTime('whenever')).toBe('');
  });
});

describe('activityLog', () => {
  it('reads VRCNext\'s types as things a person did, newest first', () => {
    const log = activityLog([
      event('friend_online', '2026-09-27T10:00:00Z'),
      event('friend_gps', '2026-09-27T12:00:00Z', LOTUS, 'DragonZ Lotus'),
      event('friend_avatar', '2026-09-27T11:00:00Z'),
    ]);
    expect(log.split('\n')).toEqual([
      '- went to `DragonZ Lotus` (group-public) <t:1790510400:R>',
      '- changed avatar <t:1790506800:R>',
      '- came online <t:1790503200:R>',
    ]);
  });

  it('keeps only the newest few', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      event('friend_online', `2026-09-2${String(i + 1)}T10:00:00Z`));
    expect(activityLog(many).split('\n')).toHaveLength(5);
    expect(activityLog(many, 2).split('\n')).toHaveLength(2);
  });

  it('is empty when VRCNext knows nothing, so the field is dropped', () => {
    expect(activityLog(undefined)).toBe('');
    expect(activityLog([])).toBe('');
  });

  it('still shows a type it has no wording for', () => {
    expect(activityLog([event('friend_something_new', '2026-09-27T10:00:00Z')]))
      .toBe('- something new <t:1790503200:R>');
  });
});

describe('code', () => {
  it('fences a name so its markdown is shown, not applied', () => {
    expect(code('**Club**')).toBe('`**Club**`');
  });

  it('uses a longer fence for a name that contains one', () => {
    expect(code('this is a `name')).toBe('`` this is a `name ``');
    expect(code('a ``b`` c')).toBe('``` a ``b`` c ```');
  });
});
