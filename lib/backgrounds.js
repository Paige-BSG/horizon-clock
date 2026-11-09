import { displayProfile, setDisplayProfile, effectiveNight } from './night.js';
import { addPhoto, listPhotos, updatePhoto, removePhoto } from './photos.js';

const builtin = [
  { id: 'lake', name: '湖畔晨雾', src: 'assets/landscapes/lake.jpg' },
  { id: 'mountain', name: '群山之间', src: 'assets/landscapes/mountain.jpg' },
  { id: 'coast', name: '蓝色潮汐', src: 'assets/landscapes/coast.jpg' },
];
const $ = (id) => document.getElementById(id);

export function createBackgrounds({ getSettings, save, toast, applyNight }) {
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
  const profile = (period) => displayProfile(getSettings(), period);
  const actualPeriod = () => (effectiveNight(getSettings()) >= 0.5 ? 'night' : 'day');
  const preview = () => $('settings-dialog').open && !$('background-panel').hidden;
  const period = () => (preview() ? editPeriod : actualPeriod());
  const pool = (value, rotation = false) =>
    value.collection === 'personal'
      ? photos.filter((photo) => !rotation || photo.enabled)
      : builtin;
  const selected = (value) =>
    pool(value).find((scene) => scene.id === value.scene) || pool(value)[0] || builtin[0];

  function objectUrl(photo, thumbnail = false) {
    const cache = thumbnail ? thumbnailUrls : fullUrls;
    if (!cache.has(photo.id))
      cache.set(photo.id, URL.createObjectURL(thumbnail ? photo.thumbnail : photo.image));
    return cache.get(photo.id);
  }
  function sceneSource(scene) {
    return scene.src || objectUrl(scene);
  }
  function position(scene) {
    return `${scene.x ?? 50}% ${scene.y ?? 50}%`;
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
    const key = scene.id;
    if (activeLayer && renderedKey === key) {
      activeLayer.style.objectPosition = position(scene);
      return;
    }
    const source = sceneSource(scene);
    const preload = new Image();
    preload.src = source;
    try {
      await preload.decode();
      if (generation !== request || profile(period()).background !== 'landscape') return;
      const layer = activeLayer === $('landscape-a') ? $('landscape-b') : $('landscape-a');
      layer.src = source;
      layer.style.objectPosition = position(scene);
      await layer.decode();
      if (generation !== request || profile(period()).background !== 'landscape') return;
      layer.classList.add('visible');
      activeLayer?.classList.remove('visible');
      activeLayer = layer;
      renderedKey = key;
      $('landscape-backdrop').classList.add('ready');
      renderFooter();
    } catch {
      if (generation !== request) return;
      if (!activeLayer) document.body.dataset.background = 'solid';
      toast('这张背景未能加载，已保留当前显示。');
    }
  }

  function renderFooter() {
    const value = profile(period()),
      scenes = pool(value),
      index = scenes.findIndex((scene) => scene.id === renderedKey);
    document.querySelector('.footer-center').textContent =
      value.background === 'landscape' && activeLayer
        ? `${scenes[index]?.name || '湖畔晨雾'} · ${String(Math.max(0, index) + 1).padStart(2, '0')} / ${String(Math.max(1, scenes.length)).padStart(2, '0')}`
        : 'MAKE ROOM FOR THE PRESENT.';
  }

  function syncDisplay(force = false) {
    const active = period(),
      value = profile(active);
    if (preview()) document.body.dataset.previewPeriod = editPeriod;
    else delete document.body.dataset.previewPeriod;
    applyNight();
    const scene = selected(value);
    const key = `${active}:${value.background}:${value.collection}:${scene.id}`;
    document.body.dataset.background = value.background;
    $('background-next').hidden = value.background === 'solid';
    if (key !== periodKey || force) {
      periodKey = key;
      if (value.background === 'landscape') paintScene(scene);
      else ++request;
      scheduleRotation();
      renderFooter();
    } else if (activeLayer && renderedKey === scene.id)
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
    syncDisplay();
  }

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
  }

  function chooseScene(id) {
    setDisplayProfile(getSettings(), editPeriod, { scene: id });
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
      const scenes = collection === 'personal' ? photos : builtin;
      setDisplayProfile(getSettings(), editPeriod, {
        collection,
        scene: scenes.find((scene) => scene.id === value.scene)?.id || scenes[0]?.id || 'lake',
      });
      save();
      renderPhotos();
      renderControls();
    });
  for (const button of document.querySelectorAll('.scene-option'))
    button.addEventListener('click', () => chooseScene(button.dataset.scene));
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
  $('photo-import').addEventListener('click', () => $('photo-files').click());
  $('photo-files').addEventListener('change', async (event) => {
    if (importing) return;
    const files = [...event.target.files];
    if (!files.length) return;
    importing = true;
    $('photo-import').disabled = true;
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
    if (first) {
      photoError = '';
      setDisplayProfile(getSettings(), editPeriod, { collection: 'personal', scene: first.id });
      save();
    }
    importing = false;
    $('photo-import').disabled = false;
    event.target.value = '';
    renderPhotos();
    renderControls();
    syncDisplay(true);
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
