/**
 * Settings schema.
 *
 * Everything that varies per club is a **preset**: which instances it watches (filters, one of
 * each kind), what it expects of a joiner (requirements), and where its reports go (channels,
 * each with its own template or embed). The three numbers at the bottom are global.
 */

import { INSTANCE_TYPES, PERFORMANCE_RANKS, completeEmbed, instanceTypeOptionLabel, type EmbedTemplate, type SettingVariables, type SettingsSchema, type SettingsValues } from '@vrcnext/plugin-api';

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
  // The title is not a link: the profile belongs on the author line, where Discord puts the
  // person an embed is about, and a title that navigates somewhere is a surprise in a report
  // whose subject is already named twice.
  // Quoted, because a display name is arbitrary text: `Bluscream joined` reads as a sentence,
  // while `now joined` or `🎧 DJ joined` does not, and the quotes make the boundary obvious.
  // The count is the club's own history of the person, which "rejoined" does not carry: a
  // player can be new to this room and known at the door. Conditional, because a title that
  // says "the 1st event" to someone's hundredth visit is worse than one that does not count.
  title: '"{name}" {eventText}{{ " for the " + eventOrdinal + " event" if eventOrdinal else "" }}',
  authorName: '{userId}',
  authorUrl: '{profileUrl}',
  authorIconUrl: '{userImageUrl}',
  color: '{resultColor}',
  thumbnailUrl: '{avatarImageUrl}',
  footerIconUrl: 'https://vrcnext.com/logo.png',
  footerText: 'VRCNext · {preset}{{ " · " + world if world else "" }}{{ " · " + instanceName if instanceName else "" }}',
  timestamp: true,
  fields: [
    { name: 'Requirements', value: '{requirementsText}', inline: true },
    { name: 'Avatar', value: '{avatarLink}\n{ranksText}', inline: true },
    // The three cards VRCNext shows on a profile, as fields. Each is a template the club can
    // rewrite: the values are raw, so a row can be reworded, reordered or dropped without the
    // plugin having an opinion. A row whose value is missing renders as nothing and Discord drops
    // the blank line, so a sparse profile quietly shrinks instead of filling with "Unknown".
    { name: 'Activity', value: '{{ "Met: `" + meetsText + "`" if meetsText else "" }}\n{{ "Together: `" + timeTogether + "`" if timeTogether else "" }}\n{{ "First met: " + firstMetSince if firstMetSince else "" }}\n{{ "Last seen: " + lastSeenSince if lastSeenSince else "" }}\n{{ "Records: `" + dbEntries + "`" if dbEntries else "" }}', inline: true },
    // Only what you have actually done to them. A player you have never moderated renders every
    // row empty, so the whole field is dropped — which is the honest shape: this card is about
    // your account, not theirs, and an all-clear grid of dashes says nothing five times over.
    { name: 'Moderation', value: '{{ "🚫 Blocked" if blocked else "" }}\n{{ "🔇 Muted" if muted else "" }}\n{{ "💬 Chatbox muted" if chatMuted else "" }}\n{{ "🙈 Avatar hidden" if avatarHidden else "" }}\n{{ "🤚 Interaction off" if interactOff else "" }}', inline: true },
    { name: 'Info', value: '{{ "Trust: `" + trustRank + "`" if trustRank else "" }}\n{{ "Status: `" + statusText + "`" if statusText else "" }}\n{{ "Languages: `" + languages + "`" if languages else "" }}\n{{ "Pronouns: `" + pronouns + "`" if pronouns else "" }}\n{{ "Joined: " + joinedSince if joinedSince else "" }}', inline: true },
    { name: 'Recently', value: '{logText}', inline: false },
  ],
} as const;

/**
 * Every placeholder a template may use, and what it holds.
 *
 * The host turns this into the chips under each text: hover for the description, click to copy
 * `{name}`. It is also what a template is checked against while it is typed, so a name that is
 * not here is marked before it renders as nothing in a live report.
 */
