/**
 * Fans a report out to the preset's channels.
 *
 * - In-app toast: always available, one line.
 * - Desktop and VR: through the VRCNext Bridge's targets, addressed by name; VR overlays get the
 *   preset's VR template (WayVR draws with one font and shows nothing for emoji). On Windows,
 *   when the bridge delivers nothing, VRCNext's own tray toast and wrist overlay.
 * - Discord: the preset's embed, rendered with the report's values and posted to its webhook
 *   through `ctx.http.fetch`. Only `discord.com` is in the manifest's `hosts`.
 */

import {
  renderEmbed,
  webhookPayload,
  type PluginContext,
  type TemplateError,
} from '@vrcnext/plugin-api';

import { reportLines, reportSummary, reportValues, type Report } from './report.js';
import { templatesOf, type Settings } from './settings.js';

type Ctx = PluginContext<Settings>;

/** Matches the host declared in plugin.json; `ptb.`/`canary.` would need their own entries. */
const DISCORD_WEBHOOK = /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/;

function accentFor(report: Report): 'ok' | 'warn' | 'info' {
  if (report.evaluation.verdict === 'failed') return 'warn';
  if (report.evaluation.verdict === 'met') return 'ok';
  return 'info';
}

function warnTemplate(ctx: Ctx, report: Report, error: TemplateError): void {
  ctx.logger.warn(`Preset "${report.preset.name}": template is invalid, using the default: ${error.message}`);
}

/** Bridge targets: the VR overlay is the one whose name says so; the rest are desktop. */
function isVrTarget(name: string): boolean {
  return /wayvr|openvr|steamvr|overlay|xso/i.test(name);
}

/**
 * Through the bridge: `true` when at least one target accepted. `ok: false` with only the
 * `bridge` pseudo-sink failing means the bridge is not reachable, which is a normal state.
 */
async function sendNative(ctx: Ctx, report: Report): Promise<boolean> {
  const { preset } = report;
  let targets: readonly { readonly name: string }[];
  try {
    targets = await ctx.native.targets();
  } catch (error) {
    ctx.logger.debug(`Bridge targets not available: ${String(error)}`);
    return false;
  }
  const names = targets.map((t) => t.name);
  const templates = templatesOf(preset);
  const batches = [
    { sinks: preset.desktop ? names.filter((n) => !isVrTarget(n)) : [], template: templates.text },
    { sinks: preset.vr ? names.filter(isVrTarget) : [], template: templates.vr },
  ].filter((b) => b.sinks.length > 0);
  if (batches.length === 0) {
    ctx.logger.debug('The bridge has no target for the enabled channels.');
    return false;
  }
  let delivered = false;
  for (const batch of batches) {
    const lines = reportLines(report, batch.template, (e) => { warnTemplate(ctx, report, e); });
    const result = await ctx.native.notify({
      title: lines[0] ?? `${report.joiner.name} joined`,
      content: lines.slice(1).join('\n'),
      timeoutSecs: ctx.settings.get('notifyTimeoutSecs'),
      icon: 'security-high',
      sinks: batch.sinks,
      // Never critical: KDE ignores the expiry for critical notifications and keeps them on screen.
      urgency: 'normal',
    });
    for (const failure of result.failed) {
      if (failure.sink !== 'bridge') ctx.logger.warn(`Bridge target ${failure.sink} failed: ${failure.error}`);
    }
    delivered ||= result.ok;
  }
  return delivered;
}

async function sendDesktopAndVr(ctx: Ctx, report: Report): Promise<void> {
  const { preset } = report;
  if (!preset.desktop && !preset.vr) return;
  if (await sendNative(ctx, report)) return;

  // Windows without the bridge's targets: VRCNext's own tray toast and wrist overlay in one call.
  if (ctx.notifications.desktopAvailable) {
    const lines = reportLines(report, templatesOf(preset).text, (e) => { warnTemplate(ctx, report, e); });
    ctx.notifications.desktop({
      title: lines[0] ?? `${report.joiner.name} joined`,
      subtitle: lines.slice(1).join(' · '),
      accent: accentFor(report),
      ...(report.joiner.userId === '' ? {} : { friendId: report.joiner.userId }),
    });
    return;
  }
  ctx.logger.info('No desktop or VR channel is reachable: the bridge delivered nothing and this platform has no tray toast.');
}

async function sendDiscord(ctx: Ctx, report: Report): Promise<void> {
  const { discord } = report.preset;
  if (!discord.enabled) return;
  const url = discord.webhookUrl.trim();
  if (!DISCORD_WEBHOOK.test(url)) {
    ctx.logger.warn(`Preset "${report.preset.name}": Discord is on but the URL is not a discord.com webhook URL.`);
    return;
  }
  const embed = renderEmbed(discord.embed, reportValues(report), {
    at: new Date(report.at),
    onError: (error) => { ctx.logger.warn(`Preset "${report.preset.name}": embed template: ${error.message}`); },
  });
  if (embed === undefined) {
    ctx.logger.warn(`Preset "${report.preset.name}": the embed rendered empty; nothing posted.`);
    return;
  }
  const response = await ctx.http.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(webhookPayload(embed, { username: 'Club Security' })),
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  });
  if (!response.ok) ctx.logger.warn(`Discord webhook answered ${String(response.status)}.`);
}

/** Sends on every channel the preset enables. Never throws: a failed channel is logged. */
export async function notify(ctx: Ctx, report: Report): Promise<void> {
  if (report.preset.toast) ctx.notifications.toast({ message: reportSummary(report), ok: accentFor(report) !== 'warn' });
  const results = await Promise.allSettled([sendDesktopAndVr(ctx, report), sendDiscord(ctx, report)]);
  for (const result of results) {
    // The reason is passed through as well: a message alone loses the stack, and the one thing
    // worth knowing about a channel that fails rarely is where it failed.
    if (result.status === 'rejected') {
      ctx.logger.warn(`Notification channel failed: ${String(result.reason)}`, result.reason);
    }
  }
}
