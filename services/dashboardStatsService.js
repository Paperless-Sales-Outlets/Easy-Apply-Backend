import { query, toCamelCase } from '../config/db.js';
import { pickFrom } from '../db/jsonSelect.js';
import { sriLankaDay, startOfSriLankaDay, endOfSriLankaDay } from '../utils/sriLankaDate.js';

// Statuses that still need staff action. Same pair the dashboard treats as "pending".
export const PENDING_STATUSES = ['pending', 'pending payment'];
export const COMPLETED_STATUSES = ['approved', 'confirmed'];

export const DEFAULT_TREND_DAYS = 7;
export const MAX_TREND_DAYS = 366;
export const DEFAULT_PENDING_PAGE_SIZE = 50;
export const MAX_PENDING_PAGE_SIZE = 100;

const ONE_DAY_MS = 86400000;
const shiftDay = (day, by) => new Date(Date.parse(day) + by * ONE_DAY_MS).toISOString().slice(0, 10);
const daysBetween = (fromDay, toDay) => Math.round((Date.parse(toDay) - Date.parse(fromDay)) / ONE_DAY_MS);

const positiveInt = (value, fallback, max) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

/**
 * Every application still awaiting action, newest first, one page at a time.
 * There is no fixed row cap: `total` is the full count and `page` walks through
 * all of them. Only the form fields in `formKeys` are read out of the JSON
 * column, so the customer's uploaded images are never loaded.
 */
export const getPendingApplicationRows = async ({ page, limit, formKeys = [] } = {}) => {
  const pageSize = positiveInt(limit, DEFAULT_PENDING_PAGE_SIZE, MAX_PENDING_PAGE_SIZE);
  const requestedPage = positiveInt(page, 1, 1000000);
  // With no keys asked for there is nothing to pick out of the JSON column.
  const formData = formKeys.length ? pickFrom('form_data', formKeys, 'f', (v) => v) : `'{}'::jsonb`;

  const [{ rows: totals }, { rows }] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS total, MIN(created_at) AS oldest
       FROM applications WHERE status = ANY($1)`,
      [PENDING_STATUSES]
    ),
    query(
      `SELECT id, reference_number, nic, phone, service_type, status, notes, actioned_by, actioned_at, created_at,
         ${formData} AS form_data
       FROM applications
       WHERE status = ANY($1)
       ORDER BY created_at DESC, id
       LIMIT $2 OFFSET $3`,
      [PENDING_STATUSES, pageSize, (requestedPage - 1) * pageSize]
    ),
  ]);

  const total = totals[0]?.total || 0;
  return {
    total,
    page: requestedPage,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    oldestSubmittedAt: totals[0]?.oldest || null,
    rows: rows.map((row) => toCamelCase(row)),
  };
};

/**
 * The Sri Lanka day window for the daily chart. Both ends are optional:
 *   neither  -> the last DEFAULT_TREND_DAYS days ending today
 *   only end -> DEFAULT_TREND_DAYS days ending there
 *   only start -> from there up to today
 * A window longer than MAX_TREND_DAYS is trimmed from the start.
 * Inputs are expected to be valid (the route validates them first).
 */
export const resolveDailyWindow = (startDate, endDate) => {
  const today = sriLankaDay(new Date());
  const toDay = endDate ? sriLankaDay(endDate) : today;
  let fromDay = startDate ? sriLankaDay(startDate) : shiftDay(toDay, -(DEFAULT_TREND_DAYS - 1));
  if (daysBetween(fromDay, toDay) >= MAX_TREND_DAYS) fromDay = shiftDay(toDay, -(MAX_TREND_DAYS - 1));
  return { fromDay, toDay, days: daysBetween(fromDay, toDay) + 1 };
};

const SL_DAY = (column) => `to_char(${column} AT TIME ZONE 'Asia/Colombo', 'YYYY-MM-DD')`;

/**
 * One row per Sri Lanka day in the window, zero-filled, from two SQL GROUP BY
 * queries. The four counters mirror the dashboard's trend lines:
 *   submitted - applications created that day
 *   pending   - of those, the ones still awaiting action
 *   approved  - approved/confirmed, counted on the day they were actioned
 *   rejected  - rejected, counted on the day they were actioned
 */
export const getDailyApplicationCounts = async ({ fromDay, toDay }) => {
  const from = startOfSriLankaDay(fromDay);
  const to = endOfSriLankaDay(toDay);
  const actionedAt = 'COALESCE(actioned_at, updated_at)';

  const [{ rows: created }, { rows: actioned }] = await Promise.all([
    query(
      `SELECT ${SL_DAY('created_at')} AS day,
              COUNT(*)::int AS submitted,
              (COUNT(*) FILTER (WHERE status = ANY($3)))::int AS pending
       FROM applications
       WHERE created_at >= $1 AND created_at <= $2
       GROUP BY 1`,
      [from, to, PENDING_STATUSES]
    ),
    query(
      `SELECT ${SL_DAY(actionedAt)} AS day,
              (COUNT(*) FILTER (WHERE status = ANY($3)))::int AS approved,
              (COUNT(*) FILTER (WHERE status = 'rejected'))::int AS rejected
       FROM applications
       WHERE ${actionedAt} >= $1 AND ${actionedAt} <= $2
         AND (status = ANY($3) OR status = 'rejected')
       GROUP BY 1`,
      [from, to, COMPLETED_STATUSES]
    ),
  ]);

  const byDay = new Map();
  created.forEach((row) => byDay.set(row.day, { submitted: row.submitted, pending: row.pending }));
  const actionedByDay = new Map(actioned.map((row) => [row.day, row]));

  const series = [];
  const days = daysBetween(fromDay, toDay) + 1;
  for (let i = 0; i < days; i += 1) {
    const date = shiftDay(fromDay, i);
    const made = byDay.get(date);
    const done = actionedByDay.get(date);
    series.push({
      date,
      submitted: made?.submitted || 0,
      pending: made?.pending || 0,
      approved: done?.approved || 0,
      rejected: done?.rejected || 0,
    });
  }
  return series;
};
