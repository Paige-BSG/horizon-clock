import test from 'node:test';
import assert from 'node:assert/strict';
import { createRadio, radioPreferences, STATIONS } from '../lib/radio.js';

function fixture(reject) {
  const audios = [];
  const pending = new Map();
  let nextId = 0;
  let now = 0;
  const timers = {
    setTimeout(fn, delay) {
      const id = ++nextId;
      pending.set(id, { fn, at: now + delay });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    advance(ms) {
      const end = now + ms;
      while (true) {
        const item = [...pending.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!item || item[1].at > end) break;
        now = item[1].at;
        pending.delete(item[0]);
        item[1].fn();
      }
      now = end;
    },
  };
  class Audio extends EventTarget {
    currentTime = 0;
    paused = true;
    play() {
      this.paused = false;
      return reject ? Promise.reject(reject) : Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
    removeAttribute() {
      this.src = '';
    }
    load() {
      this.loaded = true;
    }
    remove() {
      this.removed = true;
    }
    fire(type) {
      this.dispatchEvent(new Event(type));
    }
  }
  const radio = createRadio({
    timers,
    audioFactory: () => {
      const audio = new Audio();
      audios.push(audio);
      return audio;
    },
  });
  return { radio, audios, timers, pending };
}

test('radio accepts only bundled channels, clamps volume and never restores playback intent', () => {
  assert.deepEqual(radioPreferences({ station: 'https://bad.example', volume: 9, playing: true }), {
    station: 'mellow',
    volume: 1,
  });
  assert.deepEqual(radioPreferences({ volume: NaN }), { station: 'mellow', volume: 0.3 });
  const { radio, audios } = fixture();
  assert.equal(radio.snapshot().requested, false);
  assert.equal(audios.length, 0);
  radio.select('main');
  radio.select('arbitrary-url');
  assert.equal(radio.snapshot().station, 'main');
  assert.equal(audios.length, 0);
});

test('playing is reported only by actual media events and stopping releases the stream', () => {
  const { radio, audios, pending } = fixture();
  radio.play();
  radio.play();
  assert.equal(audios.length, 1);
  assert.equal(radio.snapshot().state, 'connecting');
  assert.equal(audios[0].crossOrigin, 'anonymous');
  audios[0].fire('playing');
  assert.equal(radio.snapshot().state, 'playing');
  radio.stop();
  assert.equal(radio.snapshot().state, 'stopped');
  assert.equal(audios[0].src, '');
  assert.equal(audios[0].paused, true);
  assert.equal(audios[0].removed, true);
  assert.equal(pending.size, 0);
});

test('station changes release the old audio and stale events cannot change the new state', () => {
  const { radio, audios } = fixture();
  radio.play();
  audios[0].fire('playing');
  radio.volume(0.18);
  radio.select('serenity');
  assert.equal(audios.length, 2);
  assert.equal(audios[0].src, '');
  assert.equal(audios[1].src, STATIONS[1].url);
  assert.equal(audios[1].volume, 0.18);
  audios[0].fire('error');
  audios[0].fire('playing');
  assert.equal(radio.snapshot().state, 'connecting');
  audios[1].fire('playing');
  assert.equal(radio.snapshot().state, 'playing');
  radio.stop();
});

test('startup timeout and network errors have a bounded three-retry budget', () => {
  const { radio, audios, timers, pending } = fixture();
  radio.play();
  timers.advance(15000);
  assert.equal(radio.snapshot().state, 'retrying');
  assert.equal(radio.snapshot().failures, 1);
  for (const delay of [2000, 5000, 10000]) {
    timers.advance(delay);
    audios.at(-1).fire('playing');
    audios.at(-1).fire('error');
  }
  assert.equal(audios.length, 4);
  assert.equal(radio.snapshot().state, 'error');
  assert.equal(radio.snapshot().requested, false);
  assert.equal(pending.size, 0);
});

test('stop during retry cancels recovery and releases any late playback rejection', async () => {
  const { radio, audios, timers, pending } = fixture(new Error('failed'));
  radio.play();
  radio.stop();
  await Promise.resolve();
  await Promise.resolve();
  timers.advance(60000);
  assert.equal(audios.length, 1);
  assert.equal(radio.snapshot().state, 'stopped');
  assert.equal(pending.size, 0);
});

test('autoplay denial needs a user gesture and is not retried in the background', async () => {
  const { radio, timers, audios } = fixture(
    Object.assign(new Error('blocked'), { name: 'NotAllowedError' })
  );
  radio.play();
  await Promise.resolve();
  await Promise.resolve();
  timers.advance(60000);
  assert.equal(radio.snapshot().state, 'gesture');
  assert.equal(audios.length, 1);
});

test('buffering has a deadline and sustained playback restores the retry budget', () => {
  const { radio, audios, timers } = fixture();
  radio.play();
  audios[0].fire('error');
  timers.advance(2000);
  audios[1].fire('playing');
  audios[1].currentTime = 31;
  audios[1].fire('timeupdate');
  assert.equal(radio.snapshot().failures, 0);
  audios[1].fire('waiting');
  assert.equal(radio.snapshot().state, 'buffering');
  timers.advance(15000);
  assert.equal(radio.snapshot().state, 'retrying');
  radio.dispose();
});

test('repeated buffering events cannot postpone the connection deadline', () => {
  const { radio, audios, timers } = fixture();
  radio.play();
  timers.advance(10000);
  audios[0].fire('waiting');
  audios[0].fire('stalled');
  timers.advance(5000);
  assert.equal(radio.snapshot().state, 'retrying');
  radio.stop();
});