export const TEMPLATE_VARIABLES = {
  name: 'Display name of the player who joined',
  userId: 'Their VRChat user id, usr_…',
  profileUrl: 'Link to their VRChat profile',
  userImageUrl: 'Their profile picture',
  preset: 'Name of the preset that produced this report',
  presetRequiredAge: '"18+" when this preset requires age verification',
  presetRequiredFriend: '"Friend" when this preset requires friendship',
  presetRequiredPcRank: 'The PC rank floor this preset asks for, in words',
  presetRequiredQuestRank: 'The Quest rank floor this preset asks for, in words',
  presetRequiredIosRank: 'The iOS rank floor this preset asks for, in words',
  presetRequiredGroup: 'The group this preset requires membership of',
  presetRequiredTrustScore: 'The trust score floor this preset asks for, e.g. 75%',
  event: 'join or avatar',
  eventText: '"joined" or "switched avatar"',
  eventCount: "How many of this preset's instances VRCNext has seen them in, this one included",
  eventOrdinal: 'The same as 1st, 2nd, 3rd — empty when VRCNext has no history of them',
  result: 'met, unverified or failed',
  resultText: 'The verdict in words',
  resultEmoji: '✅, ⚠️ or ⛔',
  resultColor: 'The verdict as an embed colour',
  checksText: 'Every requirement checked, one per line',
  checksPlainText: 'The same without emoji, for VR',
  failedText: 'Only the requirements that failed',
  unverifiedText: 'Only the requirements that could not be checked',
  requirementsText: 'The requirements block as the embed shows it',
  ageVerified: 'true when the account is 18+ verified',
  ageVerifiedText: 'The age check in words',
  ageVerifiedEmoji: 'The age check as an emoji',
  ageStatus: 'VRChat\'s raw status: 18+, verified, hidden or empty',
  trustScore: 'VRChat standing as a number out of 100',
  trustScoreText: 'The standing as a coloured percentage',
  trustScoreEmoji: 'The standing as a single circle',
  trustText: 'What the standing is based on',
  platform: 'standalonewindows, android or ios',
  platformEmoji: 'The platform as an emoji',
  isFriend: 'true when they are on your friend list',
  friendText: 'Friendship in words',
  avatar: 'Name of the avatar they are wearing',
  avatarId: 'The avatar id, avtr_…',
  avatarImageUrl: 'Thumbnail of the avatar',
  avatarUrl: 'Link to the avatar page',
  avatarLink: 'The avatar name as a link',
  avatarPlain: 'The avatar name and both ranks, unlinked',
  ranksText: 'PC and Quest performance ranks',
  pcRank: 'PC performance rank',
  pcRankText: 'PC rank in words',
  pcRankEmoji: 'PC rank as a coloured circle',
  questRank: 'Quest performance rank',
  questRankText: 'Quest rank in words',
  questRankEmoji: 'Quest rank as a coloured circle',
  iosRank: 'iOS performance rank',
  iosRankText: 'iOS rank in words',
  iosRankEmoji: 'iOS rank as a coloured circle',
  logText: 'What they have been doing recently, as bullet points',
  inGroup: 'true when they are in the required group',
  inGroupText: 'Group membership in words',
  inGroupEmoji: 'Group membership as an emoji',
  rejoin: 'true when this instance has seen them before',
  rejoinText: 'Whether they have been here before, in words',
  rejoinEmoji: 'The same as an emoji',
  rejoinAgo: 'How long ago they were last here',
  rejoinSince: 'The same as a Discord relative timestamp',
  rejoinAt: 'When they were last here',
  world: 'World name',
  worldId: 'World id, wrld_…',
  worldUrl: 'Link to the world page',
  instanceType: 'public, friends+, group…',
  instanceTypeText: 'The instance type as VRCNext writes it',
  instanceId: 'The instance number',
  instanceName: 'The instance as name and number',
  location: 'The full location string',
  trustRank: 'VRChat standing in words: Visitor, New User, User, Known User, Trusted User',
  meets: 'How many times VRCNext has recorded meeting them, the first meeting included',
  meetsText: 'The same as "14 times"',
  firstMet: 'When you first met, as VRCNext recorded it',
  firstMetAgo: 'How long ago that was, as plain text',
  firstMetSince: 'The same as a Discord relative timestamp', 
  lastSeenAgo: 'How long ago VRCNext last saw them anywhere, as plain text',
  lastSeenSince: 'The same as a Discord relative timestamp',
  timeTogether: 'Total time in the same instance, as 5h 12m 49s',
  timeTogetherSeconds: 'The same as a number of seconds',
  dbEntries: "How many rows in VRCNext's database mention them (needs the SQL permission)",
  blocked: 'true when you have blocked them',
  blockedEmoji: 'Blocked as an emoji',
  muted: 'true when you have muted them',
  mutedEmoji: 'Muted as an emoji',
  chatMuted: 'true when you have muted their chatbox',
  chatMutedEmoji: 'Chatbox mute as an emoji',
  avatarHidden: 'true when you have hidden their avatar',
  avatarHiddenEmoji: 'Avatar hidden as an emoji',
  interactOff: 'true when you have turned off interaction with them',
  interactOffEmoji: 'Interaction off as an emoji',
  languages: 'The languages on their profile, comma separated',
  dateJoined: 'The day their VRChat account was created',
  joinedAgo: 'How long ago they joined VRChat, as plain text',
  joinedSince: 'The same as a Discord relative timestamp',
  lastLoginAgo: 'How long ago they last logged in, as plain text',
  lastLoginSince: 'The same as a Discord relative timestamp',
  lastActivityAgo: 'How long ago they were last active, as plain text',
  lastActivitySince: 'The same as a Discord relative timestamp',
  pronouns: 'The pronouns on their profile',
  status: 'Their raw status: active, join me, ask me, busy, offline',
  statusText: 'The status as VRCNext names it',
  statusDescription: 'Their status message',
  note: 'Your private note on them',
  allowAvatarCopying: 'true when others may clone their avatar',
  allowAvatarCopyingText: 'Avatar cloning in words',
  time: 'Local time of the report',
  date: 'Local date of the report',
  timestamp: 'The report time as a Discord timestamp',
} as const satisfies SettingVariables;

