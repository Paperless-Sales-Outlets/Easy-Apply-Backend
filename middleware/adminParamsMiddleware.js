// Every admin record id is a UUID. Anything else can't match a record, so it is
// answered as "not found" here instead of reaching the database and failing as a 500.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** For router.param('id', ...): a malformed id gets a 404 "<label> not found". */
export const rejectInvalidId = (label = 'Record') => (req, res, next, value) => {
  if (UUID.test(String(value))) return next();
  return res.status(404).json({ success: false, message: `${label} not found` });
};

/** The same check as route middleware, for routers whose privilege check is per route (so it runs first). */
export const requireValidId = (label = 'Record') => {
  const check = rejectInvalidId(label);
  return (req, res, next) => check(req, res, next, req.params.id);
};

// The date filters the admin pages send; each must be a real day when given.
const DATE_PARAMS = { date: 'date', startDate: 'start date', endDate: 'end date', from: 'from date', to: 'to date' };

// A calendar day ('2026-11-13', and not '2026-02-31') or a full ISO timestamp.
// Looser forms such as '5' would otherwise be read as some unrelated date.
const isRealDate = (value) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(new Date(value).getTime());
};

/** Rejects a request whose date filter isn't a date, instead of silently ignoring it. */
export const rejectInvalidDates = (req, res, next) => {
  for (const [key, label] of Object.entries(DATE_PARAMS)) {
    const value = req.query?.[key];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || !isRealDate(value)) {
      return res.status(400).json({ success: false, message: `Invalid ${label}. Use the format YYYY-MM-DD.` });
    }
  }
  return next();
};
