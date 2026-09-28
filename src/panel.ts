/**
 * The plugin's sidebar tab: status per preset, the last reports, and a test button.
 * Built from `ctx.ui.kit` so it is VRCNext's own markup and follows its theme.
 */

import { timeAgo, type PluginContext, type UiBadgeTone, type VrcInstance } from '@vrcnext/plugin-api';

import { describePreset, presetMatches } from './filters.js';
import type { Report } from './report.js';
import { VERDICT_EMOJI, VERDICT_TEXT, type Check, type Verdict } from './requirements.js';
import type { Settings } from './settings.js';

type Ctx = PluginContext<Settings>;

const MAX_SHOWN = 25;

const VERDICT_TONE: Readonly<Record<Verdict, UiBadgeTone>> = { met: 'ok', unverified: 'warning', failed: 'err' };

export interface PanelDeps {
  readonly currentInstance: () => VrcInstance | undefined;
  readonly sendTest: () => Promise<void>;
  /** You, through every enabled preset, with the self and whitelist skips bypassed. */
  readonly testSelf: () => Promise<void>;
  /** Everyone in your instance right now, checked without sending anything. */
  readonly checkEveryoneHere: () => Promise<void>;
  /** Told when the tab comes on screen and when it leaves, so polling can follow the user. */
  readonly onVisibility: (visible: boolean) => void;
}

export class ReportPanel {
  readonly #ctx: Ctx;
  readonly #deps: PanelDeps;
  readonly #reports: Report[] = [];
  #status: HTMLElement | undefined;
  #list: HTMLElement | undefined;
  /** Kept so the room check can grey out the moment you leave the instance. */
  #roomButton: HTMLButtonElement | undefined;

  constructor(ctx: Ctx, deps: PanelDeps) {
    this.#ctx = ctx;
    this.#deps = deps;
  }

