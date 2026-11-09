export const GALLERY_DAY = 24 * 60 * 60 * 1000;
export const GALLERY_RETRY = 60 * 60 * 1000;
export const MAX_ONLINE_SCENES = 24;
export const MAX_ONLINE_BYTES = 96 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const licenses = {
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
  'CC BY 3.0': 'https://creativecommons.org/licenses/by/3.0/',
  'CC BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/',
  CC0: 'https://creativecommons.org/publicdomain/zero/1.0/',
  'Public domain': 'https://creativecommons.org/publicdomain/mark/1.0/',
};

export function plainCredit(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_, entity) => {
      const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const point =
        entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : '';
    })
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validImageUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !['thumb.wikimedia.org', 'upload.wikimedia.org'].includes(url.hostname) ||
      !url.pathname.startsWith('/wikipedia/commons/thumb/') ||
      !/\.jpe?g$/i.test(url.pathname)
    )
      return null;
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

export function validSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      url.hostname === 'commons.wikimedia.org' &&
      decodeURIComponent(url.pathname).startsWith('/wiki/File:')
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function commonsScenes(data, excluded = []) {
  const pages = data?.query?.pages;
  if (!pages || typeof pages !== 'object') throw new Error('在线图库返回了无效数据。');
  const blocked = new Set(excluded),
    seen = new Set();
  return Object.values(pages)
    .slice(0, 50)
    .flatMap((page) => {
      const info = page.imageinfo?.[0],
        meta = info?.extmetadata;
      const license = meta?.LicenseShortName?.value;
      const artist = plainCredit(meta?.Artist?.value);
      const id = `commons:${page.pageid}`;
      const imageUrl = validImageUrl(info?.thumburl);
      const revision = info?.sha1;
      const sourceUrl = validSourceUrl(info?.descriptionurl);
      if (
        !Number.isSafeInteger(page.pageid) ||
        page.pageid <= 0 ||
        seen.has(id) ||
        blocked.has(id) ||
        !licenses[license] ||
        !/^[a-f0-9]{40}$/.test(revision || '') ||
        !artist ||
        artist.length > 500 ||
        !imageUrl ||
        !sourceUrl ||
        info?.mime !== 'image/jpeg' ||
        !(
          info.width >= 1920 &&
          info.height > 0 &&
          info.width / info.height >= 1.3 &&
          info.width / info.height <= 3
        )
      )
        return [];
      seen.add(id);
      return [
        {
          id,
          revision,
          name:
            plainCredit(
              page.title
                ?.replace(/^File:/, '')
                .replace(/\.jpe?g$/i, '')
                .replace(/_/g, ' ')
            ).slice(0, 100) || '远方风景',
          artist,
          license,
          licenseUrl: licenses[license],
          sourceUrl,
          imageUrl,
          changes: '已缩放为 JPEG 背景副本；显示时按屏幕自适应裁切。',
        },
      ];
    });
}

export function catalogUrl() {
  return `${COMMONS_API}?${new URLSearchParams({ action: 'query', list: 'categorymembers', cmtitle: 'Category:Featured pictures of landscapes', cmnamespace: '6', cmsort: 'timestamp', cmdir: 'desc', cmlimit: '50', cmprop: 'ids|timestamp', format: 'json', origin: '*', maxlag: '5' })}`;
}

export function catalogIds(data) {
  if (!Array.isArray(data?.query?.categorymembers)) throw new Error('在线图库目录不可用。');
  return [
    ...new Set(
      data.query.categorymembers
        .slice(0, 50)
        .map((item) => item?.pageid)
        .filter((id) => Number.isSafeInteger(id) && id > 0)
    ),
  ];
}

export function imageInfoUrl(ids) {
  if (!ids.length || ids.length > 50 || !ids.every((id) => Number.isSafeInteger(id) && id > 0))
    throw new Error('在线图库目录不可用。');
  return `${COMMONS_API}?${new URLSearchParams({ action: 'query', pageids: ids.join('|'), prop: 'imageinfo', iiprop: 'url|size|mime|sha1|extmetadata', iiurlwidth: '1920', iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl', format: 'json', origin: '*', maxlag: '5' })}`;
}

export async function boundedBody(response, limit) {
  if (!response.ok || Number(response.headers.get('Content-Length')) > limit)
    throw new Error('在线图片暂时不可用。');
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > limit) throw new Error('在线图片过大。');
    return bytes;
  }
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('在线图片过大。');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.byteLength;
  }
  return bytes;
}

export function validCachedScene(scene) {
  return (
    /^commons:[1-9]\d{0,14}$/.test(scene?.id) &&
    typeof scene.name === 'string' &&
    scene.name.length <= 100 &&
    typeof scene.artist === 'string' &&
    scene.artist.length <= 500 &&
    !scene.src &&
    !scene.thumb &&
    /^[a-f0-9]{40}$/.test(scene.revision || '') &&
    validImageUrl(scene.imageUrl) &&
    licenses[scene.license] === scene.licenseUrl &&
    validSourceUrl(scene.sourceUrl) &&
    scene.image instanceof Blob &&
    scene.thumbnail instanceof Blob &&
    scene.image.type === 'image/jpeg' &&
    scene.thumbnail.type === 'image/jpeg' &&
    scene.image.size + scene.thumbnail.size <= MAX_IMAGE_BYTES * 2
  );
}
