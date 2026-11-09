import { displayProfile, setDisplayProfile, effectiveNight } from './night.js';
import { addPhoto, listPhotos, updatePhoto, removePhoto } from './photos.js';
import { BUILTIN_SCENES } from './scenes.js';
import { createOnlineGallery } from './online-gallery.js';
import { MAX_ONLINE_SCENES } from './gallery-model.js';
import { isDesktop, native } from './desktop.js';

const $ = (id) => document.getElementById(id);

export function createBackgrounds({ getSettings, save, toast, applyNight, openAdvanced }) {
  const picker = $('background-picker');
  let pickerSession = 0;
  let onlineScenes = [],
    renderedScene = null;
  const builtin = () => [...BUILTIN_SCENES, ...onlineScenes];
  let photos = [],
    request = 0,
    activeLayer = null,
    renderedKey = '',
    rotationTimer,
    periodKey = '';
  let editPeriod = effectiveNight(getSettings()) >= 0.5 ? 'night' : 'day';
  let photoError = '',
    importing = false;
  const fullUrls = new Map(),
    thumbnailUrls = new Map();
  let transitionDone = Promise.resolve();
  const profile = (period) => displayProfile(getSettings(), period);
  const actualPeriod = () => (effectiveNight(getSettings()) >= 0.5 ? 'night' : 'day');
  const preview = () => picker.open || ($('settings-dialog').open && !$('background-panel').hidden);
  const period = () => (preview() ? editPeriod : actualPeriod());
  const pool = (value, rotation = false) =>
    value.collection === 'personal'
      ? photos.filter((photo) => !rotation || photo.enabled)
      : builtin();
  const selected = (value) =>
    pool(value).find((scene) => scene.id === value.scene) || pool(value)[0] || BUILTIN_SCENES[0];
  const imageKey = (scene) => (scene.revision ? `${scene.id}:${scene.revision}` : scene.id);

  function objectUrl(photo, thumbnail = false) {
    const cache = thumbnail ? thumbnailUrls : fullUrls;
    const key = imageKey(photo);
    if (!cache.has(key))
      cache.set(key, URL.createObjectURL(thumbnail ? photo.thumbnail : photo.image));
    return cache.get(key);
  }
  function sceneSource(scene) {
    return scene.src || objectUrl(scene);
  }
  function position(scene) {
    return `${scene.x ?? 50}% ${scene.y ?? 50}%`;
  }

  function pruneUrls() {
    const keep = new Set([...photos, ...onlineScenes].map(imageKey));
    keep.add(renderedKey);
    for (const cache of [fullUrls, thumbnailUrls]) {
      for (const [key, url] of cache) {
        if (keep.has(key)) continue;
        URL.revokeObjectURL(url);
        cache.delete(key);
      }
    }
  }

  function scheduleRotation() {
    clearTimeout(rotationTimer);
    const settings = getSettings(),
      value = profile(period());
    if (
      value.background === 'landscape' &&
      settings.rotate &&
      !document.hidden &&
      pool(value, true).length > 1
    ) {
      rotationTimer = setTimeout(() => {
        if (document.querySelector('dialog[open]')) scheduleRotation();
        else nextScene(true);
      }, settings.interval * 1000);
    }
  }

  async function paintScene(scene) {
    const generation = ++request;
    const key = imageKey(scene);
    if (activeLayer && renderedKey === key) {
      activeLayer.style.objectPosition = position(scene);
      renderedScene = scene;
      renderFooter();
      return;
    }
    const source = sceneSource(scene);
    const preload = new Image();
    preload.src = source;
    try {
      await preload.decode();
      await transitionDone;
      if (generation !== request || profile(period()).background !== 'landscape') return;
      const layer = activeLayer === $('landscape-a') ? $('landscape-b') : $('landscape-a');
      layer.style.transition = 'none';
      layer.classList.remove('visible', 'retained');
      layer.style.zIndex = '1';
      layer.src = source;
      layer.style.objectPosition = position(scene);
      await layer.decode();
      if (generation !== request || profile(period()).background !== 'landscape') return;
      const previous = activeLayer;
      // Keep a fully opaque base; fading both layers exposes the dark backdrop.
      if (previous) {
        previous.style.transition = 'none';
        previous.style.zIndex = '0';
        previous.classList.add('retained');
        previous.classList.remove('visible');
        // Establish the incoming image's zero opacity before starting its fade.
        void layer.offsetWidth;
        layer.style.transition = '';
      }
      layer.classList.add('visible');
      activeLayer = layer;
      renderedKey = key;
      renderedScene = scene;
      $('landscape-backdrop').classList.add('ready');
      renderFooter();
      transitionDone = new Promise((resolve) => {
        let timer;
        const finish = () => {
          clearTimeout(timer);
          layer.removeEventListener('transitionend', finish);
          previous?.classList.remove('retained');
          pruneUrls();
          resolve();
        };
        const duration = parseFloat(getComputedStyle(layer).transitionDuration) * 1000;
        if (!previous || !duration) finish();
        else {
          layer.addEventListener('transitionend', finish, { once: true });
          timer = setTimeout(finish, duration + 100);
        }
      });
    } catch {
      if (generation !== request) return;
      if (!activeLayer) document.body.dataset.background = 'solid';
      toast('这张背景未能加载，已保留当前显示。');
    }
  }

  function renderFooter() {
    const value = profile(period()),
      scenes = pool(value),
      index = scenes.findIndex((scene) => scene.id === renderedScene?.id);
    $('scene-caption').textContent =
      value.background === 'landscape' && activeLayer
        ? `${renderedScene?.name || '湖畔晨雾'} · ${String(Math.max(0, index) + 1).padStart(2, '0')} / ${String(Math.max(1, scenes.length)).padStart(2, '0')}`
        : '';
    const credit = value.background === 'landscape' && renderedScene?.license;
    $('scene-credit').hidden = !credit;
    $('scene-credit').textContent = credit
      ? `${renderedScene.artist ? renderedScene.artist + ' · ' : ''}${renderedScene.license} · 来源 ↗`
      : '';
    $('image-source').disabled = !credit;
  }

  function syncDisplay(force = false) {
    const active = period(),
      value = profile(active);
    if (preview()) document.body.dataset.previewPeriod = editPeriod;
    else delete document.body.dataset.previewPeriod;
    applyNight();
    const scene = selected(value);
    const key = `${active}:${value.background}:${value.collection}:${imageKey(scene)}`;
    document.body.dataset.background = value.background;
    $('background-next').hidden = value.background === 'solid';
    if (key !== periodKey || force) {
      periodKey = key;
      if (value.background === 'landscape') paintScene(scene);
      else ++request;
      scheduleRotation();
      renderFooter();
    } else if (activeLayer && renderedKey === imageKey(scene))
      activeLayer.style.objectPosition = position(scene);
  }

  function renderControls() {
    const settings = getSettings(),
      value = profile(editPeriod);
    $('landscape-settings').hidden = value.background === 'solid';
    $('rotate-background').checked = settings.rotate;
    $('rotation-interval').value = settings.interval;
    $('rotation-interval').disabled = !settings.rotate;
    $('background-dim').max = editPeriod === 'night' ? '95' : '75';
    $('background-dim').value = value.dim;
    $('dim-value').textContent = `${value.dim}%`;
    $('display-brightness').min = editPeriod === 'night' ? '10' : '30';
    $('display-brightness').value = value.brightness;
    $('brightness-value').textContent = `${value.brightness}%`;
    for (const button of document.querySelectorAll('[data-period]')) {
      const active = button.dataset.period === editPeriod;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    for (const button of document.querySelectorAll('.background-option')) {
      const active = button.dataset.background === value.background;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    for (const button of document.querySelectorAll('[data-collection]')) {
      const active = button.dataset.collection === value.collection;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    for (const button of document.querySelectorAll('.scene-option')) {
      const active = button.dataset.scene === value.scene;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    for (const button of document.querySelectorAll('[data-photo]'))
      button.setAttribute('aria-pressed', String(button.dataset.photo === value.scene));
    $('builtin-scenes').hidden = value.collection !== 'builtin';
    $('personal-scenes').hidden = value.collection !== 'personal';
    $('photo-status').textContent =
      photoError ||
      `${photos.length} / 24 张 · ${photos.filter((photo) => photo.enabled).length} 张参与轮换`;
    $('photo-empty').hidden = photos.length > 0;
    const current = photos.find((photo) => photo.id === value.scene);
    $('photo-position').hidden = value.collection !== 'personal' || !current;
    if (current)
      for (const axis of ['x', 'y']) {
        $(`photo-${axis}`).value = current[axis];
        $(`photo-${axis}-value`).textContent = `${current[axis]}%`;
      }
    renderQuickControls();
    syncDisplay();
  }

  function renderQuickControls() {
    const settings = getSettings(),
      value = profile(editPeriod);
    $('picker-context').textContent = `${editPeriod === 'night' ? '夜间' : '白天'}背景`;
    for (const button of document.querySelectorAll('[data-quick-scene]')) {
      const personal = button.dataset.quickCollection === 'personal';
      button.setAttribute(
        'aria-pressed',
        String(
          value.background === 'landscape' &&
            value.collection === (personal ? 'personal' : 'builtin') &&
            value.scene === button.dataset.quickScene
        )
      );
    }
    $('quick-solid').setAttribute('aria-pressed', String(value.background === 'solid'));
    $('quick-photo-empty').hidden = photos.length > 0;
    $('quick-photo-empty').textContent = photoError || '导入照片后使用，原文件保留。';
    $('quick-photo-status').textContent = photos.length ? `${photos.length} 张` : '';
    $('quick-adjustments').hidden = value.background === 'solid';
    $('quick-background-brightness').min = editPeriod === 'night' ? '5' : '25';
    $('quick-background-brightness').value = 100 - value.dim;
    $('quick-background-brightness-value').textContent = `${100 - value.dim}%`;
    $('quick-rotate').textContent = settings.rotate ? '固定这张' : '继续轮换';
    const interval =
      settings.interval < 60 ? `${settings.interval} 秒` : `${settings.interval / 60} 分钟`;
    $('quick-rotation-status').textContent = settings.rotate
      ? `每 ${interval} 更换`
      : '已固定当前风景';
  }

  function openPicker() {
    editPeriod = actualPeriod();
    $('settings-dialog').close();
    pickerSession++;
    renderPhotos();
    picker.showModal();
    renderControls();
    picker
      .querySelector('[data-quick-scene][aria-pressed="true"], #quick-solid[aria-pressed="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }

  function chooseQuickScene(id, collection) {
    chooseScene(id, collection);
    picker.close();
  }

  function renderBuiltinScenes() {
    const quick = $('quick-builtin-scenes'),
      advanced = $('builtin-scene-list');
    const solid = $('quick-solid');
    quick.replaceChildren();
    advanced.replaceChildren();
    for (const scene of builtin()) {
      for (const isQuick of [true, false]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = isQuick ? 'quick-scene' : 'scene-option';
        button.dataset[isQuick ? 'quickScene' : 'scene'] = scene.id;
        button.setAttribute('aria-label', isQuick ? `使用${scene.name}` : scene.name);
        const image = document.createElement('img');
        image.src = scene.thumb || scene.src || objectUrl(scene, true);
        image.alt = '';
        const label = document.createElement('span');
        label.textContent = scene.name;
        const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', '#icon-check');
        check.append(use);
        button.append(image, label, check);
        button.addEventListener('click', () =>
          isQuick ? chooseQuickScene(scene.id, 'builtin') : chooseScene(scene.id)
        );
        (isQuick ? quick : advanced).append(button);
      }
    }
    quick.append(solid);
  }

  function renderOnlineStatus(status) {
    const enabled = getSettings().onlineEnabled;
    $('online-gallery-toggle').textContent = enabled ? '停止在线更新' : '开启在线更新';
    $('online-gallery-toggle').setAttribute('aria-pressed', String(enabled));
    $('online-gallery-refresh').hidden = !enabled;
    $('online-gallery-refresh').disabled = status.busy;
    $('online-gallery-status').textContent = status.busy
      ? '正在检查新风景…'
      : status.error ||
        (enabled
          ? `${status.count} 张在线风景已缓存 · ${status.updatedAt ? new Date(status.updatedAt).toLocaleDateString('zh-CN') + ' 已检查' : '等待首次更新'} · 每天自动检查`
          : `${BUILTIN_SCENES.length} 张离线风景 · 在线最多 ${MAX_ONLINE_SCENES} 张${status.count ? `（已缓存 ${status.count} 张）` : ''} · Wikimedia Commons`);
  }

  const gallery = createOnlineGallery({
    getSettings,
    protectedIds: () => [profile('day').scene, profile('night').scene],
    onStatus: renderOnlineStatus,
    onChange: (scenes) => {
      const previous = onlineScenes;
      onlineScenes = scenes;
      renderBuiltinScenes();
      renderControls();
      syncDisplay(true);
      const obsolete = previous.filter(
        (scene) => !scenes.some((item) => imageKey(item) === imageKey(scene))
      );
      setTimeout(() => {
        for (const scene of obsolete) {
          // A failed replacement can leave the previous image visible.
          if (renderedKey === imageKey(scene)) continue;
          for (const cache of [fullUrls, thumbnailUrls]) {
            const key = imageKey(scene),
              url = cache.get(key);
            if (url) URL.revokeObjectURL(url);
            cache.delete(key);
          }
        }
      }, 2200);
    },
  });
  $('online-gallery-toggle').addEventListener('click', () => {
    getSettings().onlineEnabled = !getSettings().onlineEnabled;
    save();
    gallery.consentChanged();
  });
  $('online-gallery-refresh').addEventListener('click', () => gallery.refresh(true));
  $('image-source').addEventListener('click', () => {
    if (!renderedScene?.license) return;
    const scene = renderedScene;
    $('photo-source-title').textContent = scene.name;
    $('photo-source-artist').textContent = `作者：${scene.artist || '请见原始来源页面'}`;
    $('photo-source-license').textContent = `许可：${scene.license}`;
    $('photo-source-changes').textContent =
      scene.changes || '已缩放为应用背景；显示时按屏幕自适应裁切。';
    $('photo-source-link').href = scene.sourceUrl;
    $('photo-license-link').href = scene.licenseUrl;
    $('photo-source-dialog').showModal();
  });
  $('photo-source-close').addEventListener('click', () => $('photo-source-dialog').close());
  for (const id of ['photo-source-link', 'photo-license-link']) {
    $(id).addEventListener('click', async (event) => {
      if (!isDesktop) return;
      event.preventDefault();
      try {
        await native('open_photo_source', { url: event.currentTarget.href });
      } catch {
        toast('无法打开来源页面，请检查默认浏览器。');
      }
    });
  }
  renderBuiltinScenes();

  function renderPhotos() {
    const container = $('photo-list');
    container.replaceChildren();
    for (const photo of photos) {
      const card = document.createElement('div');
      card.className = 'photo-card';
      const choose = document.createElement('button');
      choose.type = 'button';
      choose.className = 'photo-select';
      choose.dataset.photo = photo.id;
      choose.setAttribute('aria-label', `显示照片 ${photo.name}`);
      choose.setAttribute('aria-pressed', String(profile(editPeriod).scene === photo.id));
      const thumbnail = document.createElement('img');
      thumbnail.src = objectUrl(photo, true);
      thumbnail.alt = '';
      thumbnail.style.objectPosition = position(photo);
      const name = document.createElement('span');
      name.textContent = photo.name;
      choose.append(thumbnail, name);
      choose.addEventListener('click', () => chooseScene(photo.id));
      const actions = document.createElement('div');
      actions.className = 'photo-actions';
      const label = document.createElement('label'),
        checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = photo.enabled;
      label.append(checkbox, document.createTextNode('轮换'));
      checkbox.setAttribute('aria-label', `${photo.name} 参与轮换`);
      checkbox.addEventListener('change', async () => {
        checkbox.disabled = true;
        try {
          const updated = await updatePhoto(photo.id, { enabled: checkbox.checked });
          Object.assign(photo, updated);
          renderControls();
          scheduleRotation();
        } catch (error) {
          checkbox.checked = photo.enabled;
          toast(error.message);
        } finally {
          checkbox.disabled = false;
        }
      });
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '移出';
      remove.setAttribute('aria-label', `移出照片 ${photo.name}`);
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          await removePhoto(photo.id);
          ++request;
          photos = photos.filter((item) => item.id !== photo.id);
          for (const name of ['day', 'night']) {
            if (profile(name).scene === photo.id)
              setDisplayProfile(getSettings(), name, { scene: photos[0]?.id || 'lake' });
          }
          save();
          renderPhotos();
          renderControls();
          syncDisplay(true);
          setTimeout(() => {
            for (const cache of [fullUrls, thumbnailUrls]) {
              const url = cache.get(photo.id);
              if (url) URL.revokeObjectURL(url);
              cache.delete(photo.id);
            }
          }, 2200);
        } catch (error) {
          remove.disabled = false;
          toast(error.message);
        }
      });
      actions.append(label, remove);
      card.append(choose, actions);
      container.append(card);
    }
    const quick = $('quick-photo-list');
    quick.replaceChildren();
    for (const photo of photos) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quick-scene';
      button.dataset.quickScene = photo.id;
      button.dataset.quickCollection = 'personal';
      button.setAttribute('aria-label', `使用照片 ${photo.name}`);
      const image = document.createElement('img');
      image.src = objectUrl(photo, true);
      image.alt = '';
      image.style.objectPosition = position(photo);
      const label = document.createElement('span');
      label.textContent = photo.name;
      button.append(image, label);
      button.addEventListener('click', () => chooseQuickScene(photo.id, 'personal'));
      quick.append(button);
    }
    renderQuickControls();
  }

  function chooseScene(id, collection) {
    setDisplayProfile(
      getSettings(),
      editPeriod,
      collection ? { scene: id, collection, background: 'landscape' } : { scene: id }
    );
    save();
    renderControls();
    for (const button of document.querySelectorAll('[data-photo]'))
      button.setAttribute('aria-pressed', String(button.dataset.photo === id));
    syncDisplay(true);
    scheduleRotation();
  }

  function nextScene(automatic = false) {
    const name = period(),
      value = profile(name),
      scenes = pool(value, automatic);
    if (!scenes.length) return;
    const index = scenes.findIndex((scene) => scene.id === value.scene);
    setDisplayProfile(getSettings(), name, { scene: scenes[(index + 1) % scenes.length].id });
    save();
    renderControls();
    syncDisplay(true);
    scheduleRotation();
  }

  for (const button of document.querySelectorAll('[data-period]'))
    button.addEventListener('click', () => {
      editPeriod = button.dataset.period;
      renderControls();
      renderPhotos();
    });
  for (const button of document.querySelectorAll('.background-option'))
    button.addEventListener('click', () => {
      setDisplayProfile(getSettings(), editPeriod, { background: button.dataset.background });
      save();
      renderControls();
    });
  for (const button of document.querySelectorAll('[data-collection]'))
    button.addEventListener('click', () => {
      const collection = button.dataset.collection;
      const value = profile(editPeriod);
      const scenes = collection === 'personal' ? photos : builtin();
      setDisplayProfile(getSettings(), editPeriod, {
        collection,
        scene: scenes.find((scene) => scene.id === value.scene)?.id || scenes[0]?.id || 'lake',
      });
      save();
      renderPhotos();
      renderControls();
    });
  $('rotate-background').addEventListener('change', (event) => {
    getSettings().rotate = event.target.checked;
    save();
    renderControls();
    scheduleRotation();
  });
  $('rotation-interval').addEventListener('change', (event) => {
    getSettings().interval = Number(event.target.value);
    save();
    scheduleRotation();
  });
  for (const [id, key] of [
    ['background-dim', 'dim'],
    ['display-brightness', 'brightness'],
  ])
    $(id).addEventListener('input', (event) => {
      setDisplayProfile(getSettings(), editPeriod, { [key]: Number(event.target.value) });
      save();
      renderControls();
    });
  $('background-next').addEventListener('click', () => nextScene());
  $('background-open').addEventListener('click', openPicker);
  $('picker-close').addEventListener('click', () => picker.close());
  $('picker-advanced').addEventListener('click', () => {
    picker.close();
    openAdvanced();
  });
  $('quick-solid').addEventListener('click', () => {
    setDisplayProfile(getSettings(), editPeriod, { background: 'solid' });
    save();
    renderControls();
    picker.close();
  });
  $('quick-background-brightness').addEventListener('input', (event) => {
    setDisplayProfile(getSettings(), editPeriod, { dim: 100 - Number(event.target.value) });
    save();
    renderControls();
  });
  $('quick-rotate').addEventListener('click', () => {
    getSettings().rotate = !getSettings().rotate;
    save();
    renderControls();
    scheduleRotation();
  });
  $('quick-photo-import').addEventListener('click', () => $('photo-files').click());
  $('photo-import').addEventListener('click', () => $('photo-files').click());
  $('photo-files').addEventListener('change', async (event) => {
    if (importing) return;
    const files = [...event.target.files];
    if (!files.length) return;
    const importPeriod = editPeriod,
      importSelection = profile(editPeriod),
      fromPicker = picker.open,
      importSession = pickerSession;
    importing = true;
    $('photo-import').disabled = true;
    $('quick-photo-import').disabled = true;
    $('quick-photo-import').textContent = '正在导入…';
    let imported = 0,
      duplicates = 0,
      failed = 0,
      first;
    for (const [index, file] of files.slice(0, 24).entries()) {
      $('photo-status').textContent = `正在导入 ${index + 1} / ${Math.min(files.length, 24)}…`;
      try {
        const photo = await addPhoto(file);
        if (photo) {
          photos.push(photo);
          first ??= photo;
          imported++;
        } else duplicates++;
      } catch {
        failed++;
      }
    }
    failed += Math.max(0, files.length - 24);
    photos = await listPhotos().catch(() => photos);
    const activate =
      first &&
      ['background', 'collection', 'scene'].every(
        (key) => profile(importPeriod)[key] === importSelection[key]
      );
    if (activate) {
      photoError = '';
      setDisplayProfile(getSettings(), importPeriod, {
        background: 'landscape',
        collection: 'personal',
        scene: first.id,
      });
      save();
    }
    importing = false;
    $('photo-import').disabled = false;
    $('quick-photo-import').disabled = false;
    $('quick-photo-import').textContent = '导入照片';
    event.target.value = '';
    renderPhotos();
    renderControls();
    syncDisplay(true);
    if (activate && fromPicker && picker.open && pickerSession === importSession) picker.close();
    toast(
      `已导入 ${imported} 张${duplicates ? `，跳过 ${duplicates} 张重复照片` : ''}${failed ? `，${failed} 张未导入（请检查格式、尺寸和相册空间）` : ''}。`
    );
  });
  for (const axis of ['x', 'y']) {
    $(`photo-${axis}`).addEventListener('input', (event) => {
      const photo = photos.find((item) => item.id === profile(editPeriod).scene);
      if (!photo) return;
      photo[axis] = Number(event.target.value);
      renderControls();
      const image = document.querySelector(`[data-photo="${photo.id}"] img`);
      if (image) image.style.objectPosition = position(photo);
    });
    $(`photo-${axis}`).addEventListener('change', async () => {
      const photo = photos.find((item) => item.id === profile(editPeriod).scene);
      if (!photo) return;
      try {
        await updatePhoto(photo.id, { x: photo.x, y: photo.y });
      } catch (error) {
        toast(error.message);
        photos = await listPhotos().catch(() => photos);
        renderPhotos();
        renderControls();
      }
    });
  }
  $('settings-dialog').addEventListener('close', () => {
    delete document.body.dataset.previewPeriod;
    syncDisplay(true);
  });
  picker.addEventListener('close', () => {
    if (!$('settings-dialog').open) $('settings-open').focus({ preventScroll: true });
    delete document.body.dataset.previewPeriod;
    syncDisplay(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(rotationTimer);
    else syncDisplay(true);
  });
  window.addEventListener('pagehide', () => {
    clearTimeout(rotationTimer);
    for (const cache of [fullUrls, thumbnailUrls])
      for (const url of cache.values()) URL.revokeObjectURL(url);
    fullUrls.clear();
    thumbnailUrls.clear();
    renderedKey = '';
  });
  window.addEventListener('pageshow', () => syncDisplay(true));
  const ready = listPhotos()
    .then((records) => {
      photos = records;
      renderPhotos();
      renderControls();
      syncDisplay(true);
    })
    .catch(() => {
      photoError = '当前环境无法保存相册，内置风景仍可用。';
      renderControls();
    });
  return {
    renderControls,
    syncDisplay,
    nextScene,
    scheduleRotation,
    refresh: () => {
      renderPhotos();
      renderControls();
      syncDisplay(true);
    },
    ready,
  };
}
