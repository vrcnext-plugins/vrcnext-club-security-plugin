/**
 * Settings schema.
 *
 * Everything that varies per club is a **preset**: which instances it watches (filters, one of
 * each kind), what it expects of a joiner (requirements), and where its reports go (channels,
 * each with its own template or embed). The three numbers at the bottom are global.
 */

import { INSTANCE_TYPES, PERFORMANCE_RANKS, instanceTypeLabel, type SettingsSchema, type SettingsValues } from '@vrcnext/plugin-api';

/** The report as text: first line = title, rest = body. Used for toasts, desktop and VR. */
export const DEFAULT_TEMPLATE = [
  '{resultEmoji} {name} {eventText} · {preset}',
  '{checksText}',
  'Avatar: {avatarPlain}',
  '{{ "Seen here before, " + rejoinAgo if rejoin else "" }}',
].join('\n');

/** The same, without emoji: WayVR draws with one font and shows nothing for symbols. */
export const DEFAULT_TEMPLATE_VR = [
  '{name} {eventText}: {resultText}',
  '{checksPlainText}',
].join('\n');

/**
 * The report as a Discord embed.
 *
 * Every text is a template. The shape is built for a moderator glancing at a phone: who it is
 * and a link to their profile in the title, the avatar as the thumbnail, the requirements and
 * the avatar side by side, and what VRCNext has seen them do underneath. `{resultColor}`
 * colours the bar green, orange or red.
 *
 * A field whose value renders empty is dropped, so the log disappears on a player VRCNext has
 * no history for rather than showing an empty box.
 */
export const DEFAULT_EMBED = {
  title: '{name} {eventText}',
  url: '{profileUrl}',
  color: '{resultColor}',
  thumbnailUrl: '{avatarImageUrl}',
  footerIconUrl: 'https://vrcnext.com/logo.png',
  footerText: 'VRCNext Club Security · {preset}{{ " · " + world if world else "" }}{{ " · " + instanceName if instanceName else "" }}',
  timestamp: true,
  fields: [
    { name: 'Requirements', value: '{requirementsText}', inline: true },
    { name: 'Trust Score', value: '{trustScoreText}', inline: true },
    { name: 'Avatar', value: '{avatarLink}\n{ranksText}', inline: true },
    { name: 'Recently', value: '{logText}', inline: false },
  ],
} as const;

/** Names a template may use. Listed under the editors so the user can see them. */
export const TEMPLATE_VARIABLES = [
  'name', 'userId', 'preset', 'event', 'eventText', 'result', 'resultText', 'resultEmoji', 'resultColor', 'checksText', 'checksPlainText',
  'failedText', 'unverifiedText', 'ageVerified', 'ageVerifiedText', 'ageVerifiedEmoji', 'ageStatus',
  'pcRank', 'pcRankText', 'pcRankEmoji', 'questRank', 'questRankText', 'questRankEmoji',
  'avatar', 'avatarId', 'avatarImageUrl', 'avatarUrl', 'avatarLink', 'avatarPlain', 'ranksText', 'requirementsText', 'logText',
  'trustScore', 'trustScoreText', 'trustScoreEmoji', 'trustText',
  'profileUrl', 'platform', 'platformEmoji', 'isFriend', 'friendText',
  'inGroup', 'inGroupText', 'inGroupEmoji', 'rejoin', 'rejoinText', 'rejoinEmoji', 'rejoinAgo', 'rejoinSince', 'rejoinAt',
  'world', 'worldId', 'worldUrl', 'instanceType', 'instanceTypeText', 'instanceId', 'instanceName',
  'location', 'time', 'date', 'timestamp',
] as const;

const RANK_OPTIONS = [
  { value: 'any', label: 'Any' },
  ...[...PERFORMANCE_RANKS].reverse().map((rank) => ({ value: rank, label: `${rank} or better` })),
] as const;

// The app's own names for the types, so a preset reads the way VRCNext's instance badges do.
const INSTANCE_TYPE_OPTIONS = INSTANCE_TYPES.map((type) => ({ value: type, label: instanceTypeLabel(type) }));

