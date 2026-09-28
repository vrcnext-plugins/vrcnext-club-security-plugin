/**
 * What a refused webhook is told to the user.
 *
 * A status code alone is a number to go and look up, and the causes here have different fixes:
 * a deleted webhook wants the settings opened, a rate limit wants nothing done at all.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import { webhookFailure } from './notify.js';

test('a refused webhook is explained as something to do, not as a number', () => {
  assert.match(webhookFailure(401), /regenerated or the URL is mis-copied/);
  assert.match(webhookFailure(403), /Server Settings → Integrations → Webhooks/);
  assert.match(webhookFailure(404), /no longer exists/);
  assert.match(webhookFailure(429), /rate-limiting/);
  assert.match(webhookFailure(400), /refused the embed/);
  assert.match(webhookFailure(503), /their side, not the preset/);
});

test('an unexpected status is still reported rather than swallowed', () => {
  assert.equal(webhookFailure(418), 'Discord answered 418.');
});
