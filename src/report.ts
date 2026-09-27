/**
 * A report, and everything a template may say about it.
 *
 * Three flavours per fact: the raw value for conditions (`rejoin`, `pcRank`), `…Text` for
 * wording, `…Emoji` for compact formats. The verdict comes as `result`, `resultText`,
 * `resultEmoji` and `resultColor`, and the individual checks as `checksText` (one line each).
 */

import {
  TemplateError,
  renderTemplate,
  timeAgo,
  type TemplateValues,
  type VrcInstance,
} from '@vrcnext/plugin-api';

import type { Facts, Joiner } from './facts.js';
import { VERDICT_COLOR, VERDICT_EMOJI, VERDICT_TEXT, type Evaluation } from './requirements.js';
import { DEFAULT_TEMPLATE, type Preset } from './settings.js';

export interface Report {
  readonly at: number;
  readonly preset: Preset;
  readonly joiner: Joiner;
  readonly instance: VrcInstance;
  readonly facts: Facts;
  readonly evaluation: Evaluation;
}

/** VRChat's performance rank colours, as emoji. */
const RANK_EMOJI: Readonly<Record<string, string>> = {
  Excellent: '🟢', Good: '🔵', Medium: '🟡', Poor: '🟠', VeryPoor: '🔴',
};

const PLATFORM_EMOJI: readonly (readonly [RegExp, string])[] = [
  [/windows/i, '🖥️'], [/android|quest/i, '📱'], [/ios/i, '🍎'],
];

function yesNo(value: boolean | undefined, unknown = 'Unknown'): string {
  if (value === undefined) return unknown;
  return value ? 'Yes' : 'No';
}

function triState(value: boolean | undefined, yes: string, no: string, unknown = '❔'): string {
  return value === undefined ? unknown : (value ? yes : no);
}

function rankText(rank: string): string {
  return rank === '' ? 'Unknown' : rank;
}

function rejoinText(facts: Facts): string {
  const { seenHere, lastAt } = facts.rejoin;
  if (seenHere === undefined) return 'Unknown';
  if (!seenHere) return 'No';
  return lastAt === undefined ? 'Yes' : `Yes (${timeAgo(lastAt)})`;
}

/** Everything a template may name. `undefined` means "not applicable", which drops the line. */
export function reportValues(report: Report): TemplateValues {
  const { facts, joiner, instance, evaluation, preset } = report;
  const at = new Date(report.at);
  const groupChecked = preset.requiredGroup !== '';
  // A membership the player hides cannot be called a "no": the check is unverified, and so is
  // the value a template sees.
  const groupVerdict = evaluation.checks.find((c) => c.key === 'group')?.verdict;
  const inGroup = groupVerdict === 'met' ? true : groupVerdict === 'failed' ? false : undefined;
  const failed = evaluation.checks.filter((c) => c.verdict === 'failed');
  const unverified = evaluation.checks.filter((c) => c.verdict === 'unverified');
  return {
    name: joiner.name,
    playerId: joiner.userId,
    userId: joiner.userId,
    preset: preset.name,
    result: evaluation.verdict,
    resultText: VERDICT_TEXT[evaluation.verdict],
    resultEmoji: VERDICT_EMOJI[evaluation.verdict],
    resultColor: VERDICT_COLOR[evaluation.verdict],
    checksText: evaluation.checks.map((c) => `${VERDICT_EMOJI[c.verdict]} ${c.label}: ${c.detail}`).join('\n'),
    checksPlainText: evaluation.checks.map((c) => `${c.label}: ${c.detail}`).join('\n'),
    failedText: failed.map((c) => `${c.label} (${c.detail})`).join(', '),
    unverifiedText: unverified.map((c) => `${c.label} (${c.detail})`).join(', '),
    ageVerified: facts.ageVerified,
    ageVerifiedText: facts.ageVerified === undefined
      ? 'Unknown'
      : `${yesNo(facts.ageVerified)}${facts.ageVerificationStatus === '' ? '' : ` (${facts.ageVerificationStatus})`}`,
    ageVerifiedEmoji: triState(facts.ageVerified, '✅', '❌'),
    ageStatus: facts.ageVerificationStatus,
    pcRank: facts.pcRank === '' ? undefined : facts.pcRank,
    pcRankText: rankText(facts.pcRank),
    pcRankEmoji: RANK_EMOJI[facts.pcRank] ?? '⚪',
    questRank: facts.questRank === '' ? undefined : facts.questRank,
    questRankText: rankText(facts.questRank),
    questRankEmoji: RANK_EMOJI[facts.questRank] ?? '⚪',
    avatar: facts.avatarName,
    avatarId: facts.avatarId,
    avatarImageUrl: facts.avatarImageUrl,
    platform: facts.platform,
    platformEmoji: PLATFORM_EMOJI.find(([re]) => re.test(facts.platform))?.[1] ?? '❔',
    isFriend: facts.isFriend,
    friendText: yesNo(facts.isFriend),
    inGroup,
    inGroupText: groupChecked ? yesNo(inGroup, 'Not visible') : undefined,
    inGroupEmoji: groupChecked ? triState(inGroup, '✅', '❔') : undefined,
    rejoin: facts.rejoin.seenHere,
    rejoinText: rejoinText(facts),
    rejoinEmoji: triState(facts.rejoin.seenHere, '🔁', '🆕'),
    rejoinAgo: facts.rejoin.lastAt === undefined ? '' : timeAgo(facts.rejoin.lastAt),
    rejoinSince: facts.rejoin.lastAt === undefined ? '' : new Date(facts.rejoin.lastAt).toLocaleString(),
    rejoinAt: facts.rejoin.lastAt ?? '',
    world: instance.worldName,
    worldId: instance.worldId,
    instanceType: instance.instanceType,
    instanceId: instance.instanceId,
    location: instance.location,
    time: at.toLocaleTimeString(),
    date: at.toLocaleDateString(),
    timestamp: at.toISOString(),
  };
}

/**
 * The report through a template, one line per entry. An empty template means the default; one
 * that does not parse falls back to it, with `onError` told why.
 */
export function reportLines(report: Report, template: string, onError?: (error: TemplateError) => void): readonly string[] {
  const chosen = template.trim() === '' ? DEFAULT_TEMPLATE : template;
  const values = reportValues(report);
  try {
    return renderTemplate(chosen, values).split('\n');
  } catch (error) {
    if (!(error instanceof TemplateError)) throw error;
    onError?.(error);
    return renderTemplate(DEFAULT_TEMPLATE, values).split('\n');
  }
}

/** Everything a single-line surface can hold. */
export function reportSummary(report: Report): string {
  const { facts, evaluation } = report;
  const bits = [
    VERDICT_TEXT[evaluation.verdict],
    `PC ${rankText(facts.pcRank).replace('Unknown', '?')}`,
    `Quest ${rankText(facts.questRank).replace('Unknown', '?')}`,
    facts.rejoin.seenHere === undefined ? 'rejoin ?' : (facts.rejoin.seenHere ? 'rejoin' : 'new'),
  ];
  return `${VERDICT_EMOJI[evaluation.verdict]} ${report.joiner.name} joined (${report.preset.name}) · ${bits.join(' · ')}`;
}
