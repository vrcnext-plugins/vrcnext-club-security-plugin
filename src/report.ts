/**
 * A report, and everything a template may say about it.
 *
 * Three flavours per fact: the raw value for conditions (`rejoin`, `pcRank`), `…Text` for
 * wording, `…Emoji` for compact formats. The verdict comes as `result`, `resultText`,
 * `resultEmoji` and `resultColor`, and the individual checks as `checksText` (one line each).
 */

import {
  TemplateError,
  instanceTypeLabel,
  rankEmoji,
  rankLabel,
  renderTemplate,
  trustScoreEmoji,
  timeAgo,
  type TemplateValues,
  type VrcInstance,
} from '@vrcnext/plugin-api';

import { activityLog } from './activity.js';
import type { Facts, Joiner } from './facts.js';
import { VERDICT_COLOR, VERDICT_EMOJI, VERDICT_TEXT, type Evaluation } from './requirements.js';
import { DEFAULT_TEMPLATE, type Preset } from './settings.js';

/** Why a report exists: someone arrived, or someone already here changed avatar. */
export type ReportKind = 'join' | 'avatar';

export interface Report {
  readonly at: number;
  /** `join` unless stated; an `avatar` report only carries the avatar checks. */
  readonly kind?: ReportKind;
  readonly preset: Preset;
  readonly joiner: Joiner;
  readonly instance: VrcInstance;
  readonly facts: Facts;
  readonly evaluation: Evaluation;
}

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

/** `https://vrchat.com/home/user/usr_…`, or `''` when there is no id to link to. */
function vrchatUrl(kind: 'user' | 'avatar' | 'world' | 'group', id: string): string {
  return id === '' ? '' : `https://vrchat.com/home/${kind}/${id}`;
}

/**
 * The checks as Discord lines: `18+ verified: ✅`, `PC avatar rank: ⛔ **Very Poor**`.
 *
 * A check that passed needs no words — the tick says it. One that did not is the reason the
 * report was worth reading, so its detail is bold.
 */
function requirementsText(checks: Evaluation['checks']): string {
  return checks
    .map((check) => {
      const emoji = VERDICT_EMOJI[check.verdict];
      const label = check.label.charAt(0).toUpperCase() + check.label.slice(1);
      return check.verdict === 'met' ? `${label}: ${emoji}` : `${label}: ${emoji} **${check.detail}**`;
    })
    .join('\n');
}

/** One line per platform the avatar was rated on, skipping the ones VRChat says nothing about. */
function ranksText(facts: Facts): string {
  const lines = [
    ['🖥️ PC', facts.pcRank] as const,
    ['📱 Quest', facts.questRank] as const,
  ]
    .filter(([, rank]) => rank !== '')
    .map(([label, rank]) => `- ${label}: ${rankEmoji(rank)} ${rankLabel(rank)}`);
  return lines.join('\n');
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
  const kind = report.kind ?? 'join';
  return {
    name: joiner.name,
    event: kind,
    eventText: kind === 'avatar' ? 'switched avatar' : facts.rejoin.seenHere === true ? 'rejoined' : 'joined',
    userId: joiner.userId,
    /** The name `userId` had before 2.5.0; still rendered so an older template keeps working. */
    playerId: joiner.userId,
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
    pcRankText: rankLabel(facts.pcRank),
    pcRankEmoji: rankEmoji(facts.pcRank),
    questRank: facts.questRank === '' ? undefined : facts.questRank,
    questRankText: rankLabel(facts.questRank),
    questRankEmoji: rankEmoji(facts.questRank),
    avatar: facts.avatarName,
    avatarId: facts.avatarId,
    avatarImageUrl: facts.avatarImageUrl,
    avatarUrl: vrchatUrl('avatar', facts.avatarId),
    // A Discord link, so the field reads as the avatar's name and goes to VRChat's page.
    avatarLink: facts.avatarName === ''
      ? undefined
      : (facts.avatarId === '' ? facts.avatarName : `["${facts.avatarName}"](${vrchatUrl('avatar', facts.avatarId)})`),
    trustScore: facts.trust?.percent,
    trustScoreText: facts.trust === undefined
      ? undefined
      : `${trustScoreEmoji(facts.trust.percent)} **${String(facts.trust.percent)}**%`,
    trustScoreEmoji: facts.trust === undefined ? undefined : trustScoreEmoji(facts.trust.percent),
    trustText: facts.trust?.description,
    ranksText: ranksText(facts),
    requirementsText: requirementsText(evaluation.checks),
    logText: activityLog(facts.timeline),
    profileUrl: vrchatUrl('user', joiner.userId),
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
    worldUrl: vrchatUrl('world', instance.worldId),
    instanceType: instance.instanceType,
    instanceTypeText: instance.instanceType === '' ? '' : instanceTypeLabel(instance.instanceType),
    instanceId: instance.instanceId,
    instanceName: instance.instanceId === ''
      ? undefined
      : `#${instance.instanceId}${instance.instanceType === '' ? '' : ` · ${instanceTypeLabel(instance.instanceType)}`}`,
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
  const shortRank = (rank: string): string => (rank === '' ? '?' : rankLabel(rank));
  const bits = [
    VERDICT_TEXT[evaluation.verdict],
    `PC ${shortRank(facts.pcRank)}`,
    `Quest ${shortRank(facts.questRank)}`,
    facts.rejoin.seenHere === undefined ? 'rejoin ?' : (facts.rejoin.seenHere ? 'rejoin' : 'new'),
  ];
  const what = report.kind === 'avatar' ? 'switched avatar' : 'joined';
  return `${VERDICT_EMOJI[evaluation.verdict]} ${report.joiner.name} ${what} (${report.preset.name}) · ${bits.join(' · ')}`;
}
