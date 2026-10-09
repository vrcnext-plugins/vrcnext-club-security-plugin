/**
 * The name history: what it drops, how it orders, and that it cannot overflow a Discord field.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import { EMBED_LIMITS } from '@vrcnext/plugin-api';

import { nameHistory, previousNames, type SeenName } from './names.js';

function seen(name: string, lastSeen: string, firstSeen = lastSeen): SeenName {
  return { name, firstSeen, lastSeen };
}

const HISTORY: readonly SeenName[] = [
  seen('Kαʅαɳí', '2026-09-23T10:02:52.000Z', '2026-04-03T21:15:01.000Z'),
  seen('~καlαπí~', '2025-09-06T18:22:37.000Z', '2025-07-14T00:40:13.000Z'),
  seen('〜ドル箱〜', '2025-01-13T09:20:31.000Z', '2024-11-13T04:15:10.000Z'),
];

test('the current name is dropped, and the rest are newest first', () => {
  const former = previousNames(HISTORY, { current: 'Kαʅαɳí' });
  assert.deepEqual(former.map((s) => s.name), ['~καlαπí~', '〜ドル箱〜']);
});

test('order comes from the records, not from the order they arrived in', () => {
  const shuffled = [HISTORY[2], HISTORY[0], HISTORY[1]] as readonly SeenName[];
  const former = previousNames(shuffled, { current: 'Kαʅαɳí' });
  assert.deepEqual(former.map((s) => s.name), ['~καlαπí~', '〜ドル箱〜']);
});

test('each line is the name in code ticks and a relative Discord stamp', () => {
  const lines = nameHistory(HISTORY, { current: 'Kαʅαɳí' }).split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0] ?? '', /^- `~καlαπí~` <t:\d+:R>$/);
});

test('a player seen under one name only says nothing, so the field is dropped', () => {
  assert.equal(nameHistory([seen('Bluscream', '2026-09-23T10:02:52.000Z')], { current: 'Bluscream' }), '');
});

test('no history at all is not the same as a history of none, but reads the same here', () => {
  assert.equal(nameHistory(undefined, { current: 'Bluscream' }), '');
  assert.deepEqual(previousNames(undefined), []);
});

test('a rename to and from the same name is still one entry per recorded name', () => {
  // The query groups by name, so this is what a round trip looks like: the name it came back to
  // is the current one and goes, the one in between stays.
  const former = previousNames(
    [seen('A', '2026-02-01T00:00:00.000Z'), seen('B', '2026-01-01T00:00:00.000Z')],
    { current: 'A' },
  );
  assert.deepEqual(former.map((s) => s.name), ['B']);
});

test('a prolific renamer fits the field, with a gap row for the rest', () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    seen(`${'N'.repeat(40)}${String(i)}`, `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`));
  const value = nameHistory(many, { current: 'nobody', limit: 40 });
  assert.ok(value.length <= EMBED_LIMITS.fieldValue, `${String(value.length)} characters`);
  assert.ok(value.includes('- ...'), 'says that something was left out');
  for (const line of value.split('\n')) assert.ok(line.startsWith('- '), line);
});

test('a name padded with spaces still counts as the current one', () => {
  assert.deepEqual(previousNames([seen(' Bluscream ', '2026-01-01T00:00:00.000Z')], { current: 'Bluscream' }), []);
});
