// State Council annual notices. Dates describe the national general holiday calendar.
export const CHINA_CALENDARS = Object.freeze({
  2026: {
    source: 'https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm',
    holidays: [
      ['01-01', '01-03'],
      ['02-15', '02-23'],
      ['04-04', '04-06'],
      ['05-01', '05-05'],
      ['06-19', '06-21'],
      ['09-25', '09-27'],
      ['10-01', '10-07'],
    ],
    workdays: ['01-04', '02-14', '02-28', '05-09', '09-20', '10-10'],
  },
  2027: {
    source: 'https://www.gov.cn/zhengce/content/202611/content_7085101.htm',
    holidays: [
      ['01-01', '01-03'],
      ['02-05', '02-13'],
      ['04-03', '04-05'],
      ['05-01', '05-05'],
      ['06-09', '06-09'],
      ['09-15', '09-15'],
      ['10-01', '10-07'],
    ],
    workdays: ['01-31', '02-14', '05-08', '09-26', '10-09'],
  },
});

export const pad = (value) => String(value).padStart(2, '0');
export function localDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function calendarDay(date) {
  const calendar = CHINA_CALENDARS[date.getFullYear()];
  if (!calendar) return 'unknown';
  const day = localDate(date).slice(5);
  if (calendar.workdays.includes(day)) return 'workday';
  if (calendar.holidays.some(([start, end]) => day >= start && day <= end)) return 'holiday';
  return [0, 6].includes(date.getDay()) ? 'holiday' : 'workday';
}