  install(): void {
    this.#ctx.ui.addNavTab({
      label: 'Club Security',
      icon: 'security',
      render: (tab) => { this.#render(tab); },
      onVisibility: (visible) => {
        if (visible) this.refresh();
        this.#deps.onVisibility(visible);
      },
    });
    // The host renders every schema setting on this card before `render` runs.
    this.#ctx.ui.addSettingsCard({
      title: 'Club Security',
      icon: 'security',
      render: (card) => {
        card.appendChild(this.#ctx.ui.kit.description(
          'A join is reported once per enabled preset whose filters match the instance, and whitelisted players are skipped. Test the channels from the Club Security tab.',
        ));
      },
    });
    this.#ctx.settings.onChange(() => { this.refresh(); });
  }

  push(report: Report): void {
    this.#reports.unshift(report);
    if (this.#reports.length > MAX_SHOWN) this.#reports.length = MAX_SHOWN;
    this.refresh();
  }

  refresh(): void {
    const k = this.#ctx.ui.kit;
    if (this.#status !== undefined) k.setChildren(this.#status, this.#statusRows());
    if (this.#list !== undefined) k.setChildren(this.#list, this.#reportRows());
    if (this.#roomButton !== undefined) this.#roomButton.disabled = this.#deps.currentInstance() === undefined;
  }

  #render(tab: HTMLElement): void {
    const k = this.#ctx.ui.kit;
    this.#status = k.card({ title: 'Presets', icon: 'shield' });
    this.#list = k.card({ title: 'Recent reports', icon: 'history' });
    const actions = k.card({
      title: 'Actions',
      icon: 'build',
      children: [
        // Buttons with hover text rather than paragraphs: what each one does fits in its label,
        // and a moderator opening this tab mid-shift is looking for a control, not a briefing.
        k.buttonRow(
          k.button({
            label: 'Test self',
            icon: 'person_check',
            title: 'Runs your own account through every enabled preset, ignoring the rules that normally keep you out of reports, and sends the reports to their channels — so a silent webhook or a missing desktop notification shows up here. Uses your current instance, or the last one VRCNext recorded you in, or a stand-in when it has neither.',
            onClick: () => { void this.#deps.testSelf(); },
          }),
          this.#roomButton = k.button({
            label: 'Check everyone here',
            icon: 'groups',
            disabled: this.#deps.currentInstance() === undefined,
            title: 'Checks every player in your instance against every enabled preset, without sending anything. Needs VRChat running.',
            onClick: () => { void this.#deps.checkEveryoneHere(); },
          }),
          k.button({
            label: 'Replay last join',
            icon: 'send',
            title: 'Replays the last player VRCNext recorded through every enabled preset and sends the reports to their channels. Works with VRChat closed.',
            onClick: () => { void this.#deps.sendTest(); },
          }),
        ),
        k.badges(
          k.badge('ok', '✅ all verified'),
          k.badge('warning', '⚠️ not checkable'),
          k.badge('err', '⛔ requirement not met'),
        ),
      ],
    });
    tab.append(k.layout(k.pair(this.#status, actions), this.#list));
    this.refresh();
  }

  #statusRows(): readonly (HTMLElement | DocumentFragment)[] {
    const k = this.#ctx.ui.kit;
    const presets = this.#ctx.settings.get('presets');
    const instance = this.#deps.currentInstance();
    if (presets.length === 0) return [k.emptyState('No presets yet. Add one in Settings → Club Security.')];
    const rows = presets.map((preset) => {
      const matches = instance !== undefined && preset.enabled && presetMatches(preset, instance);
      const channels = [preset.toast && 'toast', preset.desktop && 'desktop', preset.vr && 'VR', preset.discord.enabled && 'Discord']
        .filter((c): c is string => typeof c === 'string');
      return k.row({
        label: preset.name,
        detail: `${describePreset(preset)} · ${channels.length === 0 ? 'no channels' : channels.join(', ')}`,
        value: !preset.enabled ? k.badge('neutral', 'Off') : instance === undefined ? k.badge('neutral', 'Waiting') : k.badge(matches ? 'ok' : 'neutral', matches ? 'Watching' : 'Not here'),
      });
    });
    rows.push(k.row({
      label: 'Current instance',
      detail: instance === undefined ? 'Not in an instance' : `${instance.worldName} · ${instance.instanceType}`,
    }));
    return rows;
  }

  /**
   * One pill per check.
   *
   * The pill's colour is the verdict, so the words are only what was found: `PC Very Poor`,
   * not `PC avatar rank: VeryPoor, needs Poor or better`. The emoji repeats the colour for
   * anyone who cannot tell the two reds apart.
   */
  #pills(report: Report): readonly HTMLElement[] {
    const k = this.#ctx.ui.kit;
    const pill = (check: Check): HTMLElement =>
      k.badge(VERDICT_TONE[check.verdict], `${VERDICT_EMOJI[check.verdict]} ${check.short}`);
    return report.evaluation.checks.map(pill);
  }

  /** Whether this is a face the instance has seen before — part of who they are, not a check. */
  #rejoinPill(report: Report): HTMLElement | undefined {
    const k = this.#ctx.ui.kit;
    const { seenHere, lastAt } = report.facts.rejoin;
    if (seenHere === false) return k.badge('neutral', 'First time here');
    if (seenHere !== true) return undefined;
    return k.badge('neutral', lastAt === undefined ? 'Seen here before' : `Seen ${timeAgo(lastAt)}`);
  }

  #reportRows(): readonly (HTMLElement | DocumentFragment)[] {
    const k = this.#ctx.ui.kit;
    if (this.#reports.length === 0) return [k.emptyState('No joins reported yet.')];
    return this.#reports.map((report) => {
      const time = new Date(report.at).toLocaleTimeString();
      const what = report.kind === 'avatar' ? ' · switched avatar' : '';
      const verdict = report.evaluation.verdict;
      return k.row({
        label: k.badges(`${time} · ${report.joiner.name} · ${report.preset.name}${what}`, this.#rejoinPill(report)),
        detail: k.badges(...this.#pills(report)),
        value: k.badge(VERDICT_TONE[verdict], VERDICT_TEXT[verdict]),
      });
    });
  }
}
