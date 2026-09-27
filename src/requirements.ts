/**
 * Checks a joiner against a preset's requirements.
 *
 * Every check ends in one of three verdicts, and the report's colour is the worst of them:
 *
 * - `met` (green, ✅): the requirement holds and could be verified.
 * - `unverified` (orange, ⚠️): it could not be checked — an unknown avatar rank, a hidden age
 *   status, a membership the player does not show.
 * - `failed` (red, ⛔): it was checked and does not hold.
 */

import { rankIndex } from '@vrcnext/plugin-api';

import type { Facts } from './facts.js';
import type { Preset } from './settings.js';

export type Verdict = 'met' | 'unverified' | 'failed';

export interface Check {
  readonly key: 'age' | 'pcRank' | 'questRank' | 'group' | 'friend';
  readonly label: string;
  readonly verdict: Verdict;
  /** Why, in a few words. */
  readonly detail: string;
}

export interface Evaluation {
  readonly verdict: Verdict;
  readonly checks: readonly Check[];
}

export const VERDICT_EMOJI: Readonly<Record<Verdict, string>> = { met: '✅', unverified: '⚠️', failed: '⛔' };
export const VERDICT_COLOR: Readonly<Record<Verdict, string>> = { met: 'green', unverified: 'orange', failed: 'red' };
export const VERDICT_TEXT: Readonly<Record<Verdict, string>> = {
  met: 'All requirements met',
  unverified: 'Some requirements unverified',
  failed: 'Requirements not met',
};

function ageCheck(facts: Facts): Check {
  const status = facts.ageVerificationStatus;
  if (status === '18+') return { key: 'age', label: '18+ verified', verdict: 'met', detail: '18+' };
  if (status === 'verified') return { key: 'age', label: '18+ verified', verdict: 'failed', detail: 'verified, not 18+' };
  if (facts.ageVerified === true) return { key: 'age', label: '18+ verified', verdict: 'met', detail: 'verified' };
  const detail = status === 'hidden' ? 'hidden' : facts.ageVerified === false ? 'not verified' : 'unknown';
  return { key: 'age', label: '18+ verified', verdict: 'unverified', detail };
}

function rankCheck(key: 'pcRank' | 'questRank', label: string, rank: string, minimum: string): Check {
  const have = rankIndex(rank);
  const want = rankIndex(minimum);
  if (have === undefined || want === undefined) return { key, label, verdict: 'unverified', detail: 'rank unknown' };
  return have <= want
    ? { key, label, verdict: 'met', detail: rank }
    : { key, label, verdict: 'failed', detail: `${rank}, needs ${minimum} or better` };
}

function groupCheck(facts: Facts, groupId: string): Check {
  const label = 'Group member';
  if (facts.groupIds === undefined) return { key: 'group', label, verdict: 'unverified', detail: 'groups unknown' };
  const member = facts.groupIds.some((id) => id.toLowerCase() === groupId.toLowerCase());
  return member
    ? { key: 'group', label, verdict: 'met', detail: 'member' }
    : { key: 'group', label, verdict: 'unverified', detail: 'not among visible memberships' };
}

function friendCheck(facts: Facts): Check {
  const label = 'On friend list';
  if (facts.isFriend === undefined) return { key: 'friend', label, verdict: 'unverified', detail: 'unknown' };
  return facts.isFriend
    ? { key: 'friend', label, verdict: 'met', detail: 'friend' }
    : { key: 'friend', label, verdict: 'failed', detail: 'not a friend' };
}

/** The worst verdict wins: one failure makes the report red, otherwise one unknown makes it orange. */
export function worst(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.includes('failed')) return 'failed';
  if (verdicts.includes('unverified')) return 'unverified';
  return 'met';
}

export function evaluate(preset: Preset, facts: Facts): Evaluation {
  const checks: Check[] = [];
  if (preset.requireAge) checks.push(ageCheck(facts));
  if (preset.minPcRank !== 'any') checks.push(rankCheck('pcRank', 'PC avatar rank', facts.pcRank, preset.minPcRank));
  if (preset.minQuestRank !== 'any') checks.push(rankCheck('questRank', 'Quest avatar rank', facts.questRank, preset.minQuestRank));
  if (preset.requiredGroup !== '') checks.push(groupCheck(facts, preset.requiredGroup));
  if (preset.requireFriend) checks.push(friendCheck(facts));
  return { verdict: worst(checks.map((c) => c.verdict)), checks };
}