/**
 * The wording a preset actually uses.
 *
 * With the switch off a preset follows the plugin's own templates, so improving the default
 * wording reaches every club that never wanted to write its own. With it on, the club's text
 * wins — and an empty VR template still falls back to the report one, because a blank overlay
 * is nobody's intent.
 */
export function templatesOf(preset: Preset): { readonly text: string; readonly vr: string } {
  const custom = preset.templates;
  const text = custom.enabled ? custom.template : DEFAULT_TEMPLATE;
  const vr = custom.enabled && custom.templateVr.trim() !== '' ? custom.templateVr : text;
  return { text, vr };
}

/**
 * The embed a preset actually posts.
 *
 * Same bargain as {@link templatesOf}: with the switch off the preset follows the plugin's own
 * embed, so every club gains each improvement to it without editing anything, and with it on the
 * club's own embed wins. Turning it off does not discard what they wrote.
 */
export function embedOf(preset: Preset): EmbedTemplate {
  return preset.discord.useCustomEmbed ? preset.discord.embed : completeEmbed(DEFAULT_EMBED);
}

/**
 * The floors a preset can ask for, as one ordered scale.
 *
 * Unknown sits below VeryPoor on it, which is what makes the list read correctly: `Unknown or
 * better` accepts anything and so checks nothing, while `VeryPoor or better` — the next rung —
 * accepts every rank that exists but *not* an avatar nothing could rank. Those two look like
 * synonyms when the first is called `Any`, and they are not: the second is how a club says the
 * avatar has to be assessable at all.
 */
const RANK_OPTIONS = [
  { value: 'any', label: 'Unknown or better' },
  ...[...PERFORMANCE_RANKS].reverse().map((rank) => ({ value: rank, label: `${rank} or better` })),
] as const;

// The app's own names for the types, so a preset reads the way VRCNext's instance badges do —
// disambiguated, because a badge names one instance while this list offers all nine at once and
// two of them are both badged "Friends+".
const INSTANCE_TYPE_OPTIONS = INSTANCE_TYPES.map((type) => ({ value: type, label: instanceTypeOptionLabel(type) }));

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
  minIosRank: {
    kind: 'select',
    label: 'iOS avatar rank at least',
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
  minTrustScore: {
    kind: 'number',
    label: 'Trust score at least',
    description:
      'The profile score VRChat stopped showing: account age, 18+ status, a bio, groups joined. '
      + '0 asks for nothing, and the score is left out of the report entirely.',
    default: 0,
    min: 0,
    max: 100,
    step: 1,
    integer: true,
    unit: '%',
    slider: true,
    markers: [0, 25, 50, 75, 100],
  },
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
  templates: {
    kind: 'object',
    label: 'Templates',
    toggle: {
      label: 'Use custom templates',
      description: 'Off means the plugin\'s own wording, which changes as the plugin improves.',
      default: false,
    },
    fields: {
      template: {
        kind: 'string',
        multiline: true,
        label: 'Report template',
        description: 'First line = title, rest = body. A line whose placeholders are all empty is left out.',
        default: DEFAULT_TEMPLATE,
        variables: TEMPLATE_VARIABLES,
      },
      templateVr: {
        kind: 'string',
        multiline: true,
        label: 'VR overlay template',
        description: 'Plain text: WayVR shows nothing for emoji. Empty means the report template.',
        default: DEFAULT_TEMPLATE_VR,
        variables: TEMPLATE_VARIABLES,
      },
    },
  },
  discord: {
    kind: 'object',
    label: 'Discord',
    // The switch takes over the `enabled` field this object already had, so a preset stored
    // before this change keeps its answer and the URL and embed simply fold away with it.
    toggle: {
      label: 'Post to a webhook',
      description: 'Off means this preset reports to its other channels only.',
      default: false,
    },
    fields: {
      webhookUrl: {
        kind: 'string',
        label: 'Webhook URL',
        description: 'Server Settings → Integrations → Webhooks. Only discord.com is allowed.',
        default: '',
        placeholder: 'https://discord.com/api/webhooks/…',
        format: 'url',
      },
      useCustomEmbed: {
        kind: 'boolean',
        label: 'Use a custom embed',
        description: 'Off means the plugin\'s own embed, which improves as the plugin does. Your edits are kept either way.',
        default: false,
      },
      embed: {
        kind: 'embed',
        label: 'Embed',
        default: DEFAULT_EMBED,
        variables: TEMPLATE_VARIABLES,
        // Hidden rather than absent: the embed a club wrote is still theirs while the switch is
        // off, and comes back as they left it when it goes on again.
        hidden: (values) => values['useCustomEmbed'] !== true,
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
    description: 'VRChat logs a join for everyone already there when you enter. Joins inside this settling time are not reported.',
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
  allowExtraApiRequests: {
    kind: 'boolean',
    label: 'Allow making extra API requests',
    description:
      'Off, a report only uses what VRCNext already fetched plus what it recorded on this machine. '
      + 'On, a picture that neither of those can supply is worth one more uncached lookup, which may '
      + 'make VRCNext ask VRChat again. Off by default: VRChat rate-limits, and a busy club is a lot of joins.',
    default: false,
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
