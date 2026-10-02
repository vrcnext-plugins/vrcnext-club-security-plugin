import assert from 'node:assert/strict';
import { test } from 'vitest';

import { defaultsFor, renderEmbed } from '@vrcnext/plugin-api';

import type { Facts } from './facts.js';
import { reportLines, reportSummary, reportValues, type Report } from './report.js';
import { evaluate } from './requirements.js';
import { DEFAULT_EMBED, embedOf, preset as presetSchema, type Preset } from './settings.js';
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

test('the title counts the preset\'s own history of them, and says nothing without one', () => {
  const title = (r: Report): unknown =>
    renderEmbed(completeEmbed(DEFAULT_EMBED), reportValues(r), { at: new Date(0) })?.title;

  assert.equal(title(report()), '"Tupper" joined',
    'no timeline, so the count is dropped rather than claiming this is their first');

  const elsewhere = 'wrld_b:7~group(grp_a)~groupAccessType(public)';
  const seen = report({ group: 'grp_a' }, {
    timeline: [
      { id: '1', type: 'meet_again', timestamp: '2026-09-01T12:00:00Z', location: elsewhere, worldName: 'Other' },
      { id: '2', type: 'instance_join', timestamp: '2026-09-20T12:00:00Z', location: elsewhere, worldName: 'Other' },
    ],
    rejoin: { seenHere: true, lastAt: '2026-09-20T12:00:00Z' },
  });
  assert.equal(title(seen), '"Tupper" rejoined for the 2nd event',
    'one instance in the history plus the one they are in now');
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
  assert.equal(embed.title, '"Tupper" joined', 'quoted, so a display name cannot read as part of the sentence');
  assert.equal(embed.url, undefined, 'the title does not navigate; the author line carries the profile');
  assert.deepEqual(embed.author, {
    name: 'usr_1',
    url: 'https://vrchat.com/home/user/usr_1',
    icon_url: 'https://img.test/u.png',
  });
  assert.equal(embed.color, 0x3ba55d);
  assert.deepEqual(embed.thumbnail, { url: 'https://img.test/a.png' });
  assert.equal(embed.footer?.text, 'VRCNext · Club · The Club · #1 · Group Public');
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

test('the embed follows the plugin\'s own until a club switches to its own', () => {
  const defaults = defaultsFor(presetSchema);
  const mine = { ...completeEmbed(DEFAULT_EMBED), title: 'mine' };
  const off: Preset = { ...defaults, discord: { ...defaults.discord, useCustomEmbed: false, embed: mine } };
  assert.equal(embedOf(off).title, DEFAULT_EMBED.title, 'off means the plugin\'s wording');

  const on: Preset = { ...off, discord: { ...off.discord, useCustomEmbed: true } };
  assert.equal(embedOf(on).title, 'mine');
  // The point of hiding rather than clearing: turning it off leaves the club's embed intact.
  assert.equal(off.discord.embed.title, 'mine');
});

/** `requirementsText` is one of the template's values, typed as anything a template may hold. */
function text(values: Record<string, unknown>, key: string): string {
  const value = values[key];
  assert.equal(typeof value, 'string', `${key} should render as text`);
  return value as string;
}

test('a requirement that measured something says the measurement, passed or not', () => {
  const scored = { percent: 97, criteria: [], description: 'Trusted.' };
  const met = reportValues(report({ minTrustScore: 75 }, { trust: scored }));
  assert.match(text(met, 'requirementsText'), /Trust score: ✅ \*\*97%\*\*/);

  const under = reportValues(report({ minTrustScore: 98 }, { trust: scored }));
  assert.match(text(under, 'requirementsText'), /Trust score: ⛔ \*\*97%, needs 98%\*\*/);

  // A requirement with nothing to measure still says only whether it holds.
  assert.match(text(met, 'requirementsText'), /18\+ verified: ✅(\n|$)/);
});

test('a template can name what the preset asked for, not only what the joiner was', () => {
  const values = reportValues(report({ minTrustScore: 75, minQuestRank: 'Good', requireFriend: true }));
  assert.equal(values['presetRequiredTrustScore'], '75%');
  assert.equal(values['presetRequiredPcRank'], 'Medium');
  assert.equal(values['presetRequiredQuestRank'], 'Good');
  assert.equal(values['presetRequiredGroup'], 'grp_a');
  assert.equal(values['presetRequiredAge'], '18+');
  assert.equal(values['presetRequiredFriend'], 'Friend');
});

test('a requirement the preset does not check has no value, so a line naming it is dropped', () => {
  const values = reportValues(report({
    minTrustScore: 0, minPcRank: 'any', minQuestRank: 'any', requiredGroup: '', requireAge: false, requireFriend: false,
  }));
  for (const key of [
    'presetRequiredTrustScore', 'presetRequiredPcRank', 'presetRequiredQuestRank',
    'presetRequiredGroup', 'presetRequiredAge', 'presetRequiredFriend',
  ]) {
    assert.equal(values[key], undefined, `${key} should be absent, not "any"`);
  }
});
