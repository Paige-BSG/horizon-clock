export const MUSIC_PREFERENCES_KEY = 'horizon-music-v1';
export const PLAY_MODES = ['loop', 'one', 'shuffle', 'order'];
export const MODE_LABELS = {
  loop: '列表循环',
  one: '单曲循环',
  shuffle: '随机播放',
  order: '顺序播放',
};
export function readPlaybackPreferences(storage) {
  try {
    const saved = JSON.parse(storage.getItem(MUSIC_PREFERENCES_KEY));
    const mode = PLAY_MODES.includes(saved?.mode) ? saved.mode : 'loop';
    return {
      shuffle: mode === 'shuffle',
      repeat: ['loop', 'one', 'order'].includes(saved?.repeat)
        ? saved.repeat
        : mode === 'shuffle'
          ? 'loop'
          : mode,
    };
  } catch {
    return { shuffle: false, repeat: 'loop' };
  }
}
export function readMode(storage) {
  const { shuffle, repeat } = readPlaybackPreferences(storage);
  return shuffle ? 'shuffle' : repeat;
}

// Navigation history and the shuffle cycle contain IDs only, never playback intent.
export function createMusicQueue(random = Math.random) {
  let key,
    ids = [],
    history = [],
    cursor = -1,
    seen = new Set();
  return {
    sync(nextKey, tracks) {
      ids = [...new Set(tracks.map((track) => track.id))];
      if (key !== nextKey) {
        key = nextKey;
        history = [];
        cursor = -1;
        seen.clear();
      }
    },
    resetShuffle(current) {
      seen = new Set(current ? [current] : []);
    },
    hasPrevious() {
      return cursor > 0 && ids.includes(history[cursor - 1]);
    },
    record(id, direction = 'select') {
      seen.add(id);
      if (direction === 'previous' && cursor > 0 && history[cursor - 1] === id) cursor--;
      else if (direction === 'next' && history[cursor + 1] === id) cursor++;
      else if (history[cursor] !== id) {
        history = history.slice(0, cursor + 1);
        history.push(id);
        if (history.length > 1000) history.shift();
        cursor = history.length - 1;
      }
    },
    previous(current, mode) {
      if (mode === 'shuffle')
        return cursor > 0 && ids.includes(history[cursor - 1]) ? history[cursor - 1] : null;
      const index = ids.indexOf(current);
      if (index > 0) return ids[index - 1];
      return index === 0 && ['loop', 'one'].includes(mode) ? ids.at(-1) : null;
    },
    hasNext(current, repeat) {
      return (
        !!history[cursor + 1] ||
        ids.some((id) => id !== current && !seen.has(id)) ||
        repeat !== 'order'
      );
    },
    next(current, mode, automatic = false, repeat = mode === 'shuffle' ? 'loop' : mode) {
      if (!ids.length) return null;
      if (automatic && repeat === 'one' && ids.includes(current)) return current;
      if (mode === 'shuffle') {
        if (history[cursor + 1] && ids.includes(history[cursor + 1])) return history[cursor + 1];
        let candidates = ids.filter((id) => id !== current && !seen.has(id));
        if (!candidates.length) {
          if (repeat === 'order') return null;
          seen = new Set(current ? [current] : []);
          candidates = ids.filter((id) => id !== current);
        }
        if (!candidates.length) return ids[0];
        return candidates[Math.floor(random() * candidates.length)];
      }
      const index = ids.indexOf(current);
      if (index + 1 < ids.length) return ids[index + 1];
      return ['loop', 'one'].includes(mode) ? ids[0] : null;
    },
  };
}
