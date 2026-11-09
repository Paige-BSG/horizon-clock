export const MAX_PHOTOS = 24;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_LIBRARY_BYTES = 64 * 1024 * 1024;
const DATABASE = 'horizon-photos-v1';
let database;

function openDatabase() {
  if (!database) {
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('photos', { keyPath: 'id' });
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          database = null;
        };
        resolve(request.result);
      };
      request.onerror = () => reject(new Error('相册存储不可用。'));
      request.onblocked = () => reject(new Error('请关闭其他时钟窗口后重试。'));
    }).catch((error) => {
      database = null;
      throw error;
    });
  }
  return database;
}

async function transaction(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', mode);
    let value;
    const request = operation(tx.objectStore('photos'));
    request.onsuccess = () => {
      value = request.result;
    };
    tx.oncomplete = () => resolve(value);
    tx.onabort = tx.onerror = () => reject(new Error('相册保存失败，请检查可用存储空间。'));
  });
}

export async function listPhotos() {
  const photos = await transaction('readonly', (store) => store.getAll());
  return photos
    .filter(
      (photo) =>
        /^photo:[a-f0-9]{64}$/.test(photo.id) &&
        photo.image instanceof Blob &&
        photo.thumbnail instanceof Blob &&
        photo.image.type === 'image/jpeg' &&
        photo.thumbnail.type === 'image/jpeg'
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

function canvasBlob(canvas, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('无法处理这张照片。'))),
      'image/jpeg',
      quality
    )
  );
}

export async function preparePhoto(file) {
  if (
    !file ||
    file.size > MAX_FILE_BYTES ||
    !file.size ||
    !/\.(jpe?g|png|webp)$/i.test(file.name) ||
    (file.type && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
  )
    throw new Error('请选择不超过 20 MB 的 JPG、PNG 或 WebP 照片。');
  const bytes = await file.arrayBuffer();
  const signature = new Uint8Array(bytes);
  const jpeg = signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => signature[index] === byte);
  const webp =
    String.fromCharCode(...signature.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...signature.slice(8, 12)) === 'WEBP';
  if (!jpeg && !png && !webp) throw new Error('照片格式不受支持。');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const id =
    'photo:' +
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const original = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = original;
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 40_000_000
    )
      throw new Error('照片尺寸过大，请选择不超过 4000 万像素的照片。');
    const canvas = document.createElement('canvas');
    const ratio = Math.min(1, 2560 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const drawing = canvas.getContext('2d');
    if (!drawing) throw new Error('当前环境无法处理照片。');
    drawing.fillStyle = '#080d10';
    drawing.fillRect(0, 0, canvas.width, canvas.height);
    drawing.drawImage(image, 0, 0, canvas.width, canvas.height);
    const full = await canvasBlob(canvas, 0.88);
    const small = document.createElement('canvas');
    const scale = Math.min(1, 320 / Math.max(canvas.width, canvas.height));
    small.width = Math.max(1, Math.round(canvas.width * scale));
    small.height = Math.max(1, Math.round(canvas.height * scale));
    small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);
    return {
      id,
      name: file.name.slice(0, 100),
      image: full,
      thumbnail: await canvasBlob(small, 0.8),
      enabled: true,
      x: 50,
      y: 50,
      createdAt: Date.now(),
    };
  } finally {
    image.src = '';
    URL.revokeObjectURL(original);
  }
}

export async function addPhoto(file) {
  const photo = await preparePhoto(file);
  // Capacity and deduplication are checked inside one read/write transaction, also across windows.
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite');
    const store = tx.objectStore('photos');
    let result = null,
      error;
    const request = store.getAll();
    request.onsuccess = () => {
      const records = request.result;
      if (records.some((record) => record.id === photo.id)) return;
      if (
        records.length >= MAX_PHOTOS ||
        records.reduce((total, record) => total + record.image.size + record.thumbnail.size, 0) +
          photo.image.size +
          photo.thumbnail.size >
          MAX_LIBRARY_BYTES
      ) {
        error = new Error('相册已满（最多 24 张、共 64 MB）。可先移出部分照片。');
        tx.abort();
        return;
      }
      store.add(photo);
      result = photo;
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () =>
      reject(error || new Error('相册保存失败，请检查可用存储空间。'));
  });
}

export async function updatePhoto(id, patch) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite'),
      store = tx.objectStore('photos');
    const request = store.get(id);
    let result;
    request.onsuccess = () => {
      const photo = request.result;
      if (!photo) {
        tx.abort();
        return;
      }
      if (typeof patch.enabled === 'boolean') photo.enabled = patch.enabled;
      for (const key of ['x', 'y'])
        if (Number.isFinite(patch[key]))
          photo[key] = Math.min(100, Math.max(0, Math.round(patch[key])));
      store.put(photo);
      result = photo;
    };
    tx.oncomplete = () => resolve(result);
    tx.onabort = tx.onerror = () => reject(new Error('照片设置未能保存。'));
  });
}
export async function removePhoto(id) {
  await transaction('readwrite', (store) => store.delete(id));
}
