/**
 * Club Security.
 *
 * Watches VRChat's game log for players joining your instance. For every enabled preset whose
 * filters match the instance, it gathers what VRCNext knows about the joiner through
 * `ctx.vrchat` (no dialogs open), checks the preset's requirements, and sends one report to the
 * preset's channels with a green, orange or red verdict.
 *
 * Compare with `plugin.json`: every category used here is declared there.
 */

import { definePlugin, type PluginContext, type PluginId, type VrcInstance } from '@vrcnext/plugin-api';

import { collectAvatarFacts, collectFacts, type Joiner } from './src/facts.js';
import { matchingPresets, presetMatches } from './src/filters.js';
import { notify } from './src/notify.js';
import { ReportPanel } from './src/panel.js';
import { lastJoin, selfCheck, type Replay } from './src/replay.js';
import { AVATAR_CHECKS, evaluate } from './src/requirements.js';
import { avatarLine, type Report } from './src/report.js';
import { settings, type Preset } from './src/settings.js';

type Ctx = PluginContext<typeof settings>;

/** VRCNext's parsed game-log kinds for `[Behaviour] OnPlayerJoined` and `Joining wrld_…`. */
const JOIN_EVENT = 'gl_player_join';
const WORLD_JOIN_EVENT = 'gl_world_join';
/** How often the current instance is re-read, while anything is actually watching it. */
const INSTANCE_REFRESH_MS = 30_000;
/**
 * How long after arriving in a world to keep asking where we are.
 *
 * VRChat's own API lags the log line: reading the instance the moment `Joining wrld_…` appears
 * usually still answers with the world we just left, and someone joining while that is true would
 * be matched against the previous instance's filters. These delays re-ask until the answer
 * changes, which it normally does on the first or second try.
 */
const ARRIVAL_RETRY_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000];
/** How many players a room check looks up. One round of lookups each, and clubs get busy. */
const MAX_ROOM_CHECK = 12;

