import { describe, expect, it } from 'vitest';

import { EMBED_LIMITS } from '@vrcnext/plugin-api';

import { activityLog, LOG_LINES } from './activity.js';

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

  /** `count` visits to that many different instances, so nothing collapses. */
  function visits(count: number, worldName = 'World'): { type: string; timestamp: string; location: string; worldName: string }[] {
    return Array.from({ length: count }, (_, i) =>
      event('instance_join', `2026-09-27T10:00:${String(i).padStart(2, '0')}Z`, `wrld_w${String(i)}:${String(i)}~public`, worldName));
  }

  it('asks for as many lines as the field can hold, and takes a cap when given one', () => {
    expect(activityLog(visits(30)).split('\n')).toHaveLength(LOG_LINES);
    expect(activityLog(visits(30), { limit: 2 }).split('\n')).toHaveLength(2);
    // Fewer records than the ceiling: every one of them is shown.
    expect(activityLog(visits(4)).split('\n')).toHaveLength(4);
  });

  it('never returns more than Discord will accept in a field', () => {
    // A world name long enough that twelve of these lines would overrun 1024 characters.
    const log = activityLog(visits(30, 'YTS 2.1 - YouTube Search, Subtitles, Quest and more'));
    expect(log.length).toBeLessThanOrEqual(EMBED_LIMITS.fieldValue);
    expect(log.split('\n').length).toBeLessThan(LOG_LINES);
    // Cut between lines, never inside one: every line still ends in its own timestamp.
    for (const line of log.split('\n')) expect(line).toMatch(/(<t:\d+:R>|^- \.\.\.$)/);
  });

  it('collapses the same thing happening twice and names a group it is told about', () => {
    const log = activityLog([
      event('instance_join', '2026-09-27T12:00:00Z', LOTUS, 'DragonZ Lotus'),
      event('instance_join', '2026-09-27T11:00:00Z', LOTUS, 'DragonZ Lotus'),
    ], { limit: 5, groupName: (id: string) => (id === 'grp_x' ? 'Lotus Crew' : undefined) });
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

describe('the pinned oldest row', () => {
  const window_ = [
    { type: 'meet_again', timestamp: '2026-09-28T10:00:00Z', location: 'wrld_a:1', worldName: 'Lotus' },
    { type: 'meet_again', timestamp: '2026-09-27T10:00:00Z', location: 'wrld_a:2', worldName: 'Lotus' },
  ];
  const first = { type: 'first_meet', timestamp: '2023-01-04T20:00:00Z', location: 'wrld_b:9', worldName: 'Hub' };

  it('is the database’s oldest record, not the oldest of the ten the page returned', () => {
    const withDb = activityLog(window_, { limit: 5, oldest: first }).split('\n');
    expect(withDb.at(-1)).toContain('Hub');

    // And with more arrivals than rows, the gap stands between the window and that pin.
    const busy = Array.from({ length: 12 }, (_, i) => ({
      type: 'meet_again', timestamp: `2026-09-${String(10 + i).padStart(2, '0')}T10:00:00Z`,
      location: `wrld_a:${String(i)}`, worldName: 'Lotus',
    }));
    const capped = activityLog(busy, { limit: 5, oldest: first }).split('\n');
    expect(capped).toHaveLength(5);
    expect(capped.at(-2)).toBe('- ...');
    expect(capped.at(-1)).toContain('Hub');
  });

  it('is only as old as the window when the database was not readable', () => {
    expect(activityLog(window_, { limit: 5 })).not.toMatch(/Hub/);
  });

  it('is not duplicated when the window already reaches that far back', () => {
    const reaching = [...window_, first];
    const lines = activityLog(reaching, { limit: 5, oldest: first }).split('\n').filter((l) => l.includes('Hub'));
    expect(lines).toHaveLength(1);
  });
});

describe('the gap when the page simply had less to give', () => {
  // The real case: a player with 5121 recorded instances whose timeline read returns ten
  // records. Nothing is ever dropped from a twelve-row log, so counting the rows says "all of
  // it" — and eight lines ending five years ago render as one unbroken history.
  const window_ = [
    { type: 'meet_again', timestamp: '2026-10-02T22:00:00Z', location: 'wrld_a:1', worldName: 'Lotus' },
    { type: 'meet_again', timestamp: '2026-10-02T20:00:00Z', location: 'wrld_a:2', worldName: 'Lotus' },
  ];
  const first = { type: 'instance_join', timestamp: '2022-01-04T18:26:02Z', location: 'wrld_z:9', worldName: 'Virtual Apartment' };

  it('is drawn when the database knows of more instances than the log shows', () => {
    const lines = activityLog(window_, { limit: 12, oldest: first, instancesKnown: 5121 }).split('\n');
    expect(lines.at(-2)).toBe('- ...');
    expect(lines.at(-1)).toContain('Virtual Apartment');
  });

  it('is not drawn when the log already covers every instance there is', () => {
    const lines = activityLog(window_, { limit: 12, oldest: first, instancesKnown: 3 }).split('\n');
    expect(lines).not.toContain('- ...');
    expect(lines.at(-1)).toContain('Virtual Apartment');
  });

  it('is still drawn by truncation alone, with no database behind it', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      type: 'meet_again', timestamp: `2026-09-${String(10 + i).padStart(2, '0')}T10:00:00Z`,
      location: `wrld_a:${String(i)}`, worldName: 'Lotus',
    }));
    const lines = activityLog(many, { limit: 5 }).split('\n');
    expect(lines).toHaveLength(5);
    expect(lines.at(-2)).toBe('- ...');
  });
});
