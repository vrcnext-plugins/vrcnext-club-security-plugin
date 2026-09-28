# Club Security

Reports who joins your instance, and whether they meet your club's rules.

Everything that varies per club is a **preset**: which instances it watches, what it expects of a
joiner, and where its reports go. A join is reported once per enabled preset whose filters match
the instance, so one account can run the door for several clubs at once.

Every report carries a verdict, and it is the worst of the preset's checks:

| Verdict | Means |
| :--- | :--- |
| ✅ green | Every requirement was checked and holds. |
| ⚠️ orange | Something could not be checked: an unknown avatar rank, a hidden age status, a membership the player does not show publicly. |
| ⛔ red | A requirement was checked and does not hold: a VeryPoor avatar under a Medium floor, a verified account that is not 18+, a non-friend where friendship is required. |

The verdict reaches your templates as `{result}`, `{resultText}`, `{resultEmoji}` and
`{resultColor}` — the last one colours the Discord embed's bar.

## A preset

| Section | Setting | Meaning |
| :--- | :--- | :--- |
| Identity | Preset name, Enabled | The name appears in every report as `{preset}`. |
| Filters | Instance types, Group, Worlds | One of each kind. Empty means "any". A pickable group and worlds, not pasted ids. |
| Requirements | Require 18+, PC / Quest avatar rank at least, Must be a member of, Must be on my friend list | Each one becomes a check with its own verdict. |
| Exceptions | Never check these people | Picked from your friends, favourites or the instance. Staff join and change avatar without a report. |
| Avatars | Warn when someone here switches avatar | Re-checks the avatar limits alone against the new avatar. |
| Channels | In-app toast, Desktop, VR overlay, Discord | Per preset, so a strict club can post to Discord while a relaxed one only toasts. |
| Formats | Report template, VR overlay template, Discord embed | The text report, the plain-text one for VR, and the embed. |

## The Actions card

Three buttons on the Club Security tab, each running the presets you have enabled:

| Button | What it does | Sends? |
| :--- | :--- | :--- |
| **Test self** | Runs *your own* account through every enabled preset, bypassing the self check and the exception list that normally keep you out of reports. With VRChat closed it uses the last instance VRCNext recorded you in, and a clearly fake `Example World` when it has none. | No — panel only |
| **Check everyone here** | Every player in your instance against every enabled preset, up to twelve. The door check: who in this room would the rules have turned away? | No — panel only |
| **Replay last join** | The last player VRCNext recorded, through every preset, to their channels. The one button that exercises Discord, desktop and VR. Works with VRChat closed. | Yes |

All three ignore the instance filters: a preset that would not have watched this instance still
says what it would have said, and notes that in the log. Hover a button for the detail.

## Avatar switches

A club's avatar rules are usually broken *after* the door, by someone who came in on a light
avatar and changed. With **Warn when someone here switches avatar** on, a preset re-checks its
PC and Quest limits whenever a player already in your instance changes into another avatar, and
reports it with the same three colours. Nothing else is re-read — their age status and their
memberships did not change with their avatar — so the report carries the avatar checks only.

VRChat's log says nothing about other people's avatars, so this comes from the instance VRCNext
already keeps: a switch is noticed at the next refresh, within about half a minute.

## Testing the channels

**Replay last join** takes the most recent player VRCNext recorded near you and runs them
through every enabled preset again, each with its own requirements, so the test shows what that
preset would really have reported. It reads VRCNext's own records — the recent players and
their timeline — so it works with VRChat closed, which is when a webhook is usually being set
up. Filters are not applied, because the point is to exercise the channels; a preset that would
not have watched that instance says so in the plugin log.

## The default report

```
✅ Tupper joined · Saturday Night
✅ 18+ verified: 18+
✅ PC avatar rank: Good
✅ Group member: member
Avatar: Ava (PC Good · Quest Poor)
```

First line = title, rest = body. A line whose placeholders all came out empty is left out, which
is why the rejoin line only appears for someone who has been in that instance before.

`{name}` is short for `{{ name }}`; the full template language (conditions, filters, `{% if %}`
blocks) is in the plugin system's API reference. The VR template is separate because WayVR draws
with a single font and shows nothing for emoji.

