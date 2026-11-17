// The portal works in Sri Lanka time (UTC+5:30, no daylight saving). A date
// picked on a page means that whole day there, whatever timezone the server is in.
const OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The 'YYYY-MM-DD' Sri Lanka day a value falls on, or null if it isn't a date. */
export const sriLankaDay = (value = new Date()) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return DATE_ONLY.test(value) ? value : new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 10);
};

/** The first moment of the Sri Lanka day a value falls on, or null if it isn't a date. */
export const startOfSriLankaDay = (value) => {
  const day = sriLankaDay(value);
  return day ? new Date(`${day}T00:00:00.000+05:30`) : null;
};

/** The last moment of the Sri Lanka day a value falls on, or null if it isn't a date. */
export const endOfSriLankaDay = (value) => {
  const day = sriLankaDay(value);
  return day ? new Date(`${day}T23:59:59.999+05:30`) : null;
};

/** A { $gte, $lte } filter covering whole Sri Lanka days, or null when neither end is a date. */
export const sriLankaDayRange = (start, end) => {
  const range = {};
  const from = start ? startOfSriLankaDay(start) : null;
  const to = end ? endOfSriLankaDay(end) : null;
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  return Object.keys(range).length ? range : null;
};
