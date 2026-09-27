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
}

export class ReportPanel {
  readonly #ctx: Ctx;
  readonly #deps: PanelDeps;
  readonly #reports: Report[] = [];
  #status: HTMLElement | undefined;
  #list: HTMLElement | undefined;

  constructor(ctx: Ctx, deps: PanelDeps) {
    this.#ctx = ctx;
    this.#deps = deps;
  }

  install(): void {
    this.#ctx.ui.addNavTab({
      label: 'Club Security',
      icon: 'security',
      render: (tab) => { this.#render(tab); },
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
  }

  #render(tab: HTMLElement): void {
    const k = this.#ctx.ui.kit;
    this.#status = k.card({ title: 'Presets', icon: 'shield' });
    this.#list = k.card({ title: 'Recent reports', icon: 'history' });
    const actions = k.card({
      title: 'Actions',
      icon: 'build',
      children: [
        k.description('A test replays the last player VRCNext recorded through every enabled preset, each with its own requirements. It reads VRCNext’s own records, so it works with VRChat closed.'),
        k.description('Green: every requirement verified. Orange: something could not be checked. Red: a requirement was checked and not met.'),
        k.buttonRow(
          k.button({ label: 'Replay last join', icon: 'send', onClick: () => { void this.#deps.sendTest(); } }),
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
   * One pill per check, then who they were wearing and whether they have been here before.
   *
   * The pill's colour is the verdict, so the words are only what was found: `PC Very Poor`,
   * not `PC avatar rank: VeryPoor, needs Poor or better`. The emoji repeats the colour for
   * anyone who cannot tell the two reds apart.
   */
  #pills(report: Report): readonly HTMLElement[] {
    const k = this.#ctx.ui.kit;
    const { facts } = report;
    const pill = (check: Check): HTMLElement =>
      k.badge(VERDICT_TONE[check.verdict], `${VERDICT_EMOJI[check.verdict]} ${check.short}`);
    const pills = report.evaluation.checks.map(pill);
    if (facts.avatarName !== '') pills.push(k.badge('neutral', facts.avatarName));
    const { seenHere, lastAt } = facts.rejoin;
    if (seenHere === true) {
      pills.push(k.badge('neutral', lastAt === undefined ? 'Seen here before' : `Seen ${timeAgo(lastAt)}`));
    } else if (seenHere === false) {
      pills.push(k.badge('neutral', 'First time here'));
    }
    return pills;
  }

  #reportRows(): readonly (HTMLElement | DocumentFragment)[] {
    const k = this.#ctx.ui.kit;
    if (this.#reports.length === 0) return [k.emptyState('No joins reported yet.')];
    return this.#reports.map((report) => {
      const time = new Date(report.at).toLocaleTimeString();
      const what = report.kind === 'avatar' ? ' · switched avatar' : '';
      const verdict = report.evaluation.verdict;
      return k.row({
        label: `${time} · ${report.joiner.name} · ${report.preset.name}${what}`,
        detail: k.badges(...this.#pills(report)),
        value: k.badge(VERDICT_TONE[verdict], VERDICT_TEXT[verdict]),
      });
    });
  }
}
