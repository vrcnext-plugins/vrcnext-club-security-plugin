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
}

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
    userTimeline: () => Promise.resolve([]),
    userGroups: () => Promise.resolve([]),
    group: () => Promise.resolve(undefined),
  } as unknown as VrchatApi;
}

function collect(fake: Fake): Promise<{ userImageUrl: string; avatarImageUrl: string }> {
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
