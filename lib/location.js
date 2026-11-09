export const LOCATION_KEY = 'horizon-location-v1';
export const LOCATION_MAX_AGE = 24 * 60 * 60 * 1000;

export function roundedLocation(coords) {
  if (
    typeof coords?.latitude !== 'number' ||
    typeof coords?.longitude !== 'number' ||
    !Number.isFinite(coords.latitude) ||
    !Number.isFinite(coords.longitude) ||
    Math.abs(coords.latitude) > 90 ||
    Math.abs(coords.longitude) > 180
  )
    throw new Error('Invalid location');
  return {
    latitude: Math.round(coords.latitude * 100) / 100,
    longitude: Math.round(coords.longitude * 100) / 100,
  };
}

export class LocationError extends Error {
  constructor(code) {
    super(code === 1 ? '定位未授权' : code === 3 ? '定位超时' : '定位不可用');
    this.name = 'LocationError';
    this.code = code;
  }
}

export function systemLocation(signal, geolocation = navigator.geolocation) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value);
    };
    const abort = () => finish(new DOMException('Canceled', 'AbortError'));
    // Browser permission prompts are not included in the API's own timeout.
    const timer = setTimeout(() => finish(new LocationError(3)), 10000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) return abort();
    if (!geolocation) return finish(new LocationError(2));
    try {
      geolocation.getCurrentPosition(
        (position) => {
          try {
            finish(null, roundedLocation(position.coords));
          } catch {
            finish(new LocationError(2));
          }
        },
        (error) => finish(new LocationError(error.code)),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 0 }
      );
    } catch {
      finish(new LocationError(2));
    }
  });
}

export function readLocation(storage, now = Date.now()) {
  try {
    const value = JSON.parse(storage.getItem(LOCATION_KEY));
    if (
      typeof value?.fetchedAt !== 'number' ||
      !Number.isFinite(value.fetchedAt) ||
      value.fetchedAt > now ||
      now - value.fetchedAt >= LOCATION_MAX_AGE
    )
      return null;
    return roundedLocation(value);
  } catch {
    return null;
  }
}
