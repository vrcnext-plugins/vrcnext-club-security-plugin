import assert from 'node:assert/strict';
import { test } from 'vitest';

import { defaultsFor } from '@vrcnext/plugin-api';

import type { Facts } from './facts.js';
import { AVATAR_CHECKS, evaluate, worst } from './requirements.js';
import { preset as presetSchema, type Preset } from './settings.js';

function facts(overrides: Partial<Facts> = {}): Facts {
  return {
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
