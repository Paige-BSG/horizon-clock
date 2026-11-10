import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMusicQueue,
  readMode,
  readPlaybackPreferences,
  MUSIC_PREFERENCES_KEY,
} from '../lib/music-queue.js';
const songs = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

test('sequential stops at the end, list loops, and single repeat only repeats on natural EOF', () => {
  const queue = createMusicQueue();
  queue.sync('list', songs);
  assert.equal(queue.next('d', 'order', true), null);
  assert.equal(queue.next('d', 'loop', true), 'a');
  assert.equal(queue.next('b', 'one', true), 'b');
  assert.equal(queue.next('b', 'one', false), 'c');
  assert.equal(queue.previous('a', 'loop'), 'd');
});
test('shuffle plays every other track once before recycling and keeps actual Previous/Next history', () => {
  const queue = createMusicQueue(() => 0);
  queue.sync('list', songs);
  queue.record('a');
  const played = [];
  for (let i = 0; i < 3; i++) {
    const id = queue.next(i ? played.at(-1) : 'a', 'shuffle');
    played.push(id);
    queue.record(id, 'next');
  }
  assert.deepEqual(played, ['b', 'c', 'd']);
  const prior = queue.previous('d', 'shuffle');
  assert.equal(prior, 'c');
  queue.record(prior, 'previous');
  assert.equal(queue.next('c', 'shuffle'), 'd');
  queue.record('d', 'next');
  assert.notEqual(queue.next('d', 'shuffle'), 'd');
});
test('new pages join the shuffle cycle and switching playlists discards old history', () => {
  const queue = createMusicQueue(() => 0);
  queue.sync('first', songs.slice(0, 2));
  queue.record('a');
  queue.record('b', 'next');
  queue.sync('first', songs);
  assert.equal(queue.next('b', 'shuffle'), 'c');
  queue.sync('second', [{ id: 'x' }]);
  assert.equal(queue.hasPrevious(), false);
  assert.equal(queue.next('x', 'shuffle'), 'x');
  queue.sync('empty', []);
  assert.equal(queue.next(null, 'loop'), null);
});
test('only playback mode is restored; invalid or unavailable preferences default to list loop', () => {
  assert.equal(
    readMode({
      getItem: (key) => {
        assert.equal(key, MUSIC_PREFERENCES_KEY);
        return '{"mode":"shuffle","playing":true}';
      },
    }),
    'shuffle'
  );
  for (const text of ['null', '{}', '{"mode":"unknown"}', 'bad'])
    assert.equal(readMode({ getItem: () => text }), 'loop');
  assert.equal(
    readMode({
      getItem() {
        throw Error('Storage unavailable');
      },
    }),
    'loop'
  );
});

test('shuffle stops after one cycle without repeat and single repeat leaves manual Next available', () => {
  const queue = createMusicQueue(() => 0);
  queue.sync('list', songs);
  queue.record('a');
  for (const id of ['b', 'c', 'd']) {
    assert.equal(queue.next(queue.previous(id, 'order') || 'a', 'shuffle', false, 'order'), id);
    queue.record(id, 'next');
  }
  assert.equal(queue.hasNext('d', 'order'), false);
  assert.equal(queue.next('d', 'shuffle', true, 'order'), null);
  assert.equal(queue.next('d', 'shuffle', true, 'one'), 'd');
  assert.notEqual(queue.next('d', 'shuffle', false, 'one'), 'd');
  const single = createMusicQueue();
  single.sync('one', [{ id: 'x' }]);
  single.record('x');
  assert.equal(single.next('x', 'shuffle', true, 'order'), null);
});
test('legacy modes migrate and independent repeat choices restore without playback intent', () => {
  for (const mode of ['loop', 'one', 'order', 'shuffle']) {
    assert.deepEqual(
      readPlaybackPreferences({ getItem: () => JSON.stringify({ mode, playing: true }) }),
      { shuffle: mode === 'shuffle', repeat: mode === 'shuffle' ? 'loop' : mode }
    );
  }
  assert.deepEqual(
    readPlaybackPreferences({ getItem: () => '{"mode":"shuffle","repeat":"one"}' }),
    { shuffle: true, repeat: 'one' }
  );
  assert.deepEqual(
    readPlaybackPreferences({ getItem: () => '{"mode":"shuffle","repeat":"bad"}' }),
    { shuffle: true, repeat: 'loop' }
  );
});
