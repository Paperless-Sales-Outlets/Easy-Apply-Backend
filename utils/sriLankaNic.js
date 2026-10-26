// Server-side Sri Lankan NIC number model (mirrors the frontend's
// src/utils/sriLankaNic.js — keep the two in step).
//
// Both card formats encode birth year, day-of-year and sex inside the number,
// so a NIC can be cross-checked against a profile's date of birth and gender
// without reading anything off the card image.
//
//   Old  YY DDD NNNN + V|X   e.g. 851234567V
//   New  YYYY DDD NNNNN      e.g. 198512304567
//
// Day-of-year uses the DRP's fixed 366-day calendar (February always has 29
// days) and women have 500 added to the day.

const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MIN_BIRTH_YEAR = 1900;

export const cleanNic = (raw) =>
  raw === null || raw === undefined ? '' : String(raw).replace(/[\s\-_/.]/g, '').trim().toUpperCase();

const oldFormatYear = (yy) => (yy === 0 ? 2000 : 1900 + yy);

function toMonthDay(dayOfYear) {
  let remaining = dayOfYear;
  for (let i = 0; i < MONTH_DAYS.length; i += 1) {
    if (remaining <= MONTH_DAYS[i]) return { month: i + 1, day: remaining };
    remaining -= MONTH_DAYS[i];
  }
  return null;
}

const isRealDate = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/** 12-digit form of any valid NIC, or null. */
export function toNewFormat(raw) {
  const nic = cleanNic(raw);
  if (/^\d{12}$/.test(nic)) return nic;
  if (!/^\d{9}[VX]$/.test(nic)) return null;
  return `${oldFormatYear(Number(nic.slice(0, 2)))}${nic.slice(2, 5)}0${nic.slice(5, 9)}`;
}

/**
 * Decodes a NIC. Returns null when it is not a structurally valid NIC.
 * `dob` is null when the number points at a date that never existed (29 Feb of
 * a common year) — callers must not invent a birthday.
 */
export function parseNic(raw, today = new Date()) {
  const nic = cleanNic(raw);
  let year;
  let rawDay;

  if (/^\d{12}$/.test(nic)) {
    year = Number(nic.slice(0, 4));
    rawDay = Number(nic.slice(4, 7));
  } else if (/^\d{9}[VX]$/.test(nic)) {
    year = oldFormatYear(Number(nic.slice(0, 2)));
    rawDay = Number(nic.slice(2, 5));
  } else {
    return null;
  }

  if (year < MIN_BIRTH_YEAR || year > today.getUTCFullYear()) return null;

  const female = rawDay > 500;
  const dayOfYear = female ? rawDay - 500 : rawDay;
  if (dayOfYear < 1 || dayOfYear > 366) return null;

  const md = toMonthDay(dayOfYear);
  if (!md) return null;

  const dob = isRealDate(year, md.month, md.day)
    ? `${year}-${String(md.month).padStart(2, '0')}-${String(md.day).padStart(2, '0')}`
    : null;

  let age = null;
  if (dob) {
    age = today.getUTCFullYear() - year;
    const beforeBirthday =
      today.getUTCMonth() + 1 < md.month || (today.getUTCMonth() + 1 === md.month && today.getUTCDate() < md.day);
    if (beforeBirthday) age -= 1;
  }

  return { nic, normalized: toNewFormat(nic), dob, gender: female ? 'Female' : 'Male', age };
}
