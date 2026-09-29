/**
 * Which picture a report may show.
 *
 * VRCNext serves user pictures from its own cache on this machine — `http://localhost:…/imgcache/`
 * — and Discord fetches an embed's images from its own servers, where that address is nothing.
 * The failure is silent: a field with no picture and no error. So the facts carry only URLs that
 * would load somewhere else.
 */

import assert from 'node:assert/strict';
import { test } from 'vitest';

import type { VrchatApi } from '@vrcnext/plugin-api';

import { collectFacts } from './facts.js';

const CACHED = 'http://localhost:51956/imgcache/Users/usr_1.png?v=1&thumb=96';
const PROFILE = 'https://api.vrchat.cloud/api/1/file/file_profile/1/file';
const AVATAR_THUMB = 'https://api.vrchat.cloud/api/1/image/file_avatar/1/256';

interface Fake {
  readonly imageUrl?: string;
  readonly currentAvatarImageUrl?: string;
  readonly avatarThumb?: string;
  readonly avatarImage?: string;
  /** What VRCNext recorded when it downloaded the picture, by cache key. */
  readonly stored?: Readonly<Record<string, string>>;
}

/** Cache keys `originalImageUrl` was asked for, in order, so the ordering can be asserted. */
let asked: string[] = [];

function vrchat(fake: Fake): VrchatApi {
  return {
    user: () => Promise.resolve({
      id: 'usr_1',
      displayName: 'Joiner',
      imageUrl: fake.imageUrl ?? '',
      currentAvatarImageUrl: fake.currentAvatarImageUrl ?? '',
      tags: [],
      groups: [],
      dateJoined: '2021-01-01',
      ageVerified: true,
      ageVerificationStatus: '18+',
      bio: '',
      isFriend: false,
      platform: 'standalonewindows',
    }),
    avatar: () => Promise.resolve({
      id: 'avtr_1',
      name: 'Ava',
      thumbnailImageUrl: fake.avatarThumb ?? '',
      imageUrl: fake.avatarImage ?? '',
      pcRank: 'Good',
      questRank: 'Poor',
    }),
    instanceAvatar: () => Promise.resolve({ avatarId: 'avtr_1', avatarName: 'Ava' }),
    originalImageUrl: (subject: { kind: string; id: string }) => {
      const key = `${subject.kind}:${subject.id}`;
      asked.push(key);
      return Promise.resolve(fake.stored?.[key] ?? '');
    },
    userTimeline: () => Promise.resolve([]),
    userGroups: () => Promise.resolve([]),
    group: () => Promise.resolve(undefined),
  } as unknown as VrchatApi;
}

function collect(fake: Fake): Promise<{ userImageUrl: string; avatarImageUrl: string }> {
  asked = [];
  return collectFacts(vrchat(fake), { name: 'Joiner', userId: 'usr_1' }, undefined, {
    deadlineMs: 1000,
    signal: new AbortController().signal,
    wantsGroups: false,
  });
}

test('the profile picture is the one VRChat serves, not VRCNext\'s cache', async () => {
  const facts = await collect({ imageUrl: CACHED, currentAvatarImageUrl: PROFILE });
  assert.equal(facts.userImageUrl, PROFILE);
});

test('a picture only this machine can load is left out, so the field drops', async () => {
  const facts = await collect({ imageUrl: CACHED, currentAvatarImageUrl: '' });
  assert.equal(facts.userImageUrl, '', 'better an empty author icon than one pointing at a laptop');
});

test('the avatar thumbnail is preferred, and its full image is the fallback', async () => {
  assert.equal((await collect({ avatarThumb: AVATAR_THUMB })).avatarImageUrl, AVATAR_THUMB);
  assert.equal((await collect({ avatarThumb: '', avatarImage: AVATAR_THUMB })).avatarImageUrl, AVATAR_THUMB);
  assert.equal((await collect({ avatarThumb: CACHED, avatarImage: CACHED })).avatarImageUrl, '');
});

test('a public address already in the payload is used, without asking the database', async () => {
  const facts = await collect({
    imageUrl: CACHED,
    currentAvatarImageUrl: PROFILE,
    stored: { 'user:usr_1': 'https://api.vrchat.cloud/api/1/image/file_stored/1/800' },
  });
  assert.equal(facts.userImageUrl, PROFILE, 'what VRCNext already fetched costs nothing to use');
  assert.ok(!asked.includes('user:usr_1'), 'the database is a fallback, not the first stop');
});

test('when every address is this machine only, VRCNext\'s recorded one is used', async () => {
  const stored = 'https://api.vrchat.cloud/api/1/image/file_stored/1/800';
  const facts = await collect({
    imageUrl: CACHED,
    currentAvatarImageUrl: '',
    avatarThumb: CACHED,
    stored: { 'user:usr_1': stored, 'avatar:avtr_1': stored },
  });
  assert.equal(facts.userImageUrl, stored);
  assert.equal(facts.avatarImageUrl, stored);
  assert.deepEqual([...asked].sort(), ['avatar:avtr_1', 'user:usr_1']);
});

test('a recorded address that is somehow local is refused like any other', async () => {
  const facts = await collect({ imageUrl: CACHED, stored: { 'user:usr_1': CACHED } });
  assert.equal(facts.userImageUrl, '', 'checked rather than trusted, whatever the database holds');
});

test('no address anywhere drops the field, and says both halves failed', async () => {
  const notes: string[] = [];
  const facts = await collectFacts(vrchat({ imageUrl: CACHED }), { name: 'Joiner', userId: 'usr_1' }, undefined, {
    deadlineMs: 1000,
    signal: new AbortController().signal,
    wantsGroups: false,
    onImages: (note) => { notes.push(note); },
  });
  assert.equal(facts.userImageUrl, '');
  assert.ok(
    notes.some((n) => n.includes('VRCNext recorded no other address')),
    `the log should say the fallback was tried too: ${notes.join(' | ')}`,
  );
});
