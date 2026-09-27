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

import { collectFacts, type Joiner } from './src/facts.js';
import { matchingPresets } from './src/filters.js';
import { notify } from './src/notify.js';
import { ReportPanel } from './src/panel.js';
import { evaluate } from './src/requirements.js';
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
      this.#instance = await this.#ctx.vrchat.currentInstance({ cached: false, signal: this.#ctx.signal });
    } catch (error) {
      this.#ctx.logger.debug(`Current instance not available: ${String(error)}`);
    }
    this.#panel.refresh();
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
      const presets = matchingPresets(this.#ctx.settings.get('presets'), instance);
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
      const report: Report = { at: Date.now(), preset, joiner, instance, facts, evaluation: evaluate(preset, facts) };
      this.#panel.push(report);
      this.#ctx.logger.info(`${preset.name}: ${joiner.name} — ${report.evaluation.verdict}` +
        (report.evaluation.checks.length === 0 ? '' : ` (${report.evaluation.checks.map((c) => `${c.label}: ${c.detail}`).join(', ')})`));
      await notify(this.#ctx, report);
    }
  }

  /** A report built from your own account in the current instance, to check the channels. */
  async #sendTest(): Promise<void> {
    await this.#refreshInstance();
    const instance = this.#instance;
    const self = this.#ctx.vrchat.self();
    if (instance === undefined || self === undefined) {
      this.#ctx.notifications.toast({ message: 'Join an instance first; the test uses it.', ok: false });
      return;
    }
    const presets = matchingPresets(this.#ctx.settings.get('presets'), instance);
    if (presets.length === 0) {
      this.#ctx.notifications.toast({ message: 'No enabled preset matches this instance.', ok: false });
      return;
    }
    await this.#report({ name: self.displayName, userId: self.id }, instance, presets, 10_000);
    this.#ctx.notifications.toast({ message: `Test report sent through ${String(presets.length)} preset(s).` });
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
