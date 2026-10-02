/**
 * VRCNext's recent records for a player, as lines a Discord embed can show.
 *
 * The wording lives in `@vrcnext/plugin-api` (`userEventLines`), so a moderation record reads
 * as "Blocked by you" rather than as the column name "moderation", and so every surface that
 * shows a timeline words it the same. This file only says how many lines a report carries and
 * which format they are in.
 */

import { EMBED_LIMITS, fitLines, userEventLines, type VrcTimelineEvent } from '@vrcnext/plugin-api';

/** The bullet each line carries, and the gap row's own line once it has one. */
const BULLET = '- ';
const GAP_LINE = `${BULLET}...`;

/**
 * How many lines a log field asks for.
 *
 * Discord caps a field value at 1024 characters, so the real limit is characters and this is
 * only a ceiling on the work. Measured against real lines: "Came online <t:…:R>" is 30
 * characters with its bullet, a plain arrival about 65, and a long one — ``Met again in `YTS 2.1
 * - YouTube Search, Subtitles, Quest #27377` (Friends+) <t:…:R>`` — about 85. Twelve of even
 * that worst case is 1020, so twelve lines fit whatever the history turns out to look like,
 * while five spent four fifths of the field on nothing. {@link fitLines} is what actually
 * guarantees it, so this number can be generous without ever producing a cut-off line.
 */
export const LOG_LINES = 12;

/**
 * The newest records as `- Visited \`Club X #12345\` (Group+) ×2 <t:…:R>`, newest first, ending
 * at the oldest record VRCNext has with a `- ...` row for what sits between.
 *
 * Arrivals are collapsed per instance with a count, so a player who came and went three times
 * does not fill the whole field with one sentence. The oldest row is pinned because it is
 * usually the day you met them, and because the five newest records can never show it: without
 * it the field says what they did in the last hour, with it the field says since when.
 * `groupName` resolves the `grp_…` in a group instance's location, which the record itself does
 * not carry.
 *
 * Returns `''` when VRCNext had nothing, which drops the field from the embed rather than
 * showing an empty one.
 */
/**
 * The timeline with VRCNext's genuinely oldest record appended.
 *
 * `userEventLines({ oldest: true })` pins the oldest row it is given, and what it is given is the
 * ten records a timeline read returns. Appending the database's own oldest makes that pin the
 * first thing VRCNext ever saw. Skipped when the window already reaches it.
 */
function withOldest(
  events: readonly VrcTimelineEvent[] | undefined,
  oldest: VrcTimelineEvent | undefined,
): readonly VrcTimelineEvent[] | undefined {
  if (oldest === undefined) return events;
  if (events === undefined) return [oldest];
  // Two ids are the same record only when both are actually ids: `undefined === undefined` is
  // every record matching every other one.
  const already = events.some((e) => {
    const sameId = e.id !== undefined && e.id !== '' && e.id === oldest.id;
    return sameId || (e.timestamp !== '' && e.timestamp <= oldest.timestamp);
  });
  if (already) return events;
  return [...events, oldest];
}

export function activityLog(
  events: readonly VrcTimelineEvent[] | undefined,
  limit = LOG_LINES,
  groupName?: (groupId: string) => string | undefined,
  oldest?: VrcTimelineEvent,
): string {
  const all = withOldest(events, oldest);
  const lines = userEventLines(all, { format: 'discord', limit, oldest: true, time: 'relative', ...(groupName ? { groupName } : {}) })
    .map((line) => `${BULLET}${line}`);
  return fitLines(lines, EMBED_LIMITS.fieldValue, { gap: GAP_LINE }).join('\n');
}
