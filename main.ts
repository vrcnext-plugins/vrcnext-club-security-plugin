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
import { lastJoin } from './src/replay.js';
import { AVATAR_CHECKS, evaluate } from './src/requirements.js';
import { type Report } from './src/report.js';
import { settings, type Preset } from './src/settings.js';

type Ctx = PluginContext<typeof settings>;

/** VRCNext's parsed game-log kinds for `[Behaviour] OnPlayerJoined` and `Joining wrld_…`. */
const JOIN_EVENT = 'gl_player_join';
const WORLD_JOIN_EVENT = 'gl_world_join';
/** How often the current instance is re-read while the tab is open, so its status stays honest. */
const INSTANCE_REFRESH_MS = 30_000;

class ClubSecurity {
  readonly #ctx: Ctx;
  readonly #panel: ReportPanel;
  #instance: VrcInstance | undefined;
  /** The avatar each player here was last seen in, so a switch can be noticed on a refresh. */
  readonly #avatars = new Map<string, string>();
  /** Joiners currently being looked up, so a duplicate log line does not produce two reports. */
  readonly #inFlight = new Set<string>();
  /**
   * Until when joins count as "already here". VRChat logs an `OnPlayerJoined` for every player
   * present when the local player arrives, in one burst right after the local player's own line.
   */
  #settledAt = 0;

  constructor(ctx: Ctx) {
    this.#ctx = ctx;
    this.#panel = new ReportPanel(ctx, {
      currentInstance: () => this.#instance,
      sendTest: () => this.#sendTest(),
    });
  }

  start(): void {
    this.#ctx.gameLog.onType(WORLD_JOIN_EVENT, () => {
      this.#startSettling();
      void this.#refreshInstance();
    });
    this.#ctx.gameLog.onType(JOIN_EVENT, (entry) => {
      void this.#onJoin({ name: entry.message, userId: entry.detail });
    });
    this.#panel.install();
    void this.#refreshInstance();
    const timer = setInterval(() => { void this.#refreshInstance(); }, INSTANCE_REFRESH_MS);
    this.#ctx.disposables.add(() => { clearInterval(timer); });
    this.#ctx.logger.info(`Club Security v${this.#ctx.version} watching for joins.`);
  }

  async #refreshInstance(): Promise<void> {
    try {
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
    const self = this.#ctx.vrchat.self();
    for (const user of instance.users) {
      if (user.avatarId === '' || user.id === '') continue;
      const before = this.#avatars.get(user.id);
      this.#avatars.set(user.id, user.avatarId);
      if (before === undefined || before === user.avatarId) continue;
      if (user.id === self?.id) continue;
      void this.#onAvatarChange({ name: user.displayName, userId: user.id }, instance);
    }
    // Someone who left should not keep a slot; their next join records afresh.
    const here = new Set(instance.users.map((u) => u.id));
    for (const id of [...this.#avatars.keys()]) {
      if (!here.has(id)) this.#avatars.delete(id);
    }
  }

  /** The avatar limits, re-checked against what they changed into. */
  async #onAvatarChange(joiner: Joiner, instance: VrcInstance): Promise<void> {
    const presets = this.#presetsFor(joiner, instance).filter((p) => p.watchAvatarChanges);
    if (presets.length === 0) return;
    try {
      const facts = await collectAvatarFacts(this.#ctx.vrchat, joiner, instance, this.#ctx.signal);
      for (const preset of presets) {
        const evaluation = evaluate(preset, facts, { only: AVATAR_CHECKS });
        if (evaluation.checks.length === 0) continue;
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
    const self = this.#ctx.vrchat.self();
    if (self === undefined) return false;
    return joiner.userId !== '' ? joiner.userId === self.id : joiner.name === self.displayName;
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
      deadlineMs,
      signal: this.#ctx.signal,
      wantsGroups: presets.some((p) => p.requiredGroup !== ''),
    });
    for (const preset of presets) {
      await this.#send({ at: Date.now(), kind: 'join', preset, joiner, instance, facts, evaluation: evaluate(preset, facts) });
    }
  }

  /** Shows a report in the panel, writes it to the log and fans it out to the channels. */
  async #send(report: Report): Promise<void> {
    this.#panel.push(report);
    const what = report.kind === 'avatar' ? 'switched avatar' : 'joined';
    this.#ctx.logger.info(`${report.preset.name}: ${report.joiner.name} ${what} — ${report.evaluation.verdict}` +
      (report.evaluation.checks.length === 0 ? '' : ` (${report.evaluation.checks.map((c) => `${c.label}: ${c.detail}`).join(', ')})`));
    await notify(this.#ctx, report);
  }

  /**
   * The last join VRCNext recorded, replayed through every enabled preset.
   *
   * Each preset evaluates the same real player with its own requirements, so the test shows
   * what that preset would actually have reported rather than a made-up verdict. Filters are
   * not applied — the point is to exercise the channels — and a preset whose filters would not
   * have matched says so in the log.
   */
  async #sendTest(): Promise<void> {
    const presets = this.#ctx.settings.get('presets').filter((preset) => preset.enabled);
    if (presets.length === 0) {
      this.#ctx.notifications.toast({ message: 'No enabled preset to test.', ok: false });
      return;
    }
    const replay = await lastJoin({
      vrchat: this.#ctx.vrchat,
      signal: this.#ctx.signal,
      currentInstance: this.#instance,
    });
    if (replay === undefined) {
      this.#ctx.notifications.toast({ message: 'VRCNext has not recorded anyone yet; nothing to replay.', ok: false });
      return;
    }
    const { joiner, instance } = replay;
    if (!replay.located) this.#ctx.logger.warn(`Where ${joiner.name} was met is not recorded; the world and instance placeholders will be empty.`);

    const facts = await collectFacts(this.#ctx.vrchat, joiner, instance, {
      deadlineMs: this.#ctx.settings.get('collectTimeoutSecs') * 1000,
      signal: this.#ctx.signal,
      wantsGroups: presets.some((p) => p.requiredGroup !== ''),
    });
    for (const preset of presets) {
      if (!presetMatches(preset, instance)) {
        this.#ctx.logger.info(`Test: "${preset.name}" would not have watched this instance; reporting anyway.`);
      }
      await this.#send({ at: Date.now(), kind: 'join', preset, joiner, instance, facts, evaluation: evaluate(preset, facts) });
    }
    this.#ctx.notifications.toast({
      message: `Replayed ${joiner.name} through ${String(presets.length)} preset(s).`,
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
