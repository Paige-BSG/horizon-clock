import { CITIES } from './settings.js';
import { roundedLocation } from './location.js';
export const WEATHER_TTL = 15 * 60 * 1000;
export const WEATHER_MAX_AGE = 24 * 60 * 60 * 1000;
export function weatherPlaceKey(place) {
  if (typeof place === 'string') {
    if (!Object.hasOwn(CITIES, place)) throw new Error('Unknown weather city');
    return place;
  }
  const { latitude, longitude } = roundedLocation(place);
  return `location:${latitude},${longitude}`;
}
export function weatherUrl(city) {
  weatherPlaceKey(city);
  const params = new URLSearchParams({
    ...(typeof city === 'string' ? CITIES[city] : roundedLocation(city)),
    current:
      'temperature_2m,relative_humidity_2m,is_day,weather_code,wind_speed_10m,wind_direction_10m',
    daily: 'temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: '1',
    timeformat: 'unixtime',
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}
export function weatherDescription(code, isDay = true) {
  if (code === 0) return isDay ? '晴朗' : '晴夜';
  if (code <= 2) return '晴间多云';
  if (code === 3) return '多云';
  if ([45, 48].includes(code)) return '有雾';
  if ([51, 53, 55, 56, 57].includes(code)) return '毛毛雨';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '有雨';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return '有雪';
  if ([95, 96, 99].includes(code)) return '雷阵雨';
  return '天气变化中';
}
export function windDirection(degrees) {
  return ['北风', '东北风', '东风', '东南风', '南风', '西南风', '西风', '西北风'][
    Math.round((((degrees % 360) + 360) % 360) / 45) % 8
  ];
}
export function parseWeather(payload, place, now = Date.now()) {
  const city = weatherPlaceKey(place);
  const current = payload?.current,
    daily = payload?.daily;
  const numbers = [
    current?.temperature_2m,
    current?.relative_humidity_2m,
    current?.wind_speed_10m,
    current?.wind_direction_10m,
    current?.weather_code,
    current?.time,
    daily?.temperature_2m_max?.[0],
    daily?.temperature_2m_min?.[0],
  ];
  if (!numbers.every((value) => typeof value === 'number' && Number.isFinite(value)))
    throw new Error('Invalid weather response');
  const [temperature, humidity, wind, direction, code, observation, high, low] = numbers;
  if (
    temperature < -100 ||
    temperature > 70 ||
    humidity < 0 ||
    humidity > 100 ||
    wind < 0 ||
    wind > 500 ||
    high < low ||
    high > 70 ||
    low < -100 ||
    !Number.isInteger(code) ||
    code < 0 ||
    code > 99 ||
    ![0, 1].includes(current.is_day) ||
    observation * 1000 > now + 15 * 60 * 1000 ||
    observation * 1000 < now - WEATHER_MAX_AGE
  )
    throw new Error('Invalid weather values');
  if (
    payload.current_units?.temperature_2m !== '°C' ||
    payload.current_units?.wind_speed_10m !== 'km/h'
  )
    throw new Error('Unexpected weather units');
  return {
    city,
    temperature: Math.round(temperature),
    humidity: Math.round(humidity),
    wind: Math.round(wind),
    direction: windDirection(direction),
    code,
    isDay: current.is_day === 1,
    high: Math.round(high),
    low: Math.round(low),
    fetchedAt: now,
    observedAt: observation * 1000,
  };
}
export function validCache(value, place, now = Date.now()) {
  let city;
  try {
    city = weatherPlaceKey(place);
  } catch {
    return false;
  }
  return (
    !!value &&
    value.city === city &&
    ['temperature', 'humidity', 'wind', 'code', 'high', 'low', 'fetchedAt', 'observedAt'].every(
      (key) => typeof value[key] === 'number' && Number.isFinite(value[key])
    ) &&
    typeof value.direction === 'string' &&
    value.direction.length < 12 &&
    typeof value.isDay === 'boolean' &&
    value.temperature >= -100 &&
    value.temperature <= 70 &&
    value.humidity >= 0 &&
    value.humidity <= 100 &&
    value.wind >= 0 &&
    value.wind <= 500 &&
    value.high >= value.low &&
    value.high <= 70 &&
    value.low >= -100 &&
    Number.isInteger(value.code) &&
    value.code >= 0 &&
    value.code <= 99 &&
    now - value.fetchedAt >= -60000 &&
    now - value.fetchedAt < WEATHER_MAX_AGE &&
    now - value.observedAt >= -900000 &&
    now - value.observedAt < WEATHER_MAX_AGE
  );
}
