import { preparePhoto } from './photos.js';
import { BUILTIN_SCENES } from './scenes.js';
import {
  GALLERY_DAY,
  GALLERY_RETRY,
  MAX_ONLINE_SCENES,
  MAX_ONLINE_BYTES,
  MAX_IMAGE_BYTES,
  commonsScenes,
  catalogUrl,
  catalogIds,
  imageInfoUrl,
  boundedBody,
  validCachedScene,
} from './gallery-model.js';

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('horizon-online-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onerror = request.onblocked = () => reject(new Error('在线图库缓存不可用。'));
    request.onsuccess = () => resolve(request.result);
  });
}
async function stored(value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('state', value ? 'readwrite' : 'readonly');
      const request = value
        ? tx.objectStore('state').put(value, 'gallery')
        : tx.objectStore('state').get('gallery');
      let result;
      request.onsuccess = () => {
        result = request.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(new Error('在线图库缓存未能保存，已保留原有风景。'));
    });
  } finally {
    db.close();
  }
}

export function createOnlineGallery({ getSettings, protectedIds, onChange, onStatus }) {
  let scenes = [],
    updatedAt = 0,
    attemptedAt = 0,
    timer,
    controller,
    active,
    error = '';
  const notify = () =>
    onStatus({
      enabled: getSettings().onlineEnabled,
      busy: !!active,
      updatedAt,
      error,
      count: scenes.length,
    });
  function schedule(delay) {
    clearTimeout(timer);
    if (getSettings().onlineEnabled && !document.hidden)
      timer = setTimeout(() => refresh(), Math.max(1000, delay));
  }
  async function download(scene, signal) {
    const response = await fetch(scene.imageUrl, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal,
    });
    if (!response.headers.get('Content-Type')?.startsWith('image/jpeg'))
      throw new Error('在线图片格式不受支持。');
    const bytes = await boundedBody(response, MAX_IMAGE_BYTES);
    const photo = await preparePhoto(new File([bytes], 'online.jpg', { type: 'image/jpeg' }));
    return { ...photo, ...scene };
  }
  async function api(url, signal) {
    const response = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal,
      headers: { 'Api-User-Agent': 'HORIZON/0.2 (https://github.com/Paige-BSG/horizon-clock)' },
    });
    return JSON.parse(new TextDecoder().decode(await boundedBody(response, 512 * 1024)));
  }
  async function perform(signal) {
    const ids = catalogIds(await api(catalogUrl(), signal));
    const candidates = commonsScenes(
      await api(imageInfoUrl(ids), signal),
      BUILTIN_SCENES.map((scene) => scene.id)
    ).sort((a, b) => ids.indexOf(Number(a.id.slice(8))) - ids.indexOf(Number(b.id.slice(8))));
    if (!candidates.length) throw new Error('在线图库暂时没有可用的新风景。');
    const downloaded = [];
    for (const scene of candidates.slice(0, MAX_ONLINE_SCENES * 2)) {
      if (downloaded.length >= MAX_ONLINE_SCENES) break;
      if (signal.aborted || !getSettings().onlineEnabled)
        throw new DOMException('Canceled', 'AbortError');
      const cached = scenes.find(
        (item) =>
          item.id === scene.id &&
          item.revision === scene.revision &&
          item.imageUrl === scene.imageUrl
      );
      try {
        downloaded.push(cached ? { ...cached, ...scene } : await download(scene, signal));
      } catch (failure) {
        if (signal.aborted) throw failure;
      }
    }
    if (!downloaded.length) throw new Error('暂时无法下载新风景。');
    const protectedSet = new Set(protectedIds());
    const retained = scenes
      .filter(
        (scene) => protectedSet.has(scene.id) && !downloaded.some((item) => item.id === scene.id)
      )
      .slice(0, 2);
    const next = [...downloaded, ...retained];
    if (
      next.reduce((sum, scene) => sum + scene.image.size + scene.thumbnail.size, 0) >
      MAX_ONLINE_BYTES
    )
      throw new Error('在线图库缓存空间不足，已保留原有风景。');
    if (signal.aborted || !getSettings().onlineEnabled) return;
    const now = Date.now();
    await stored({ scenes: next, updatedAt: now });
    scenes = next;
    updatedAt = now;
    error = '';
    onChange(scenes);
  }
  async function refresh(force = false) {
    if (!getSettings().onlineEnabled || active || document.hidden) return;
    const age = Date.now() - updatedAt;
    if (
      (!force && !error && age < GALLERY_DAY) ||
      (attemptedAt && Date.now() - attemptedAt < 60000)
    ) {
      schedule(
        attemptedAt && Date.now() - attemptedAt < 60000
          ? 60000 - (Date.now() - attemptedAt)
          : GALLERY_DAY - age
      );
      return;
    }
    attemptedAt = Date.now();
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 45000);
    active = perform(controller.signal);
    notify();
    let canceled = false;
    try {
      await active;
    } catch (failure) {
      canceled = controller.signal.aborted && document.hidden;
      if (getSettings().onlineEnabled && !canceled)
        error =
          failure.message === 'The operation was aborted.' || failure.name === 'AbortError'
            ? '在线更新超时，已保留离线风景。'
            : '在线图库暂时不可用，已保留离线风景。';
    } finally {
      clearTimeout(timeout);
      active = null;
      controller = null;
      notify();
      schedule(canceled ? 60000 : error ? GALLERY_RETRY : GALLERY_DAY);
    }
  }
  const ready = stored()
    .then((data) => {
      if (
        data &&
        Array.isArray(data.scenes) &&
        data.scenes.length <= 8 &&
        data.scenes.every(validCachedScene) &&
        data.scenes.reduce((sum, s) => sum + s.image.size + s.thumbnail.size, 0) <= MAX_ONLINE_BYTES
      ) {
        scenes = data.scenes;
        updatedAt =
          Number.isFinite(data.updatedAt) && data.updatedAt <= Date.now() ? data.updatedAt : 0;
        onChange(scenes);
      }
    })
    .catch(() => {
      error = '在线图库缓存不可用，内置风景仍可使用。';
    })
    .finally(() => {
      notify();
      refresh();
    });
  function consentChanged() {
    clearTimeout(timer);
    if (!getSettings().onlineEnabled) {
      controller?.abort();
      error = '';
      notify();
    } else ready.then(() => refresh(true));
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(timer);
      controller?.abort();
    } else ready.then(() => refresh());
  });
  window.addEventListener('online', () => ready.then(() => refresh(true)));
  window.addEventListener('pagehide', () => {
    clearTimeout(timer);
    controller?.abort();
  });
  return { ready, refresh, consentChanged };
}
