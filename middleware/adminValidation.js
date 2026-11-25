import { sriLankaDay } from '../utils/sriLankaDate.js';

// Every admin resource id (applications, leads, drafts, appointments, users,
// roles, privileges) is a PostgreSQL UUID primary key.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isValidUuid = (value) => typeof value === 'string' && UUID_PATTERN.test(value);

/**
 * router.param('id', validateAdminId)
 *
 * Runs before the controller for every route with an `:id` segment and answers
 * 404 for a malformed id, so PostgreSQL never sees `invalid input syntax for
 * type uuid` (which used to surface as a 500). Well-formed ids that match no
 * row still reach the controller and get its own "not found" response.
 */
export const validateAdminId = (req, res, next, value) => {
  if (!isValidUuid(value)) {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  return next();
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date; rejects 2024-02-31, 2024-13-01, arrays, junk text. */
export const isValidDateInput = (value) => {
  if (typeof value !== 'string') return false;
  const dateOnly = value.match(DATE_ONLY);
  if (dateOnly) {
    const [, y, m, d] = dateOnly.map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d));
    return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
  }
  return sriLankaDay(value) !== null;
};

const supplied = (value) => value !== undefined && value !== null && value !== '';

/**
 * validateDateQuery(['from', 'to'], { range: ['from', 'to'], rejectReversed: true })
 *
 * Checks the named query parameters before the controller runs:
 *  - missing or empty values are skipped, so existing defaults are untouched
 *  - a supplied value that is not a real date answers 400 { message: 'Invalid date' }
 *  - with `rejectReversed`, a start day after the end day also answers 400
 */
export const validateDateQuery = (names, { range, rejectReversed = false } = {}) => (req, res, next) => {
  const invalid = () => res.status(400).json({ success: false, message: 'Invalid date' });

  for (const name of names) {
    const value = req.query[name];
    if (supplied(value) && !isValidDateInput(value)) return invalid();
  }

  if (rejectReversed && range) {
    const [startName, endName] = range;
    const start = req.query[startName];
    const end = req.query[endName];
    if (supplied(start) && supplied(end) && sriLankaDay(start) > sriLankaDay(end)) return invalid();
  }

  return next();
};
