import assert from 'node:assert/strict';
import { test } from 'vitest';

import { defaultsFor, renderEmbed } from '@vrcnext/plugin-api';

import type { Facts } from './facts.js';
import { reportLines, reportSummary, reportValues, type Report } from './report.js';
import { evaluate } from './requirements.js';
import { DEFAULT_EMBED, preset as presetSchema, type Preset } from './settings.js';
import { completeEmbed } from '@vrcnext/plugin-api';

function facts(overrides: Partial<Facts> = {}): Facts {
  return {
    ageVerified: true,
    ageVerificationStatus: '18+',
    isFriend: false,
    platform: 'standalonewindows',
    userImageUrl: 'https://img.test/u.png',
    avatarId: 'avtr_1',
    avatarName: 'Ava',
    avatarImageUrl: 'https://img.test/a.png',
    pcRank: 'Good',
    questRank: 'Poor',
    groupIds: ['grp_a'],
    rejoin: { seenHere: false, lastAt: undefined },
    timeline: undefined,
    timelineGroups: new Map(),
    trust: undefined,
    ...overrides,
  };
}

function report(presetOverrides: Partial<Preset> = {}, factOverrides: Partial<Facts> = {}): Report {
  const preset: Preset = { ...defaultsFor(presetSchema), name: 'Club', minPcRank: 'Medium', requiredGroup: 'grp_a', ...presetOverrides };
  const f = facts(factOverrides);
  return {
    at: Date.parse('2026-09-27T12:00:00Z'),
    preset,
    joiner: { name: 'Tupper', userId: 'usr_1' },
    instance: {
      location: 'wrld_a:1~group(grp_a)~groupAccessType(public)', worldId: 'wrld_a', worldName: 'The Club', worldThumbnailUrl: '',
      instanceId: '1', instanceType: 'group-public', groupId: 'grp_a', region: 'eu', userCount: 1, capacity: 40, users: [],
    },
    facts: f,
    evaluation: evaluate(preset, f),
  };
}

test('the default template leads with the verdict and lists every check', () => {
  const lines = reportLines(report(), '');
  assert.equal(lines[0], '✅ Tupper joined · Club');
  assert.deepEqual(lines.slice(1, 4), ['✅ 18+ verified: 18+', '✅ PC avatar rank: Good', '✅ Group member: member']);
  assert.equal(lines[4], 'Avatar: Ava (PC Good · Quest Poor)');
  assert.equal(lines.length, 5, 'the rejoin line is dropped for a first visit');
});

test('verdict variables follow the worst check', () => {
  const values = reportValues(report({}, { pcRank: 'VeryPoor' }));
  assert.deepEqual([values['result'], values['resultEmoji'], values['resultColor']], ['failed', '⛔', 'red']);
  assert.equal(values['failedText'], 'PC avatar rank (VeryPoor, needs Medium or better)');
  const unknown = reportValues(report({}, { pcRank: '' }));
  assert.deepEqual([unknown['result'], unknown['resultColor']], ['unverified', 'orange']);
  assert.equal(unknown['unverifiedText'], 'PC avatar rank (rank unknown)');
});

test('the default embed renders with the verdict colour and the avatar thumbnail', () => {
  const embed = renderEmbed(completeEmbed(DEFAULT_EMBED), reportValues(report()), { at: new Date(0) });
  assert.ok(embed !== undefined);
  assert.equal(embed.title, 'Tupper joined');
  assert.equal(embed.url, undefined, 'the title does not navigate; the author line carries the profile');
  assert.deepEqual(embed.author, {
    name: 'usr_1',
    url: 'https://vrchat.com/home/user/usr_1',
    icon_url: 'https://img.test/u.png',
  });
  assert.equal(embed.color, 0x3ba55d);
  assert.deepEqual(embed.thumbnail, { url: 'https://img.test/a.png' });
  assert.equal(embed.footer?.text, 'VRCNext Club Security · Club · The Club · #1 · Group Public');
});

test('the embed puts the requirements and the avatar side by side', () => {
  const embed = renderEmbed(
    completeEmbed(DEFAULT_EMBED),
    reportValues(report({}, { pcRank: 'VeryPoor', groupIds: undefined })),
    { at: new Date(0) },
  );
  assert.ok(embed !== undefined);
  const fields = embed.fields ?? [];
  const requirements = fields[0];
  const avatar = fields[1];
  assert.ok(requirements !== undefined && avatar !== undefined);
  // A check that passed says so with a tick; one that did not carries the reason, in bold.
  assert.equal(
    requirements.value,
    '18+ verified: ✅\nPC avatar rank: ⛔ **VeryPoor, needs Medium or better**\nGroup member: ⚠️ **groups unknown**',
  );
  assert.equal(requirements.inline, true);
  assert.equal(avatar.value, '["Ava"](https://vrchat.com/home/avatar/avtr_1)\n- 🖥️ PC: 🔴 Very Poor\n- 📱 Quest: 🟠 Poor');
});

test('the activity field is dropped when VRCNext has no history for the player', () => {
  const withLog = renderEmbed(
    completeEmbed(DEFAULT_EMBED),
    reportValues(report({}, {
      timeline: [{ type: 'friend_avatar', timestamp: '2026-09-27T10:00:00Z', location: '', worldName: '' }],
    })),
    { at: new Date(0) },
  );
  assert.ok(withLog !== undefined);
  const logged = withLog.fields ?? [];
  assert.equal(logged.length, 3);
  assert.equal(logged[2]?.value, '- Changed avatar <t:1790503200:R>');

  // `renderEmbed` drops a field that rendered empty, so a stranger's report is two fields.
  const without = renderEmbed(completeEmbed(DEFAULT_EMBED), reportValues(report()), { at: new Date(0) });
  assert.ok(without !== undefined);
  assert.equal((without.fields ?? []).length, 2);
});

test('a custom template picks its own facts; a broken one falls back and reports', () => {
  const lines = reportLines(report({}, { rejoin: { seenHere: true, lastAt: new Date(Date.now() - 3 * 3_600_000).toISOString() } }), '{name} {{ "is back" if rejoin else "is new" }} {rejoinAgo}\n{inGroupText}');
  assert.deepEqual(lines, ['Tupper is back 3 hours ago', 'Yes']);
  const errors: string[] = [];
  assert.equal(reportLines(report(), '{{ name', (e) => { errors.push(e.message); })[0], '✅ Tupper joined · Club');
  assert.equal(errors.length, 1);
});

test('group values only exist when the preset checks a group', () => {
  const values = reportValues(report({ requiredGroup: '' }));
  assert.equal(values['inGroupText'], undefined);
  assert.equal(reportValues(report({}, { groupIds: ['grp_other'] }))['inGroupText'], 'Not visible');
});

test('reportSummary fits one line', () => {
  assert.equal(reportSummary(report()), '✅ Tupper joined (Club) · All requirements met · PC Good · Quest Poor · new');
});

test('the trust score is a coloured percentage, and its field goes when there is no profile', () => {
  const scored = reportValues(report({}, { trust: { percent: 100, criteria: [], description: 'Trusted.' } }));
  assert.equal(scored['trustScoreText'], '🟢 **100**%');
  assert.equal(scored['trustScore'], 100);

  const low = reportValues(report({}, { trust: { percent: 80, criteria: [], description: 'High.' } }));
  assert.equal(low['trustScoreText'], '🟡 **80**%');

  assert.equal(reportValues(report())['trustScoreText'], undefined);
  const embed = renderEmbed(completeEmbed(DEFAULT_EMBED), reportValues(report()));
  assert.ok(!(embed?.fields ?? []).some((f) => f.name === 'Trust Score'));
});
