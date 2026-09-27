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
  /** Two or three words for a pill, where the colour already says whether it holds. */
  readonly short: string;
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

/** VRChat spells the worst rank `VeryPoor`; nobody says it that way. */
export function rankText(rank: string): string {
  return rank === '' ? 'Unknown' : rank.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function ageCheck(facts: Facts): Check {
  const status = facts.ageVerificationStatus;
  const label = '18+ verified';
  const short = '18+';
  if (status === '18+') return { key: 'age', label, short, verdict: 'met', detail: '18+' };
  if (status === 'verified') return { key: 'age', label, short, verdict: 'failed', detail: 'verified, not 18+' };
  if (facts.ageVerified === true) return { key: 'age', label, short, verdict: 'met', detail: 'verified' };
  const detail = status === 'hidden' ? 'hidden' : facts.ageVerified === false ? 'not verified' : 'unknown';
  return { key: 'age', label, short, verdict: 'unverified', detail };
}

function rankCheck(key: 'pcRank' | 'questRank', label: string, rank: string, minimum: string): Check {
  const platform = key === 'pcRank' ? 'PC' : 'Quest';
  const have = rankIndex(rank);
  const want = rankIndex(minimum);
  if (have === undefined || want === undefined) {
    return { key, label, short: `${platform} unknown`, verdict: 'unverified', detail: 'rank unknown' };
  }
  const short = `${platform} ${rankText(rank)}`;
  return have <= want
    ? { key, label, short, verdict: 'met', detail: rank }
    : { key, label, short, verdict: 'failed', detail: `${rank}, needs ${minimum} or better` };
}

function groupCheck(facts: Facts, groupId: string): Check {
  const label = 'Group member';
  if (facts.groupIds === undefined) {
    return { key: 'group', label, short: 'Group unknown', verdict: 'unverified', detail: 'groups unknown' };
  }
  const member = facts.groupIds.some((id) => id.toLowerCase() === groupId.toLowerCase());
  return member
    ? { key: 'group', label, short: 'Group member', verdict: 'met', detail: 'member' }
    : { key: 'group', label, short: 'Group member', verdict: 'unverified', detail: 'not among visible memberships' };
}

function friendCheck(facts: Facts): Check {
  const label = 'On friend list';
  const short = 'Friend';
  if (facts.isFriend === undefined) return { key: 'friend', label, short, verdict: 'unverified', detail: 'unknown' };
  return facts.isFriend
    ? { key: 'friend', label, short, verdict: 'met', detail: 'friend' }
    : { key: 'friend', label, short, verdict: 'failed', detail: 'not a friend' };
}

/** The worst verdict wins: one failure makes the report red, otherwise one unknown makes it orange. */
export function worst(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.includes('failed')) return 'failed';
  if (verdicts.includes('unverified')) return 'unverified';
  return 'met';
}

/** The two checks that describe an avatar, which is all an avatar switch can be judged on. */
export const AVATAR_CHECKS: readonly Check['key'][] = ['pcRank', 'questRank'];

export interface EvaluateOptions {
  /** Only these checks; the rest are not run and not reported. Everything, when absent. */
  readonly only?: readonly Check['key'][];
}

export function evaluate(preset: Preset, facts: Facts, options: EvaluateOptions = {}): Evaluation {
  const wanted = (key: Check['key']): boolean => options.only === undefined || options.only.includes(key);
  const checks: Check[] = [];
  if (preset.requireAge && wanted('age')) checks.push(ageCheck(facts));
  if (preset.minPcRank !== 'any' && wanted('pcRank')) checks.push(rankCheck('pcRank', 'PC avatar rank', facts.pcRank, preset.minPcRank));
  if (preset.minQuestRank !== 'any' && wanted('questRank')) checks.push(rankCheck('questRank', 'Quest avatar rank', facts.questRank, preset.minQuestRank));
  if (preset.requiredGroup !== '' && wanted('group')) checks.push(groupCheck(facts, preset.requiredGroup));
  if (preset.requireFriend && wanted('friend')) checks.push(friendCheck(facts));
  return { verdict: worst(checks.map((c) => c.verdict)), checks };
}
