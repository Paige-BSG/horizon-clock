import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commonsScenes,
  catalogIds,
  catalogUrl,
  imageInfoUrl,
  validImageUrl,
  validSourceUrl,
  validCachedScene,
  plainCredit,
  boundedBody,
} from '../lib/gallery-model.js';
import { normalizeSettings, exportSettings, importSettings } from '../lib/settings.js';

function page(overrides = {}) {
  return {
    pageid: 123,
    title: 'File:Lake.jpg',
    imageinfo: [
      {
        width: 3000,
        height: 2000,
        mime: 'image/jpeg',
        sha1: 'a'.repeat(40),
        thumburl:
          'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Lake.jpg/1920px-Lake.jpg?utm_source=commons',
        descriptionurl: 'https://commons.wikimedia.org/wiki/File:Lake.jpg',
        extmetadata: {
          Artist: { value: '<a href="x">Test &amp; Author</a>' },
          LicenseShortName: { value: 'CC BY-SA 4.0' },
        },
        ...overrides,
      },
    ],
  };
}
const data = (pages) => ({ query: { pages } });

test('catalog selects licensed landscape JPEGs, retains attribution and rejects unknown licensing', () => {
  const result = commonsScenes(
    data([page(), page(), { ...page(), pageid: 2, imageinfo: page({ extmetadata: {} }).imageinfo }])
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].artist, 'Test & Author');
  assert.equal(result[0].licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0/');
  assert.ok(!result[0].imageUrl.includes('?'));
  for (const changes of [
    { width: 1000 },
    { height: 3000 },
    { mime: 'image/svg+xml' },
    { sha1: 'unknown' },
    { thumburl: 'https://evil.test/a.jpg' },
  ])
    assert.equal(commonsScenes(data([page(changes)])).length, 0);
  assert.equal(commonsScenes(data([page()]), ['commons:123']).length, 0);
  assert.equal(plainCredit('A &#x1F30D; &lt;script&gt;'), 'A 🌍 <script>'); // Always rendered as text, never markup.
});

test('external URLs allow only Commons JPEG thumbnails and source file pages', () => {
  for (const value of [
    'http://thumb.wikimedia.org/wikipedia/commons/thumb/a.jpg',
    'https://thumb.wikimedia.org.evil.test/wikipedia/commons/thumb/a.jpg',
    'https://u@thumb.wikimedia.org/wikipedia/commons/thumb/a.jpg',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/a.svg',
  ])
    assert.equal(validImageUrl(value), null);
  assert.equal(validSourceUrl('https://commons.wikimedia.org/wiki/File:Lake.jpg?redirect=x'), null);
  assert.equal(validSourceUrl('javascript:alert(1)'), null);
  assert.ok(validSourceUrl('https://commons.wikimedia.org/wiki/File:Lake.jpg'));
});

test('category request preserves newest-first IDs independently from page-ID response order', () => {
  const ids = catalogIds({
    query: { categorymembers: [{ pageid: 321 }, { pageid: 123 }, { pageid: 321 }, { pageid: -1 }] },
  });
  assert.deepEqual(ids, [321, 123]);
  assert.equal(new URL(catalogUrl()).searchParams.get('cmdir'), 'desc');
  assert.equal(new URL(catalogUrl()).searchParams.get('cmnamespace'), '6');
  assert.equal(new URL(imageInfoUrl(ids)).searchParams.get('pageids'), '321|123');
  assert.throws(() => imageInfoUrl([]));
  assert.throws(() => catalogIds({ error: {} }));
});

test('bounded downloads reject oversized headers, streamed bodies and HTTP failures', async () => {
  assert.deepEqual(await boundedBody(new Response('abc'), 3), new Uint8Array([97, 98, 99]));
  await assert.rejects(boundedBody(new Response('abc'), 2));
  await assert.rejects(boundedBody(new Response('a', { headers: { 'Content-Length': '100' } }), 2));
  await assert.rejects(boundedBody(new Response('denied', { status: 403 }), 100));
});

test('cached metadata must retain JPEG blobs, trusted links and matching license', () => {
  const scene = {
    ...commonsScenes(data([page()]))[0],
    image: new Blob(['jpeg'], { type: 'image/jpeg' }),
    thumbnail: new Blob(['jpeg'], { type: 'image/jpeg' }),
  };
  assert.ok(validCachedScene(scene));
  for (const changes of [
    { image: null },
    { src: 'https://evil.test/image' },
    { licenseUrl: 'https://evil.test/license' },
    { revision: undefined },
  ])
    assert.ok(!validCachedScene({ ...scene, ...changes }));
});

test('online consent stays on this device while Commons scene choices survive backups', () => {
  const source = normalizeSettings({ onlineEnabled: true, scene: 'commons:123' });
  const backup = exportSettings(source);
  assert.equal(JSON.parse(backup).settings.onlineEnabled, undefined);
  assert.equal(importSettings(backup, normalizeSettings()).onlineEnabled, false);
  assert.equal(importSettings(backup, normalizeSettings()).scene, 'commons:123');
  assert.equal(normalizeSettings({ scene: 'commons:invalid' }).scene, 'lake');
});