/** One club. */
export const preset = {
  name: { kind: 'string', label: 'Preset name', default: 'My club', maxLength: 40 },
  enabled: { kind: 'boolean', label: 'Enabled', default: true },

  instanceTypes: {
    kind: 'multiselect',
    label: 'Instance types',
    description: 'Only these count. None chosen means every type.',
    default: [],
    options: INSTANCE_TYPE_OPTIONS,
  },
  group: {
    kind: 'group',
    label: 'Group',
    description: 'Only instances of this group. Empty means any.',
    default: '',
  },
  worlds: {
    kind: 'world',
    label: 'Worlds',
    description: 'Only these worlds. None chosen means any.',
    default: [],
    multiple: true,
  },

  requireAge: {
    kind: 'boolean',
    label: 'Require 18+ verification',
    description: 'Met when VRChat shows 18+. Hidden or unknown counts as unverified; a verified account under 18 fails.',
    default: true,
  },
  minPcRank: {
    kind: 'select',
    label: 'PC avatar rank at least',
    description: 'An unknown rank counts as unverified.',
    default: 'any',
    options: RANK_OPTIONS,
  },
  minQuestRank: {
    kind: 'select',
    label: 'Quest avatar rank at least',
    default: 'any',
    options: RANK_OPTIONS,
  },
  requiredGroup: {
    kind: 'group',
    label: 'Must be a member of',
    description: 'Only memberships the player shows publicly can be seen; a hidden one counts as unverified.',
    default: '',
  },
  requireFriend: { kind: 'boolean', label: 'Must be on my friend list', default: false },
  whitelist: {
    kind: 'user',
    label: 'Never check these people',
    description: 'Staff, DJs, yourself on a second account. They join and switch avatars without a report.',
    default: [],
    multiple: true,
    scopes: ['friends', 'favorites', 'recent', 'instance', 'search'],
  },

  watchAvatarChanges: {
    kind: 'boolean',
    label: 'Warn when someone here switches avatar',
    description:
      'Re-checks the avatar limits above against the new avatar: within the limits is green, an unknown rank orange, over them red. Only this preset’s avatar requirements are checked, not age or membership.',
    default: false,
  },

  toast: { kind: 'boolean', label: 'In-app toast', default: true },
  desktop: { kind: 'boolean', label: 'Desktop notification', default: true },
  vr: { kind: 'boolean', label: 'VR overlay notification', default: true },
  template: {
    kind: 'string',
    multiline: true,
    label: 'Report template',
    description: 'First line = title, rest = body. A line whose placeholders are all empty is left out. Variables are listed under the Discord embed.',
    default: DEFAULT_TEMPLATE,
  },
  templateVr: {
    kind: 'string',
    multiline: true,
    label: 'VR overlay template',
    description: 'Plain text: WayVR shows nothing for emoji. Empty means the report template.',
    default: DEFAULT_TEMPLATE_VR,
  },
  discord: {
    kind: 'object',
    label: 'Discord',
    fields: {
      enabled: { kind: 'boolean', label: 'Post to a webhook', default: false },
      webhookUrl: {
        kind: 'string',
        label: 'Webhook URL',
        description: 'Server Settings → Integrations → Webhooks. Only discord.com is allowed.',
        default: '',
        placeholder: 'https://discord.com/api/webhooks/…',
        format: 'url',
      },
      embed: {
        kind: 'embed',
        label: 'Embed',
        default: DEFAULT_EMBED,
        variables: TEMPLATE_VARIABLES,
      },
    },
  },
} as const satisfies SettingsSchema;

export const settings = {
  presets: {
    kind: 'list',
    label: 'Presets',
    description: 'One per club: which instances it watches, what it requires, where it reports. A join is reported once per preset that matches.',
    titleKey: 'name',
    addLabel: 'Add preset',
    default: [],
    item: preset,
  },
  settleSecs: {
    kind: 'number',
    label: 'Seconds to ignore after you join',
    description: 'VRChat logs a join for everyone already there when you enter. Joins inside this window are not reported.',
    default: 15,
    min: 3,
    max: 120,
    step: 1,
    integer: true,
    unit: 's',
    slider: true,
  },
  collectTimeoutSecs: {
    kind: 'number',
    label: 'Seconds to wait for details',
    description: 'How long to give VRCNext for the profile, avatar and groups before reporting what is known.',
    default: 25,
    min: 1,
    markers: [1, 5, 10, 15, 25, 40, 60],
    integer: true,
    unit: 's',
  },
  notifyTimeoutSecs: {
    kind: 'number',
    label: 'Seconds a desktop or VR notification stays',
    default: 30,
    min: 1,
    max: 60,
    step: 1,
    integer: true,
    unit: 's',
    slider: true,
  },
} as const satisfies SettingsSchema;

export type Settings = typeof settings;
export type Preset = SettingsValues<typeof preset>;
