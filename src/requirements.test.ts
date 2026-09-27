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
    avatarId: 'avtr_1',
    avatarName: 'Ava',
    avatarImageUrl: '',
    pcRank: 'Good',
    questRank: 'Poor',
    groupIds: ['grp_a'],
    rejoin: { seenHere: false, lastAt: undefined },
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
