/**
 * VRCNext's recent records for a player, as lines a Discord embed can show.
 *
 * `ctx.vrchat.userTimeline` gives the ten newest events it holds: where they went, when they
 * came online, when they changed avatar. Rendered with Discord's own `<t:…:R>` stamp so the
 * reader sees "3 hours ago" in their own timezone, and so the line does not go stale in the
 * channel the way a baked-in clock time would.
 */

import { parseLocation, type VrcTimelineEvent } from '@vrcnext/plugin-api';

/** How many lines a log field carries by default. Discord caps a field at 1024 characters. */
export const LOG_LINES = 5;

/**
 * A name as Discord code, so a world called `**x**` cannot style the line.
 *
 * Discord has no escape inside a code span, so a name containing a backtick is fenced with a
 * longer run of them and padded, which is the only thing Discord itself honours.
 */
export function code(name: string): string {
  if (!name.includes('`')) return `\`${name}\``;
  const longest = Math.max(...[...name.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence} ${name} ${fence}`;
}

/** `<t:1790517600:R>` — Discord renders this relative to whoever is reading it. */
export function discordTime(at: string | number): string {
  const ms = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(ms)) return '';
  return `<t:${String(Math.floor(ms / 1000))}:R>`;
}

/** What VRCNext's timeline types mean, in words a moderator reads rather than column names. */
function phrase(event: VrcTimelineEvent): string {
  const where = event.worldName === '' ? '' : ` ${code(event.worldName)}`;
  const type = parseLocation(event.location).instanceType;
  const instance = type === '' ? where : `${where} (${type})`;
  switch (event.type) {
    case 'friend_gps':
    case 'instance_join':
    case 'meet_again':
      return instance === '' ? 'moved instance' : `went to${instance}`;
    case 'first_meet':
      return instance === '' ? 'was met for the first time' : `was met for the first time in${instance}`;
    case 'friend_online':
      return 'came online';
    case 'friend_offline':
      return 'went offline';
    case 'friend_avatar':
      return 'changed avatar';
    case 'friend_bio':
      return 'changed their bio';
    case 'friend_status':
    case 'friend_statusdesc':
      return 'changed their status';
    case 'friend_added':
      return 'was added as a friend';
    case 'friend_removed':
      return 'was removed as a friend';
    default:
      // An unmapped type is still worth showing; VRCNext may grow new ones.
      return event.type.replace(/^friend_/, '').replace(/_/g, ' ');
  }
}

/**
 * The newest events as `- went to \`Club X\` (group-public) <t:…:R>`, newest first.
 *
 * The time goes last because every line starts with one otherwise, and what happened is what
 * the reader is scanning for.
 *
 * Returns `''` when VRCNext had nothing, which drops the field from the embed rather than
 * showing an empty one.
 */
export function activityLog(
  events: readonly VrcTimelineEvent[] | undefined,
  limit = LOG_LINES,
): string {
  if (events === undefined || events.length === 0) return '';
  return [...events]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, limit)
    .map((event) => {
      const when = discordTime(event.timestamp);
      return when === '' ? `- ${phrase(event)}` : `- ${phrase(event)} ${when}`;
    })
    .join('\n');
}
