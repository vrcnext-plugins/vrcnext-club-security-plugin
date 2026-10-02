/**
 * VRCNext's recent records for a player, as lines a Discord embed can show.
 *
 * The wording lives in `@vrcnext/plugin-api` (`userEventLines`), so a moderation record reads
 * as "Blocked by you" rather than as the column name "moderation", and so every surface that
 * shows a timeline words it the same. This file only says how many lines a report carries and
 * which format they are in.
 */

import { userEventLines, type VrcTimelineEvent } from '@vrcnext/plugin-api';

/** How many lines a log field carries by default. Discord caps a field at 1024 characters. */
export const LOG_LINES = 5;

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
export function activityLog(
  events: readonly VrcTimelineEvent[] | undefined,
  limit = LOG_LINES,
  groupName?: (groupId: string) => string | undefined,
): string {
  return userEventLines(events, { format: 'discord', limit, oldest: true, time: 'relative', ...(groupName ? { groupName } : {}) })
    .map((line) => `- ${line}`)
    .join('\n');
}
