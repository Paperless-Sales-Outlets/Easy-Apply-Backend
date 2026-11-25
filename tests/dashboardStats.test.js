process.env.NODE_ENV = 'test';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import connectDB, { pool } from '../config/db.js';
import {
  getPendingApplicationRows,
  getDailyApplicationCounts,
  resolveDailyWindow,
  DEFAULT_TREND_DAYS,
  MAX_TREND_DAYS,
  MAX_PENDING_PAGE_SIZE,
} from '../services/dashboardStatsService.js';
import Application from '../models/Application.js';

// Fixtures are dated in March 2001, so they can never mix with real data in the
// day-window tests, and every row carries the prefix so cleanup is exact.
const PREFIX = `TEST-DASH-${Date.now()}`;
const insert = (suffix, { status, created, actioned = null, type = 'new-connection' }) =>
  pool.query(
    `INSERT INTO applications (reference_number, phone, service_type, nic, status, created_at, updated_at, actioned_at)
     VALUES ($1, '0700000000', $2, '200000000000', $3, $4, $4, $5)`,
    [`${PREFIX}-${suffix}`, type, status, created, actioned]
  );

const cleanup = () => pool.query('DELETE FROM applications WHERE reference_number LIKE $1', [`${PREFIX}-%`]);

describe('Dashboard statistics service', () => {
  before(async () => {
    await connectDB();
    await cleanup();
  });

  after(async () => {
    await cleanup();
    await pool.end();
  });

  describe('daily window resolution', () => {
    test('defaults to the last 7 days ending today', () => {
      const { fromDay, toDay, days } = resolveDailyWindow(undefined, undefined);
      assert.equal(days, DEFAULT_TREND_DAYS);
      assert.equal((Date.parse(toDay) - Date.parse(fromDay)) / 86400000, DEFAULT_TREND_DAYS - 1);
    });

    test('follows an explicit start and end date', () => {
      const w = resolveDailyWindow('2001-03-08', '2001-03-12');
      assert.deepEqual(w, { fromDay: '2001-03-08', toDay: '2001-03-12', days: 5 });
    });

    test('a single-day window is one day', () => {
      assert.equal(resolveDailyWindow('2001-03-10', '2001-03-10').days, 1);
    });

    test('only an end date gives 7 days ending there; only a start date runs to today', () => {
      assert.deepEqual(resolveDailyWindow(undefined, '2001-03-12'), { fromDay: '2001-03-06', toDay: '2001-03-12', days: 7 });
      const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
      const fromStart = resolveDailyWindow(threeDaysAgo, undefined);
      assert.equal(fromStart.fromDay, threeDaysAgo);
      assert.equal(fromStart.days, 4);
    });

    test('a window longer than a year is trimmed from the start', () => {
      const w = resolveDailyWindow('1990-01-01', '2001-03-12');
      assert.equal(w.days, MAX_TREND_DAYS);
      assert.equal(w.toDay, '2001-03-12');
    });
  });

  describe('daily application counts', () => {
    before(async () => {
      // 2001-03-10 02:00 Sri Lanka time is still 2001-03-09 in UTC: it must land on the 10th.
      await insert('d1', { status: 'pending', created: '2001-03-10T02:00:00+05:30' });
      await insert('d2', { status: 'pending', created: '2001-03-10T15:00:00+05:30' });
      await insert('d3', { status: 'pending payment', created: '2001-03-11T09:00:00+05:30' });
      // Submitted on the 11th, actioned (approved) on the 12th.
      await insert('d4', { status: 'approved', created: '2001-03-11T10:00:00+05:30', actioned: '2001-03-12T10:00:00+05:30' });
      await insert('d5', { status: 'confirmed', created: '2001-03-11T11:00:00+05:30', actioned: '2001-03-12T11:00:00+05:30' });
      await insert('d6', { status: 'rejected', created: '2001-03-11T12:00:00+05:30', actioned: '2001-03-11T13:00:00+05:30' });
      await insert('d7', { status: 'flagged', created: '2001-03-12T12:00:00+05:30' });
    });

    test('groups by Sri Lanka day and fills every date in the window', async () => {
      const series = await getDailyApplicationCounts({ fromDay: '2001-03-08', toDay: '2001-03-13' });
      assert.deepEqual(series.map((d) => d.date), [
        '2001-03-08', '2001-03-09', '2001-03-10', '2001-03-11', '2001-03-12', '2001-03-13',
      ]);
    });

    test('counts submitted, pending, approved and rejected per day', async () => {
      const series = await getDailyApplicationCounts({ fromDay: '2001-03-08', toDay: '2001-03-13' });
      const byDate = Object.fromEntries(series.map((d) => [d.date, d]));

      assert.deepEqual(byDate['2001-03-10'], { date: '2001-03-10', submitted: 2, pending: 2, approved: 0, rejected: 0 });
      // d3 pending payment, d4/d5 approved+confirmed, d6 rejected were all submitted on the 11th; d6 also rejected that day.
      assert.deepEqual(byDate['2001-03-11'], { date: '2001-03-11', submitted: 4, pending: 1, approved: 0, rejected: 1 });
      // approvals are counted on the day they were actioned, flagged counts only as submitted.
      assert.deepEqual(byDate['2001-03-12'], { date: '2001-03-12', submitted: 1, pending: 0, approved: 2, rejected: 0 });
    });

    test('quiet days are zero rows, not missing', async () => {
      const series = await getDailyApplicationCounts({ fromDay: '2001-03-08', toDay: '2001-03-09' });
      assert.deepEqual(series, [
        { date: '2001-03-08', submitted: 0, pending: 0, approved: 0, rejected: 0 },
        { date: '2001-03-09', submitted: 0, pending: 0, approved: 0, rejected: 0 },
      ]);
    });

    test('date filter excludes days outside the window', async () => {
      const series = await getDailyApplicationCounts({ fromDay: '2001-03-11', toDay: '2001-03-11' });
      assert.equal(series.length, 1);
      assert.equal(series[0].submitted, 4);
    });

    test('empty dataset returns an all-zero continuous series, not an error', async () => {
      const series = await getDailyApplicationCounts({ fromDay: '2001-01-01', toDay: '2001-01-07' });
      assert.equal(series.length, 7);
      assert.ok(series.every((d) => d.submitted === 0 && d.pending === 0 && d.approved === 0 && d.rejected === 0));
    });
  });

  describe('status totals (SQL GROUP BY)', () => {
    test('totals match a direct count for every status, with no rows fetched into Node', async () => {
      const grouped = await Application.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
      const direct = await pool.query('SELECT status, COUNT(*)::int AS n FROM applications GROUP BY status');
      const expected = Object.fromEntries(direct.rows.map((r) => [r.status, r.n]));
      const actual = Object.fromEntries(grouped.map((r) => [r._id, r.count]));
      assert.deepEqual(actual, expected);
      // The fixtures above guarantee these statuses exist, so the grouping really saw them.
      assert.ok(actual.pending >= 2 && actual['pending payment'] >= 1 && actual.approved >= 1 && actual.rejected >= 1);
    });
  });

  describe('pending applications', () => {
    const FIXTURES = 205; // more than the old 200-row limit

    before(async () => {
      await pool.query(
        `INSERT INTO applications (reference_number, phone, service_type, nic, status, created_at, updated_at)
         SELECT $1 || '-p' || g, '0700000000', 'new-connection', '200000000000',
                CASE WHEN g % 2 = 0 THEN 'pending' ELSE 'pending payment' END,
                TIMESTAMPTZ '2001-04-01T00:00:00+05:30' + (g || ' minutes')::interval,
                NOW()
         FROM generate_series(1, $2) g`,
        [PREFIX, FIXTURES]
      );
    });

    test('there is no 200-row cap: every pending application is reachable page by page', async () => {
      const seen = [];
      let page = 1;
      let totalPages = 1;
      let total = 0;
      do {
        const result = await getPendingApplicationRows({ page, limit: MAX_PENDING_PAGE_SIZE });
        total = result.total;
        totalPages = result.totalPages;
        assert.ok(result.rows.length <= MAX_PENDING_PAGE_SIZE);
        seen.push(...result.rows.map((r) => r.referenceNumber));
        page += 1;
      } while (page <= totalPages);

      assert.equal(seen.length, total, 'pages together cover the full total');
      assert.equal(new Set(seen).size, seen.length, 'no application appears twice across pages');
      const fixtureRows = seen.filter((ref) => ref.startsWith(`${PREFIX}-p`));
      assert.equal(fixtureRows.length, FIXTURES, 'all 205 fixture applications were returned');
    });

    test('only pending and pending payment applications are returned', async () => {
      const { rows } = await getPendingApplicationRows({ page: 1, limit: MAX_PENDING_PAGE_SIZE });
      assert.ok(rows.length > 0);
      assert.ok(rows.every((r) => ['pending', 'pending payment'].includes(r.status)));
      assert.ok(!rows.some((r) => r.referenceNumber === `${PREFIX}-d7`), 'flagged is excluded');
    });

    test('keeps the newest-first order', async () => {
      const { rows } = await getPendingApplicationRows({ page: 1, limit: MAX_PENDING_PAGE_SIZE });
      const times = rows.map((r) => new Date(r.createdAt).getTime());
      assert.deepEqual(times, [...times].sort((a, b) => b - a));
    });

    test('reports the oldest pending submission', async () => {
      const { oldestSubmittedAt } = await getPendingApplicationRows({ page: 1, limit: 1 });
      // d1 (2001-03-10 02:00 Sri Lanka time) is the oldest pending row; real data is years newer.
      assert.equal(new Date(oldestSubmittedAt).getTime(), new Date('2001-03-10T02:00:00+05:30').getTime());
    });

    test('page size is capped and bad paging input falls back safely', async () => {
      const big = await getPendingApplicationRows({ page: 1, limit: 100000 });
      assert.equal(big.pageSize, MAX_PENDING_PAGE_SIZE);
      const bad = await getPendingApplicationRows({ page: 'abc', limit: -5 });
      assert.equal(bad.page, 1);
      assert.ok(bad.pageSize > 0);
    });

    test('a page beyond the last one is an empty list, not an error', async () => {
      const result = await getPendingApplicationRows({ page: 999999, limit: 10 });
      assert.deepEqual(result.rows, []);
      assert.ok(result.total >= FIXTURES);
    });

    test('form data is trimmed to the display fields (no customer images loaded)', async () => {
      const { rows } = await getPendingApplicationRows({ page: 1, limit: 5, formKeys: ['nameFull'] });
      rows.forEach((r) => assert.ok(!('nicFront' in (r.formData || {}))));
    });
  });
});
