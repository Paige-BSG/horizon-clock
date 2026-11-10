import { expect } from '@playwright/test';
import { normalizeSettings, SETTINGS_KEY } from '../../lib/settings.js';

export async function start(page, loggedIn = true, longPlaylist = false) {
  await page.addInitScript(
    ({ key, settings, loggedIn, longPlaylist }) => {
      localStorage.setItem(key, JSON.stringify(settings));
      const tracks = [
        { id: '11', name: '测试歌曲甲', artist: '测试歌手', duration: 173 },
        { id: '12', name: '测试歌曲乙', artist: '测试歌手', duration: 200 },
      ];
      if (longPlaylist) {
        const first = tracks[0];
        first.name = '一首用于检查长标题排版的测试歌曲 A Very Long Track Title '.repeat(3);
        first.artist = '测试歌手甲、测试歌手乙、测试歌手丙 '.repeat(3);
        tracks.push(
          ...Array.from({ length: 98 }, (_, i) => ({
            ...first,
            id: String(100 + i),
            name: `测试歌曲 ${i + 3}`,
          }))
        );
      }
      const idle = () => ({ state: 'stopped', track: null, seconds: 0, duration: 0, volume: 50 });
      const view = {
        authenticated: loggedIn,
        login: loggedIn ? 'ready' : 'idle',
        qr: null,
        playlists: loggedIn ? [{ id: '21', name: '测试歌单', count: tracks.length }] : [],
        playlist: null,
        tracks: [],
        total: 0,
        playback: idle(),
        queue: 'playlist',
      };
      window.nativeCalls = [];
      window.__TAURI__ = {
        core: {
          invoke: async (command, args) => {
            window.nativeCalls.push({ command, args });
            if (command === 'music_audio_levels') return window.nativeLevels || [];
            if (command !== 'netease') return false;
            const a = args.action;
            if (window.failAction === a.type) throw '当前账号无法播放此歌曲';
            if (a.type === 'restore' && window.delayRestore)
              await new Promise((r) => {
                window.finishRestore = r;
              });
            if (a.type === 'tracks') {
              view.tracks = a.offset ? view.tracks.concat(window.extraTracks || []) : tracks;
              view.queue = 'playlist';
              view.playlist = a.playlist;
              view.total = tracks.length + (window.extraTracks?.length || 0);
            }
            if (a.type === 'fm') {
              window.fmBatches = (window.fmBatches || 0) + 1;
              const batch = Array.from({ length: 2 }, (_, i) => ({
                id: String(300 + window.fmBatches * 2 + i),
                name: `推荐歌曲 ${window.fmBatches}-${i + 1}`,
                artist: '推荐歌手',
                duration: 180,
              }));
              view.tracks = a.append ? view.tracks.concat(batch) : batch;
              view.playlist = null;
              view.queue = 'fm';
              view.total = view.tracks.length;
            }
            if (a.type === 'play') {
              const track = view.tracks.find((t) => t.id === a.id);
              view.playback = {
                state: 'playing',
                track,
                seconds: 1,
                duration: track.duration,
                volume: view.playback.volume,
              };
            }
            if (a.type === 'pause') view.playback.state = a.paused ? 'paused' : 'playing';
            if (a.type === 'volume') view.playback.volume = a.volume;
            if (a.type === 'stop') {
              if (window.delayStop)
                await new Promise((r) => {
                  window.finishStop = r;
                });
              view.playback = idle();
            }
            if (a.type === 'login') {
              if (window.delayLogin) await new Promise((resolve) => (window.finishLogin = resolve));
              view.login = 'waiting';
              view.qr =
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1X8AAAAASUVORK5CYII=';
            }
            if (a.type === 'cancel_login') {
              view.login = 'idle';
              view.qr = null;
            }
            if (a.type === 'poll_login') {
              view.login = 'expired';
              view.qr = null;
            }
            if (a.type === 'logout') {
              view.authenticated = false;
              view.login = 'idle';
              view.playlists = [];
              view.tracks = [];
              view.playback = idle();
            }
            if (a.type === 'status' && window.endTrack) {
              view.playback.state = 'ended';
              window.endTrack = false;
            }
            return structuredClone(view);
          },
        },
      };
    },
    {
      key: SETTINGS_KEY,
      settings: normalizeSettings({ weatherEnabled: false, autoNight: false }),
      loggedIn,
      longPlaylist,
    }
  );
  await page.goto('/');
  await page.keyboard.press('m');
  await expect(page.locator('#netease-account-status')).toHaveText(loggedIn ? '已登录' : '未登录');
}
export async function choose(page) {
  await page.locator('#music-library-toggle').click();
  await page.locator('#netease-playlists').selectOption('21');
  await expect(page.locator('#netease-tracks button')).toHaveCount(2);
}

export async function account(page) {
  await page.keyboard.press('s');
  await page.getByRole('tab', { name: '应用', exact: true }).click();
}
