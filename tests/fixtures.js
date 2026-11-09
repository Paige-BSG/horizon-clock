export const NOW = new Date('2026-11-09T12:00:00+09:00').getTime();
export const weatherFixture = (temperature = 21, now = NOW) => ({
  current: {
    temperature_2m: temperature,
    relative_humidity_2m: 58,
    wind_speed_10m: 8,
    wind_direction_10m: 45,
    weather_code: 2,
    is_day: 1,
    time: Math.floor(now / 1000),
  },
  current_units: { temperature_2m: '°C', wind_speed_10m: 'km/h' },
  daily: { temperature_2m_max: [24], temperature_2m_min: [17] },
});