class ClubSecurity {
  readonly #ctx: Ctx;
  readonly #panel: ReportPanel;
  #instance: VrcInstance | undefined;
  /**
   * The avatar each player here was last seen in, so a switch can be noticed on a refresh.
   *
   * reuse: nothing holds the *previous* value. VRCNext knows what everyone is wearing now, and
   * that is all it knows — a change is the difference between two readings, so one of them has
   * to be remembered here. Cleared on leaving an instance, and pruned to who is present.
   */
  readonly #avatars = new Map<string, string>();
  /** Joiners currently being looked up, so a duplicate log line does not produce two reports. */
  readonly #inFlight = new Set<string>();
  /**
   * Until when joins count as "already here". VRChat logs an `OnPlayerJoined` for every player
   * present when the local player arrives, in one burst right after the local player's own line.
   */
  #settledAt = 0;
  /** Set while the plugin's tab is the one on screen; the host tells us when that changes. */
  #panelVisible = false;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
    this.#panel = new ReportPanel(ctx, {
      currentInstance: () => this.#instance,
      sendTest: () => this.#sendTest(),
      testSelf: () => this.#testSelf(),
      checkEveryoneHere: () => this.#checkEveryoneHere(),
      onVisibility: (visible) => {
        this.#panelVisible = visible;
        this.#syncTimer();
      },
    });
  }

  start(): void {
    this.#ctx.gameLog.onType(WORLD_JOIN_EVENT, () => {
      this.#startSettling();
      void this.#followArrival();
    });
    this.#ctx.gameLog.onType(JOIN_EVENT, (entry) => {
      void this.#onJoin({ name: entry.message, userId: entry.detail });
    });
    this.#panel.install();
    void this.#refreshInstance();
    this.#ctx.settings.onChange(() => { this.#syncTimer(); });
    this.#syncTimer();
    this.#ctx.disposables.add(() => { this.#stopTimer(); });
    this.#ctx.logger.info(`Club Security v${this.#ctx.version} watching for joins.`);
  }

  /**
   * Whether re-reading the instance on a timer earns its keep right now.
   *
   * Two things need it: the status card, while the user is looking at it, and the avatar watch,
   * which has nothing else to notice a switch with. With neither, a join reads the instance for
   * itself, so polling in the background would be work nobody asked for — and on a laptop in a
   * club, a request every thirty seconds forever.
   */
  #shouldPoll(): boolean {
    return this.#panelVisible
      || this.#ctx.settings.get('presets').some((preset) => preset.enabled && preset.watchAvatarChanges);
  }

  #syncTimer(): void {
    const wanted = this.#shouldPoll();
    if (wanted === (this.#timer !== undefined)) return;
    if (!wanted) {
      this.#stopTimer();
      return;
    }
    this.#timer = setInterval(() => { void this.#refreshInstance(); }, INSTANCE_REFRESH_MS);
    void this.#refreshInstance();
  }

  #stopTimer(): void {
    if (this.#timer === undefined) return;
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** Re-reads where we are until the answer stops being the world we left. */
  async #followArrival(): Promise<void> {
    const before = this.#instance?.location;
    await this.#refreshInstance();
    for (const delay of ARRIVAL_RETRY_MS) {
      if (this.#instance?.location !== before) return;
      await new Promise((resolve) => { setTimeout(resolve, delay); });
      if (this.#ctx.signal.aborted) return;
      await this.#refreshInstance();
    }
    if (this.#instance?.location === before) {
      this.#ctx.logger.debug('Arrived in a new instance but VRCNext still reports the old one.');
    }
  }

  async #refreshInstance(): Promise<void> {
    try {
      // reuse: VRCNext refreshes instance info on events only — `vrcWorldJoined`, friend
      // updates — never on a timer, so the mirror cannot notice an avatar switch inside an
      // instance nobody left. Noticing that is the whole job of this poll, and `#syncTimer`
      // stops it whenever neither the status card nor the avatar watch wants it.
      const instance = await this.#ctx.vrchat.currentInstance({ cached: false, signal: this.#ctx.signal });
      const previous = this.#instance;
      this.#instance = instance;
      if (instance !== undefined) {
        if (previous !== undefined && previous.location !== instance.location) this.#avatars.clear();
        this.#noteAvatars(instance);
      }
    } catch (error) {
      this.#ctx.logger.debug(`Current instance not available: ${String(error)}`);
    }
    this.#panel.refresh();
  }

  /**
   * Records who wears what, and reports a change.
   *
   * VRChat's log says nothing about someone else changing avatar, so this comes from the
   * instance the host mirrors: a player whose `avatarId` differs from the one last seen here
   * switched. The first sighting only records, because there is nothing to compare it with.
   */
  #noteAvatars(instance: VrcInstance): void {
    const me = this.#ctx.vrchat.self();
    for (const user of instance.users) {
      if (user.avatarId === '' || user.id === '') continue;
      const before = this.#avatars.get(user.id);
      this.#avatars.set(user.id, user.avatarId);
      if (before === undefined || before === user.avatarId) continue;
      if (user.id === me?.id) continue;
      void this.#onAvatarChange({ name: user.displayName, userId: user.id }, instance);
    }
    // Someone who left should not keep a slot; their next join records afresh.
    const here = new Set(instance.users.map((u) => u.id));
    for (const id of [...this.#avatars.keys()]) {
      if (!here.has(id)) this.#avatars.delete(id);
    }
  }

  /**
   * The avatar limits, re-checked against what they changed into.
   *
   * Every switch is logged, whatever the verdict. A rank that came back `met` is still the one
   * fact nothing else records — the player wore something else and it was fine — and a rank that
   * came back unknown is not a pass: the check is `unverified`, the report is orange, and it
   * goes out on every channel exactly like one that failed. The only thing a preset's rank
   * floors decide is whether there is a requirement to report *against*; with neither floor set
   * there is nothing to judge, so the switch is logged and nothing is sent.
   */
  async #onAvatarChange(joiner: Joiner, instance: VrcInstance): Promise<void> {
    const presets = this.#presetsFor(joiner, instance).filter((p) => p.watchAvatarChanges);
    if (presets.length === 0) return;
    try {
      const facts = await collectAvatarFacts(this.#ctx.vrchat, joiner, instance, {
        signal: this.#ctx.signal,
        onImages: (note) => { this.#ctx.logger.debug(note); },
        extraApiRequests: this.#ctx.settings.get('allowExtraApiRequests'),
      });
      this.#ctx.logger.info(`${joiner.name} switched avatar: ${avatarLine(facts)}`);
      for (const preset of presets) {
        const evaluation = evaluate(preset, facts, { only: AVATAR_CHECKS });
        if (evaluation.checks.length === 0) {
          this.#ctx.logger.debug(`Preset "${preset.name}" sets no avatar rank floor, so the switch is not reported.`);
          continue;
        }
        await this.#send({ at: Date.now(), kind: 'avatar', preset, joiner, instance, facts, evaluation });
      }
    } catch (error) {
      this.#ctx.logger.error(`Avatar change for ${joiner.name} could not be checked: ${String(error)}`);
    }
  }

  /** The presets watching this instance that have not whitelisted this player. */
  #presetsFor(joiner: Joiner, instance: VrcInstance): readonly Preset[] {
    return matchingPresets(this.#ctx.settings.get('presets'), instance, joiner.userId);
  }

  #startSettling(): void {
    this.#settledAt = Date.now() + this.#ctx.settings.get('settleSecs') * 1000;
  }

  #isSelf(joiner: Joiner): boolean {
    const me = this.#ctx.vrchat.self();
    if (me === undefined) return false;
    return joiner.userId !== '' ? joiner.userId === me.id : joiner.name === me.displayName;
  }

  async #onJoin(joiner: Joiner): Promise<void> {
    if (joiner.name === '') return;
    if (this.#isSelf(joiner)) {
      this.#startSettling();
      return;
    }
    if (Date.now() < this.#settledAt) {
      // VRCNext records the meeting itself, so nothing is lost by not reporting it.
      this.#ctx.logger.debug(`${joiner.name} was already here when you joined; not reported.`);
      return;
    }
    const key = joiner.userId === '' ? `name:${joiner.name}` : joiner.userId;
    if (this.#inFlight.has(key)) return;
    this.#inFlight.add(key);
    try {
      // reuse: the poll's own answer first; this is the path where it has not run yet, and a
      // report placed in the wrong instance is worse than one request.
      const instance = this.#instance ?? (await this.#ctx.vrchat.currentInstance({ cached: false, signal: this.#ctx.signal }));
      if (instance === undefined) {
        this.#ctx.logger.debug(`${joiner.name} joined but the current instance is not known.`);
        return;
      }
      this.#instance = instance;
      const presets = this.#presetsFor(joiner, instance);
      if (presets.length === 0) return;
      await this.#report(joiner, instance, presets, this.#ctx.settings.get('collectTimeoutSecs') * 1000);
    } catch (error) {
      this.#ctx.logger.error(`Report for ${joiner.name} failed: ${String(error)}`);
    } finally {
      this.#inFlight.delete(key);
    }
  }

  /** One fact collection, then one report per preset. */
  async #report(joiner: Joiner, instance: VrcInstance, presets: readonly Preset[], deadlineMs: number): Promise<void> {
    const facts = await collectFacts(this.#ctx.vrchat, joiner, instance, {
      onImages: (note) => { this.#ctx.logger.debug(note); },
      extraApiRequests: this.#ctx.settings.get('allowExtraApiRequests'),
      deadlineMs,
      signal: this.#ctx.signal,
      wantsGroups: presets.some((p) => p.requiredGroup !== ''),
      sql: this.#ctx.sql,
    });
    for (const preset of presets) {
      await this.#send({ at: Date.now(), kind: 'join', preset, joiner, instance, facts, evaluation: evaluate(preset, facts) });
    }
  }

  /**
   * Shows a report in the panel, writes it to the log and fans it out to the channels.
   *
   * `deliver: false` stops at the panel. A dry check of yourself or of the room is something a
   * moderator may want to run repeatedly, and every run reaching the club's Discord would make
   * the button unusable for exactly the person it is for.
   */
  async #send(report: Report, deliver = true): Promise<void> {
    this.#panel.push(report);
    const what = report.kind === 'avatar' ? 'switched avatar' : 'joined';
    this.#ctx.logger.info(`${report.preset.name}: ${report.joiner.name} ${what} — ${report.evaluation.verdict}` +
      (report.evaluation.checks.length === 0 ? '' : ` (${report.evaluation.checks.map((c) => `${c.label}: ${c.detail}`).join(', ')})`));
    if (deliver) await notify(this.#ctx, report);
  }

  /** The enabled presets, or a toast saying there are none to test with. */
  #testablePresets(): readonly Preset[] {
    const presets = this.#ctx.settings.get('presets').filter((preset) => preset.enabled);
    if (presets.length === 0) this.#ctx.notifications.toast({ message: 'No enabled preset to test.', ok: false });
    return presets;
  }

  /**
   * One player through every enabled preset, filters and whitelists ignored.
   *
   * Ignoring them is the point of a test: a preset that would not have watched this instance
   * still says what it would have said, and a whitelisted player still gets a verdict. Which
   * presets would really have matched is in the log rather than in the verdict.
   */
  async #runTest(replay: Replay, presets: readonly Preset[], deliver: boolean): Promise<void> {
    const { joiner, instance } = replay;
    if (!replay.located) this.#ctx.logger.warn(`Where ${joiner.name} was last seen is not recorded; the report uses a stand-in instance.`);
    const facts = await collectFacts(this.#ctx.vrchat, joiner, instance, {
      onImages: (note) => { this.#ctx.logger.debug(note); },
      extraApiRequests: this.#ctx.settings.get('allowExtraApiRequests'),
      deadlineMs: this.#ctx.settings.get('collectTimeoutSecs') * 1000,
      signal: this.#ctx.signal,
      wantsGroups: presets.some((p) => p.requiredGroup !== ''),
      sql: this.#ctx.sql,
    });
    for (const preset of presets) {
      if (!presetMatches(preset, instance)) {
        this.#ctx.logger.info(`Test: "${preset.name}" would not have watched this instance; reporting anyway.`);
      }
      await this.#send({ at: Date.now(), kind: 'join', preset, joiner, instance, facts, evaluation: evaluate(preset, facts) }, deliver);
    }
  }

  /**
   * You, through every enabled preset — the one player the plugin otherwise never reports.
   *
   * `#isSelf` and the whitelist exist so a moderator's own arrivals stay out of the channel,
   * which also means there is no way to find out how a preset's rules treat you. This is that
   * way.
   *
   * It delivers to the channels like any other report, because "how would I be treated" includes
   * the notification: a desktop toast that never arrives and a webhook that stays silent are
   * exactly the failures this button is worth pressing to find. It is one player on one click,
   * so it cannot run away with the club's Discord the way the room check could.
   */
  async #testSelf(): Promise<void> {
    const presets = this.#testablePresets();
    if (presets.length === 0) return;
    const replay = await selfCheck({ vrchat: this.#ctx.vrchat, signal: this.#ctx.signal, currentInstance: this.#instance });
    if (replay === undefined) {
      this.#ctx.notifications.toast({ message: 'Not signed in to VRChat yet, so there is no account to check.', ok: false });
      return;
    }
    await this.#runTest(replay, presets, true);
    this.#ctx.notifications.toast({
      message: `Checked yourself against ${String(presets.length)} preset(s); reports were sent.`,
    });
  }

  /**
   * Everyone in your instance right now, checked without sending anything.
   *
   * The door check: who in this room would the rules have turned away? Bounded, because it is
   * one round of lookups per player and a full instance is eighty of them.
   */
  async #checkEveryoneHere(): Promise<void> {
    const presets = this.#testablePresets();
    if (presets.length === 0) return;
    const instance = this.#instance;
    if (instance === undefined || instance.users.length === 0) {
      this.#ctx.notifications.toast({ message: 'Not in an instance VRCNext can see anyone in.', ok: false });
      return;
    }
    const me = this.#ctx.vrchat.self();
    const here = instance.users.filter((user) => user.id !== '' && user.id !== me?.id).slice(0, MAX_ROOM_CHECK);
    if (here.length === 0) {
      this.#ctx.notifications.toast({ message: 'Nobody else is here.', ok: false });
      return;
    }
    for (const user of here) {
      await this.#runTest({ joiner: { name: user.displayName, userId: user.id }, instance, located: true }, presets, false);
    }
    const capped = instance.users.length - 1 > MAX_ROOM_CHECK ? ` (first ${String(MAX_ROOM_CHECK)})` : '';
    this.#ctx.notifications.toast({ message: `Checked ${String(here.length)} player(s) here${capped}; shown here only.` });
  }

  /**
   * The last join VRCNext recorded, replayed through every enabled preset.
   *
   * Each preset evaluates the same real player with its own requirements, so the test shows
   * what that preset would actually have reported rather than a made-up verdict. This one does
   * reach the channels: exercising them is what it is for.
   */
  async #sendTest(): Promise<void> {
    const presets = this.#testablePresets();
    if (presets.length === 0) return;
    const replay = await lastJoin({
      vrchat: this.#ctx.vrchat,
      signal: this.#ctx.signal,
      currentInstance: this.#instance,
    });
    if (replay === undefined) {
      this.#ctx.notifications.toast({ message: 'VRCNext has not recorded anyone yet; nothing to replay.', ok: false });
      return;
    }
    await this.#runTest(replay, presets, true);
    this.#ctx.notifications.toast({
      message: `Replayed ${replay.joiner.name} through ${String(presets.length)} preset(s).`,
    });
  }
}

export default definePlugin({
  id: 'club-security' as PluginId,
  settings,

  activate(ctx) {
    new ClubSecurity(ctx).start();
  },

  deactivate() {
    // Every listener and panel went through `ctx`, so the host tears them down.
  },
});
