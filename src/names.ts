/**
 * The names VRCNext recorded for a player, as lines a Discord embed can show.
 *
 * VRChat publishes no name history and VRCNext keeps no table of one — `user_tracking` holds a
 * single current `display_name`, and there is no name-change event. What exists is incidental:
 * every `event_players` row stores the name the player carried *at the time*, so the distinct
 * names across their records are the names VRCNext happened to witness. That is a weaker claim
 * than a history and the field's description says so.
 *
 * The timestamp comes from the event rather than from the row: `event_players.joined_at` is
 * empty on almost every row, and on the few that have it the value is wrapped in a JSON array
 * (`["2026-09-23T10:15:55.0000000Z"]`), so it cannot be ordered or parsed as a date.
 */

import { EMBED_LIMITS, discordTimestamp, fitLines } from '@vrcnext/plugin-api';

/** One name, with the window VRCNext saw it in. */
export interface SeenName {
  readonly name: string;
  /** When it was first recorded, as an ISO timestamp. */
  readonly firstSeen: string;
  /** When it was last recorded — what a line shows, since that is when they stopped using it. */
  readonly lastSeen: string;
}

/** The bullet each line carries, and the gap row for what did not fit. */
const BULLET = '- ';
const GAP_LINE = `${BULLET}...`;

/**
 * How many names a field asks for.
 *
 * The field is inline, so a third of the embed's width: a name and a relative stamp wrap to two
 * rendered lines more often than not, and eight entries is already a tall field beside its two
 * neighbours. {@link fitLines} enforces the real limit, which is Discord's 1024 characters, so
 * this only caps how tall the field can get on a player who renames constantly.
 */
export const NAME_LINES = 8;

export interface NameHistoryOptions {
  readonly limit?: number;
  /**
   * The name they carry now, dropped from the list.
   *
   * The current name is already the embed's title and author line; repeating it as the newest
   * row of a history would say it three times and make a player who has never renamed look as
   * though they had.
   */
  readonly current?: string;
}

/**
 * The names they used before this one, newest first, as `` - `Old Name` <t:…:R> ``.
 *
 * The stamp is when VRCNext last saw them under that name, which is what dates a rename. Relative
 * and in Discord's own format, so it renders in each reader's timezone and language and keeps
 * counting after the message is posted — the same choice the rest of the embed makes.
 *
 * Returns `''` when there is nothing to say, which drops the field from the embed rather than
 * showing an empty one. That covers both a player VRCNext has only ever seen under one name and
 * a club without the `sql` permission.
 */
export function nameHistory(
  names: readonly SeenName[] | undefined,
  options: NameHistoryOptions = {},
): string {
  const all = previousNames(names, options).map(
    (seen) => `${BULLET}\`${seen.name}\` ${discordTimestamp(seen.lastSeen)}`,
  );
  const kept = fitLines(all.slice(0, options.limit ?? NAME_LINES), EMBED_LIMITS.fieldValue);
  if (kept.length === all.length) return kept.join('\n');
  // Something was left out, by the line cap or by Discord's 1024 characters. A `- ...` row says
  // so, which matters more here than one further name: without it the field ends on whichever
  // name happened to fit, reading as the first one they ever had. `fitLines` is given the gap
  // so it drops the line *above* it and the row survives the trim it causes.
  const withGap = fitLines([...kept, GAP_LINE], EMBED_LIMITS.fieldValue, { gap: GAP_LINE });
  return (withGap.length === 0 ? kept : withGap).join('\n');
}

/**
 * The same names as records, newest first, without the one they carry now.
 *
 * Sorted here rather than trusted from the query: a caller may hand these over from anywhere,
 * and a history out of order reads as a rename that un-happened.
 */
export function previousNames(
  names: readonly SeenName[] | undefined,
  options: NameHistoryOptions = {},
): readonly SeenName[] {
  if (names === undefined) return [];
  const current = (options.current ?? '').trim();
  return names
    .filter((seen) => seen.name !== '' && seen.name.trim() !== current)
    .toSorted((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}
