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
  /** What an uncached lookup would answer, for the opt-in extra request. */
  readonly refetchedProfile?: string;
  readonly refetchedAvatarThumb?: string;
}

/** Cache keys `originalImageUrl` was asked for, in order, so the ordering can be asserted. */
let asked: string[] = [];
/** Lookups made with `cached: false`, which are the ones that may cost a VRChat request. */
let uncached: string[] = [];

/**
 * What an uncached lookup answers, and a record that it was made.
 *
 * `undefined` means "nothing different": a refetch that changes nothing is a real outcome, and the
 * one worth asserting is that the request happened at all.
 */
function fresh(options: { cached?: boolean } | undefined, what: string, answer: string | undefined): string | undefined {
  if (options?.cached !== false) return undefined;
  uncached.push(what);
  return answer;
}

function vrchat(fake: Fake): VrchatApi {
  return {
    user: (_id: string, options?: { cached?: boolean }) => Promise.resolve({
      id: 'usr_1',
      displayName: 'Joiner',
      imageUrl: fake.imageUrl ?? '',
      currentAvatarImageUrl: fresh(options, 'user', fake.refetchedProfile) ?? fake.currentAvatarImageUrl ?? '',
      tags: [],
      groups: [],
      dateJoined: '2021-01-01',
      ageVerified: true,
      ageVerificationStatus: '18+',
      bio: '',
      isFriend: false,
      platform: 'standalonewindows',
    }),
    avatar: (_id: string, options?: { cached?: boolean }) => Promise.resolve({
      id: 'avtr_1',
      name: 'Ava',
      thumbnailImageUrl: fresh(options, 'avatar', fake.refetchedAvatarThumb) ?? fake.avatarThumb ?? '',
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
    // Read from the page arrays in the real thing; nothing loaded here, so every flag is unknown.
    moderations: () => ({ blocked: undefined, muted: undefined, chatMuted: undefined, avatarHidden: undefined, interactOff: undefined }),
  } as unknown as VrchatApi;
}

function collect(fake: Fake, extraApiRequests = false): Promise<{ userImageUrl: string; avatarImageUrl: string }> {
  asked = [];
  uncached = [];
  return collectFacts(vrchat(fake), { name: 'Joiner', userId: 'usr_1' }, undefined, {
    deadlineMs: 1000,
    signal: new AbortController().signal,
    wantsGroups: false,
    extraApiRequests,
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

test('nothing local to show costs no request unless the club allowed one', async () => {
  const facts = await collect({ imageUrl: CACHED, avatarThumb: CACHED, refetchedProfile: PROFILE });
  assert.equal(facts.userImageUrl, '', 'the opt-in is off, so the picture is dropped');
  assert.deepEqual(uncached, [], 'a club that did not ask for extra requests never pays for one');
});

test('with the opt-in on, a picture neither free answer could supply is looked up again', async () => {
  const facts = await collect(
    { imageUrl: CACHED, avatarThumb: CACHED, refetchedProfile: PROFILE, refetchedAvatarThumb: AVATAR_THUMB },
    true,
  );
  assert.equal(facts.userImageUrl, PROFILE);
  assert.equal(facts.avatarImageUrl, AVATAR_THUMB);
  assert.deepEqual([...uncached].sort(), ['avatar', 'user']);
});

test('the extra request is last, so a picture the database knows never triggers one', async () => {
  const stored = 'https://api.vrchat.cloud/api/1/image/file_stored/1/800';
  const facts = await collect(
    { imageUrl: CACHED, avatarThumb: CACHED, stored: { 'user:usr_1': stored, 'avatar:avtr_1': stored } },
    true,
  );
  assert.equal(facts.userImageUrl, stored);
  assert.deepEqual(uncached, [], 'an indexed read on this machine beats asking VRChat again');
});

test('the note tells a club the opt-in exists, rather than only that it failed', async () => {
  const notes: string[] = [];
  await collectFacts(vrchat({ imageUrl: CACHED }), { name: 'Joiner', userId: 'usr_1' }, undefined, {
    deadlineMs: 1000,
    signal: new AbortController().signal,
    wantsGroups: false,
    onImages: (note) => { notes.push(note); },
  });
  assert.ok(
    notes.some((n) => n.includes('Allow making extra API requests')),
    `the log should name the switch that would help: ${notes.join(' | ')}`,
  );
});
