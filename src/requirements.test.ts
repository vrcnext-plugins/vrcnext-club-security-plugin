import assert from 'node:assert/strict';
import { test } from 'vitest';

import { defaultsFor } from '@vrcnext/plugin-api';

import { UNKNOWN_FACTS, type Facts } from './facts.js';
import { AVATAR_CHECKS, evaluate, worst } from './requirements.js';
import { preset as presetSchema, type Preset } from './settings.js';

function facts(overrides: Partial<Facts> = {}): Facts {
  return {
    ...UNKNOWN_FACTS,
    ageVerified: true,
    ageVerificationStatus: '18+',
    isFriend: true,
    platform: 'standalonewindows',
    userImageUrl: 'https://img.test/u.png',
    avatarId: 'avtr_1',
    avatarName: 'Ava',
    avatarImageUrl: '',
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

function preset(overrides: Partial<Preset> = {}): Preset {
  return { ...defaultsFor(presetSchema), ...overrides };
}

test('everything verifiable and met is green', () => {
  const result = evaluate(preset({ minPcRank: 'Medium', requiredGroup: 'grp_a', requireFriend: true }), facts());
  assert.equal(result.verdict, 'met');
  assert.deepEqual(result.checks.map((c) => [c.key, c.verdict]), [['age', 'met'], ['pcRank', 'met'], ['group', 'met'], ['friend', 'met']]);
});

test('an unknown rank or a hidden age is orange, a verifiable miss is red', () => {
  assert.equal(evaluate(preset({ minPcRank: 'Medium' }), facts({ pcRank: '' })).verdict, 'unverified');
  assert.equal(evaluate(preset({ minPcRank: 'Medium' }), facts({ pcRank: 'VeryPoor' })).verdict, 'failed');
  assert.equal(evaluate(preset(), facts({ ageVerified: false, ageVerificationStatus: 'hidden' })).verdict, 'unverified');
  assert.equal(evaluate(preset(), facts({ ageVerified: false, ageVerificationStatus: '' })).verdict, 'unverified');
  assert.equal(evaluate(preset(), facts({ ageVerified: true, ageVerificationStatus: 'verified' })).verdict, 'failed');
  assert.equal(evaluate(preset({ requireFriend: true }), facts({ isFriend: false })).verdict, 'failed');
});

test('a membership that is not shown cannot be called a failure', () => {
  const result = evaluate(preset({ requiredGroup: 'GRP_B' }), facts({ groupIds: ['grp_a'] }));
  assert.equal(result.verdict, 'unverified');
  assert.equal(evaluate(preset({ requiredGroup: 'grp_a' }), facts()).verdict, 'met', 'case-insensitive');
  const unknown = evaluate(preset({ requiredGroup: 'grp_a' }), facts({ groupIds: undefined }));
  assert.equal(unknown.checks.find((c) => c.key === 'group')?.detail, 'groups unknown');
});

test('a preset with no requirements is met, and the worst verdict wins', () => {
  assert.equal(evaluate(preset({ requireAge: false }), facts({ pcRank: '' })).verdict, 'met');
  assert.equal(worst(['met', 'unverified', 'failed']), 'failed');
  assert.equal(worst(['met', 'unverified']), 'unverified');
  assert.equal(worst([]), 'met');
});

test('an avatar switch is judged on the avatar checks alone', () => {
  const strict = preset({ requireAge: true, requireFriend: true, minPcRank: 'Medium' });
  const worn = facts({ pcRank: 'VeryPoor' });

  const full = evaluate(strict, worn);
  assert.ok(full.checks.length > 1);

  const avatarOnly = evaluate(strict, worn, { only: AVATAR_CHECKS });
  assert.deepEqual(avatarOnly.checks.map((c) => c.key), ['pcRank']);
  assert.equal(avatarOnly.verdict, 'failed');
});

test('every check names itself in the few words a pill can hold', () => {
  const strict = preset({ requireAge: true, minPcRank: 'Poor', minQuestRank: 'Medium' });
  const checks = evaluate(strict, facts({ pcRank: 'VeryPoor', questRank: 'Good' })).checks;
  assert.deepEqual(checks.map((c) => c.short), ['18+', 'PC Very Poor', 'Quest Good']);

  const unknown = evaluate(strict, facts({ pcRank: '', questRank: '' })).checks;
  assert.deepEqual(unknown.map((c) => c.short), ['18+', 'PC unknown', 'Quest unknown']);
});

const TRUSTED = { percent: 97, criteria: [], description: 'Trusted.' };

test('a trust score of zero asks for nothing, so the report never mentions one', () => {
  const result = evaluate(preset({ minTrustScore: 0 }), facts({ trust: TRUSTED }));
  assert.equal(result.checks.some((c) => c.key === 'trust'), false);
});

test('a trust requirement is a check like any other, and counts in the verdict', () => {
  const met = evaluate(preset({ minTrustScore: 90 }), facts({ trust: TRUSTED })).checks.find((c) => c.key === 'trust');
  assert.ok(met, 'the check must be there once a preset asks for one');
  assert.equal(met.verdict, 'met');
  assert.equal(met.detail, '97%');
  assert.match(met.short, /Trust 97%/);

  const failed = evaluate(preset({ minTrustScore: 98 }), facts({ trust: TRUSTED }));
  assert.equal(failed.verdict, 'failed', 'a score under the bar fails the report');
  assert.equal(failed.checks.find((c) => c.key === 'trust')?.detail, '97%, needs 98%');
});

test('a profile that could not be read is unverified, never the joiner\'s fault', () => {
  const result = evaluate(preset({ minTrustScore: 50 }), facts({ trust: undefined }));
  assert.equal(result.checks.find((c) => c.key === 'trust')?.verdict, 'unverified');
  assert.equal(result.verdict, 'unverified');
});

test('an avatar switch is judged on the avatar alone, trust included', () => {
  const result = evaluate(preset({ minTrustScore: 99 }), facts({ trust: TRUSTED }), { only: AVATAR_CHECKS });
  assert.equal(result.checks.some((c) => c.key === 'trust'), false);
});

test('an avatar switch into an unknown rank is a warning, and a good one is still a report', () => {
  const watching = preset({ minPcRank: 'Medium', requireAge: true, requiredGroup: 'grp_a' });

  const unknown = evaluate(watching, facts({ pcRank: '', questRank: '' }), { only: AVATAR_CHECKS });
  assert.equal(unknown.verdict, 'unverified', 'a rank VRChat did not give is not a pass');
  assert.deepEqual(unknown.checks.map((c) => c.detail), ['rank unknown'], 'and the age and group checks stay out of it');

  const good = evaluate(watching, facts({ pcRank: 'Excellent' }), { only: AVATAR_CHECKS });
  assert.equal(good.verdict, 'met');
  assert.equal(good.checks.length, 1, 'a check it passed is still a check, so the switch is still reported');

  // Neither floor set: nothing to judge the new avatar against, so there is no report to send.
  assert.deepEqual(evaluate(preset({ requireAge: true }), facts({ pcRank: '' }), { only: AVATAR_CHECKS }).checks, []);
});

test('iOS is a rank floor like the other two, and judged from the avatar’s iOS build', () => {
  const p = preset({ minIosRank: 'Good' });
  const met = evaluate(p, facts({ iosRank: 'Excellent' })).checks.find((c) => c.key === 'iosRank');
  assert.deepEqual([met?.verdict, met?.short], ['met', 'iOS Excellent']);

  const missed = evaluate(p, facts({ iosRank: 'Poor' })).checks.find((c) => c.key === 'iosRank');
  assert.deepEqual([missed?.verdict, missed?.detail], ['failed', 'Poor, needs Good or better']);

  // An avatar with no iOS build has no iOS rank, which is unverified rather than a failure:
  // most avatars have none, and "not built for iOS" is not "built badly".
  const absent = evaluate(p, facts({ iosRank: '' })).checks.find((c) => c.key === 'iosRank');
  assert.deepEqual([absent?.verdict, absent?.short], ['unverified', 'iOS unknown']);

  const off = evaluate(preset({ minIosRank: 'any' }), facts({ iosRank: '' })).checks.filter((c) => c.key === 'iosRank');
  assert.deepEqual(off, [], 'the lowest option checks nothing at all');
});

test('VeryPoor or better demands a rank; Unknown or better demands nothing', () => {
  // The two rungs read like synonyms and are not, which is why the lowest is labelled as part
  // of the same scale rather than as "Any".
  const unrated = facts({ pcRank: '' });
  const unchecked = evaluate(preset({ minPcRank: 'any' }), unrated).checks.filter((c) => c.key === 'pcRank');
  assert.deepEqual(unchecked, [], 'Unknown or better measures nothing');

  const floored = evaluate(preset({ minPcRank: 'VeryPoor' }), unrated).checks.find((c) => c.key === 'pcRank');
  assert.equal(floored?.verdict, 'unverified', 'an avatar nothing can rank does not clear the lowest floor');

  // Every rank that exists does clear it, which is the other half of the meaning.
  for (const rank of ['Excellent', 'Good', 'Medium', 'Poor', 'VeryPoor'] as const) {
    const check = evaluate(preset({ minPcRank: 'VeryPoor' }), facts({ pcRank: rank })).checks.find((c) => c.key === 'pcRank');
    assert.equal(check?.verdict, 'met', `${rank} clears the lowest floor`);
  }
});