| Kind | Variables |
| :--- | :--- |
| Verdict | `result` `resultText` `resultEmoji` `resultColor` `checksText` `checksPlainText` `failedText` `unverifiedText` |
| Player | `name` `userId` (`playerId` is the old name) `platform` `platformEmoji` `isFriend` `friendText` `ageVerified` `ageVerifiedText` `ageVerifiedEmoji` `ageStatus` |
| Avatar | `avatar` `avatarId` `avatarImageUrl` `avatarLink` `avatarPlain` `ranksText` `pcRank` `pcRankText` `pcRankEmoji` `questRank` `questRankText` `questRankEmoji` |
| Activity | `logText` — the player's recent records as Discord lines |
| Club | `preset` `inGroup` `inGroupText` `inGroupEmoji` |
| History | `rejoin` `rejoinText` `rejoinEmoji` `rejoinAgo` `rejoinSince` `rejoinAt` |
| Place and time | `world` `worldId` `instanceType` `instanceId` `location` `time` `date` `timestamp` |

`avatar`, `avatarLink` and `avatarPlain` are empty when VRCNext cannot name the avatar, which
drops the line — and, in an embed, the whole field — rather than printing "Unknown".

Booleans (`ageVerified`, `inGroup`, `rejoin`, `isFriend`) are empty when unknown, so
`{{ "yes" if rejoin else "no" }}` and `{% if inGroup == false %}…{% endif %}` both behave. A
template that does not parse is reported in the log and the default is used instead.

## Where each fact comes from

Everything goes through `ctx.vrchat`, which reads VRCNext's data **without opening its dialogs**.

| Fact | Source | Caveat |
| :--- | :--- | :--- |
| 18+ verification | The joiner's profile. `18+` passes, `verified` without `18+` fails, `hidden` or missing is unverified. | Legacy accounts without a `usr_` id cannot be looked up at all. |
| Avatar and ranks | The avatar the player wears, resolved through VRCNext's avatar databases, then its performance ranks. | Only works when one of the databases knows the avatar; an unknown rank is unverified, never a failure. |
| Group membership | The groups the user shows publicly. | A member who hides the membership is unverified, not a failure. |
| Friendship | Your friend list. | — |
| Recent activity | VRCNext's timeline, worded by the plugin system: `Blocked by you`, ``Visited `Jellybean` #52792 (Friends+)``, `Friend request from **X**`. Identical records collapse into one line with a `×2`, and a group instance names its group when VRCNext knows it. | Ten records deep per player, so a busy account's log is short. |
| Rejoin | VRCNext's timeline: the player's ten most recent events, each with its location. Yes when one of them is this exact instance (same world **and** instance id) from before this join. | Survives restarts and reaches back to when VRCNext was installed, but only ten events deep per player. |

Each lookup runs in parallel and degrades to "unknown" on its own timeout rather than holding up
the report.

## Your own joins

The signed-in account comes from `ctx.vrchat.self()`. VRChat logs an `OnPlayerJoined` line for the
local player too, and right after it one line for every player already in the instance. The plugin
ignores your own line and treats joins inside the settle window after it (or after a world change)
as "already here".

## Layout and permissions

Flat, like every plugin: `plugin.json`, `main.ts`, `src/`. The manifest declares `gamelog` (joins
and world changes), `vrchat` (the read-only data above), `notifications` (toast, Windows tray
toast), `native` (bridge targets) and `network` with `discord.com` as its only host. No VRCNext
actions and no raw events: the `vrchat` capability covers everything this plugin reads.

## Installing

In VRCNext: **Settings → Plugins → Install a plugin**, with this repository's URL:

```
https://github.com/vrcnext-plugins/vrcnext-club-security-plugin
```

The [VRCNext Bridge](https://github.com/vrcnext-plugins/vrcnext-bridge) clones it, checks the
manifest and the source policy, asks you to confirm on the desktop, and rebuilds the bundle.

## Developing

The typed API is not on npm, so `@vrcnext/plugin-api` is a `file:` link to a checkout of
[vrcnext-plugin-system](https://github.com/vrcnext-plugins/vrcnext-plugin-system) beside this
one:

```
projects/
  vrcnext-plugin-system/
  vrcnext-club-security-plugin/
```

```bash
npm install && npm run check
```

`check` is type-check, lint and tests. The lint config mirrors the plugin host's own rules and
the bridge's source policy, so anything it accepts installs. Nothing here is bundled but what
`main.ts` imports — the tests stay out of the plugin.

## Signature

Every release of this plugin is signed; the bridge refuses to install or update it otherwise,
and it stays pinned to this key. Check the fingerprint against the one VRCNext shows you when it
asks whether to trust a new signing key:

```
1bc6-e13e-c44c-3bd0-f5a8-5618-8b9b-919c
```

If an update ever says the key changed, stop and ask before confirming.
