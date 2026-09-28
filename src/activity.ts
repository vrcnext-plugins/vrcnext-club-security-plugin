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
 * The newest records as `- Visited \`Club X\` #12345 (Group+) ×2 <t:…:R>`, newest first.
 *
 * Identical records are collapsed with a count: a player who walked in and out three times
 * would otherwise fill the whole field with one sentence. `groupName` resolves the `grp_…` in
 * a group instance's location, which the record itself does not carry.
 *
 * Returns `''` when VRCNext had nothing, which drops the field from the embed rather than
 * showing an empty one.
 */
export function activityLog(
  events: readonly VrcTimelineEvent[] | undefined,
  limit = LOG_LINES,
  groupName?: (groupId: string) => string | undefined,
): string {
  return userEventLines(events, { format: 'discord', limit, time: 'relative', ...(groupName ? { groupName } : {}) })
    .map((line) => `- ${line}`)
    .join('\n');
}
