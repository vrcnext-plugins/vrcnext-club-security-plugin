/**
 * Decides which presets want reports for an instance.
 */

import type { VrcInstance } from '@vrcnext/plugin-api';

import type { Preset } from './settings.js';

/** What a filter looks at. */
export type InstanceShape = Pick<VrcInstance, 'worldId' | 'instanceType' | 'groupId'>;

export function presetMatches(preset: Preset, instance: InstanceShape): boolean {
  if (preset.instanceTypes.length > 0 && !(preset.instanceTypes as readonly string[]).includes(instance.instanceType)) return false;
  if (preset.group !== '' && instance.groupId.toLowerCase() !== preset.group.toLowerCase()) return false;
  if (preset.worlds.length > 0 && !preset.worlds.some((w) => w.toLowerCase() === instance.worldId.toLowerCase())) return false;
  return true;
}

/**
 * The enabled presets that match, in order. A preset that whitelisted `userId` is left out:
 * whitelisting is per preset, because one club's staff is another club's guest.
 */
export function matchingPresets(presets: readonly Preset[], instance: InstanceShape, userId = ''): readonly Preset[] {
  return presets.filter((p) => p.enabled && presetMatches(p, instance) && !isWhitelisted(p, userId));
}

/** Whether this preset never checks that player. An empty id is nobody, so never whitelisted. */
export function isWhitelisted(preset: Preset, userId: string): boolean {
  return userId !== '' && preset.whitelist.includes(userId);
}

/** One line for the status card: what a preset restricts to. */
export function describePreset(preset: Preset): string {
  const parts: string[] = [];
  if (preset.instanceTypes.length > 0) parts.push(`types: ${preset.instanceTypes.join(', ')}`);
  if (preset.group !== '') parts.push('one group');
  if (preset.worlds.length > 0) parts.push(`${String(preset.worlds.length)} world${preset.worlds.length === 1 ? '' : 's'}`);
  return parts.length === 0 ? 'every instance' : parts.join(' · ');
}
