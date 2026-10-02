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

import { rankIndex, rankLabel, trustScoreEmoji } from '@vrcnext/plugin-api';

import type { Facts } from './facts.js';
import type { Preset } from './settings.js';

export type Verdict = 'met' | 'unverified' | 'failed';

export interface Check {
  readonly key: 'age' | 'pcRank' | 'questRank' | 'iosRank' | 'group' | 'friend' | 'trust';
  readonly label: string;
  /** Two or three words for a pill, where the colour already says whether it holds. */
  readonly short: string;
  readonly verdict: Verdict;
  /** Why, in a few words. */
  readonly detail: string;
  /**
   * The measurement itself, when it is worth reading even though the check passed.
   *
   * A tick answers "does it hold?", which is all most requirements have to say. A score answers
   * "by how much?", and 97% against a floor of 75% is worth seeing — so a check may carry the
   * number and the report prints it beside the tick.
   */
  readonly valueText?: string;
}

export interface Evaluation {
  readonly verdict: Verdict;
  readonly checks: readonly Check[];
}

export const VERDICT_EMOJI: Readonly<Record<Verdict, string>> = { met: '✅', unverified: '⚠️', failed: '⛔' };
export const VERDICT_COLOR: Readonly<Record<Verdict, string>> = { met: 'green', unverified: 'orange', failed: 'red' };

/**
 * What each check is *about*, for a surface where the verdict is already the colour.
 *
 * On the page a pill is coloured by its verdict, so a tick in front of it says the same thing
 * twice and the one thing the pill cannot show — which requirement this is — has to be read from
 * the words. These say it at a glance instead. Text surfaces keep {@link VERDICT_EMOJI}, where
 * there is no colour to carry the verdict.
 */
export const CHECK_EMOJI: Readonly<Record<Check['key'], string>> = {
  age: '🔞',
  pcRank: '🖥️',
  questRank: '📱',
  iosRank: '🍏',
  group: '👥',
  friend: '🤝',
  trust: '🛡️',
};
export const VERDICT_TEXT: Readonly<Record<Verdict, string>> = {
  met: 'All requirements met',
  unverified: 'Some requirements unverified',
  failed: 'Requirements not met',
};

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

/** What each rank check calls its platform, in the two or three words a pill has room for. */
const RANK_PLATFORM: Readonly<Record<'pcRank' | 'questRank' | 'iosRank', string>> = {
  pcRank: 'PC',
  questRank: 'Quest',
  iosRank: 'iOS',
};

function rankCheck(key: 'pcRank' | 'questRank' | 'iosRank', label: string, rank: string, minimum: string): Check {
  const platform = RANK_PLATFORM[key];
  const have = rankIndex(rank);
  const want = rankIndex(minimum);
  if (have === undefined || want === undefined) {
    return { key, label, short: `${platform} unknown`, verdict: 'unverified', detail: 'rank unknown' };
  }
  const short = `${platform} ${rankLabel(rank)}`;
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

/**
 * The profile score, as a requirement rather than a number on the side.
 *
 * A standing is only worth printing when someone asked for one, and once a preset does ask, the
 * percentage belongs with the other checks: read in one place, coloured by whether it passes,
 * counted in the verdict. A profile that could not be read is unverified, never a failure —
 * VRCNext not answering is not the joiner's doing.
 */
function trustCheck(facts: Facts, minimum: number): Check {
  // Named like every other check, without the floor: the lines read as a column that way, and the
  // floor is only news when it is missed, where `detail` already says "needs 98%". A template that
  // does want it has `{presetRequiredTrustScore}`.
  const label = 'Trust score';
  if (facts.trust === undefined) {
    return { key: 'trust', label, short: 'Trust unknown', verdict: 'unverified', detail: 'profile unreadable' };
  }
  const percent = facts.trust.percent;
  const short = `${trustScoreEmoji(percent)} Trust ${String(percent)}%`;
  const valueText = `${String(percent)}%`;
  return percent >= minimum
    ? { key: 'trust', label, short, verdict: 'met', detail: valueText, valueText }
    : { key: 'trust', label, short, verdict: 'failed', detail: `${valueText}, needs ${String(minimum)}%`, valueText };
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
export const AVATAR_CHECKS: readonly Check['key'][] = ['pcRank', 'questRank', 'iosRank'];

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
  if (preset.minIosRank !== 'any' && wanted('iosRank')) checks.push(rankCheck('iosRank', 'iOS avatar rank', facts.iosRank, preset.minIosRank));
  if (preset.requiredGroup !== '' && wanted('group')) checks.push(groupCheck(facts, preset.requiredGroup));
  if (preset.requireFriend && wanted('friend')) checks.push(friendCheck(facts));
  // Zero is "any": every profile clears it, so asking for it would only print a line nobody set.
  if (preset.minTrustScore > 0 && wanted('trust')) checks.push(trustCheck(facts, preset.minTrustScore));
  return { verdict: worst(checks.map((c) => c.verdict)), checks };
}
