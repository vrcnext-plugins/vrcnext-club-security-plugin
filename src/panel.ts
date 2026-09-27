/**
 * The plugin's sidebar tab: status per preset, the last reports, and a test button.
 * Built from `ctx.ui.kit` so it is VRCNext's own markup and follows its theme.
 */

import type { PluginContext, UiBadgeTone, VrcInstance } from '@vrcnext/plugin-api';

import { describePreset, presetMatches } from './filters.js';
import { reportLines, type Report } from './report.js';
import { VERDICT_TEXT, type Verdict } from './requirements.js';
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
          'A join is reported once per enabled preset whose filters match the instance. Test the channels from the Club Security tab.',
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
        k.description('A test report uses the current instance and your own account, and goes through every preset that matches it.'),
        k.description('Green: every requirement verified. Orange: something could not be checked. Red: a requirement was checked and not met.'),
        k.buttonRow(
          k.button({ label: 'Send test report', icon: 'send', onClick: () => { void this.#deps.sendTest(); } }),
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
    if (presets.length === 0) return [k.emptyState('No presets yet. Add one in Settings → Plugins → Club Security.')];
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

  #reportRows(): readonly (HTMLElement | DocumentFragment)[] {
    const k = this.#ctx.ui.kit;
    if (this.#reports.length === 0) return [k.emptyState('No joins reported yet.')];
    return this.#reports.map((report) => {
      const lines = reportLines(report, report.preset.template);
      const time = new Date(report.at).toLocaleTimeString();
      const verdict = report.evaluation.verdict;
      return k.row({
        label: `${time} · ${report.joiner.name} · ${report.preset.name}`,
        detail: lines.slice(1).join(' · '),
        value: k.badge(VERDICT_TONE[verdict], VERDICT_TEXT[verdict]),
      });
    });
  }
}
