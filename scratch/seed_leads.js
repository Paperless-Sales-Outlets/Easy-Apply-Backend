import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import Lead from '../models/Lead.js';
import User from '../models/User.js';
import { LEAD_CHECK_CATALOG } from '../models/Lead.js';
import { buildChecklist, evaluateChecks, rateCheck } from '../services/leadService.js';

// Usage: node scratch/seed_leads.js [--keep]
// Seeds demo leads for the admin Lead Management screen. Existing leads are
// left alone unless --keep is passed, in which case they are kept and extra
// demo leads are added alongside them.

dotenv.config({ path: path.resolve('.env') });

// Each entry supplies the reading; the pass / marginal / fail result is
// derived from the catalogue threshold so the seeded data always agrees with
// the rules the live survey form applies.
const buildChecks = (results = {}) => {
  const checks = buildChecklist();
  const catalog = new Map(LEAD_CHECK_CATALOG.map((c) => [c.key, c]));

  return checks.map((check) => {
    const result = results[check.key];
    if (!result) return check;
    const value = result.value ?? '';
    return {
      ...check,
      status: result.status || rateCheck(catalog.get(check.key), value) || 'pending',
      value,
      note: result.note || '',
      updatedAt: new Date(),
    };
  });
};

const seedLeads = async () => {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is not defined in your .env file');
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected successfully.');

    const admin = await User.findOne({ role: 'Admin' }).select('_id name').lean();

    if (!admin) {
      console.warn('No Admin account found — run scratch/seed_admin.js first. Leads will be unassigned.');
    }

    if (!process.argv.includes('--keep')) {
      const removed = await Lead.deleteMany({});
      console.log(`Cleared ${removed.deletedCount} existing lead(s).`);
    }

    const now = Date.now();
    const daysAgo = (n) => new Date(now - n * 24 * 60 * 60 * 1000);

    const drafts = [
      {
        customerName: 'Kasun Perera',
        phone: '0771234567',
        email: 'kasun.perera@example.lk',
        nic: '199012345678',
        address: 'No. 42, Temple Road, Nugegoda',
        district: 'Colombo',
        landmark: 'Opposite the town hall',
        packageName: '300 Mbps Fibre Broadband',
        speed: '300 Mbps',
        technology: 'FTTH',
        source: 'portal',
        status: 'survey-scheduled',
        assignedTo: admin?._id || null,
        surveyDate: new Date(now + 2 * 24 * 60 * 60 * 1000),
        createdAt: daysAgo(1),
        checks: buildChecks({}),
        notes: 'Customer called twice asking about the installation date.',
      },
      {
        customerName: 'Nimali Fernando',
        phone: '0763345566',
        email: 'nimali.f@example.lk',
        nic: '198505121234',
        address: '18/3, Hospital Lane, Maharagama',
        district: 'Colombo',
        landmark: 'Behind the clinic',
        packageName: '300 Mbps Fibre Broadband',
        speed: '300 Mbps',
        technology: 'FTTH',
        source: 'call-centre',
        status: 'survey-completed',
        assignedTo: admin?._id || null,
        surveyDate: daysAgo(2),
        createdAt: daysAgo(6),
        checks: buildChecks({
          'signal-strength': {
            value: '-33.4',
            note: 'ONT reads -33.4 dBm at the premises. Too low for any fibre package.',
          },
          'splitter-capacity': { value: '8' },
          'drop-distance': { value: '1240', note: 'Longest run on this street.' },
          infrastructure: { value: 'partial', note: 'Riser exists, no drop from the pillar.' },
          power: { value: 'available' },
          'exchange-capacity': { value: 'available' },
          'site-access': { value: 'moderate' },
          'right-of-way': { value: 'clear' },
          'address-verification': { value: 'verified' },
        }),
        notes: 'Signal is far below the threshold — needs a shorter drop or an alternative technology.',
      },
      {
        customerName: 'Ruwan Jayasuriya',
        phone: '0715567788',
        email: 'ruwan.j@example.lk',
        nic: '199203309876',
        address: '7, New Colombo Road, Maharagama',
        district: 'Colombo',
        landmark: 'Next to the petrol station',
        packageName: '300 Mbps Fibre Broadband',
        speed: '300 Mbps',
        technology: 'FTTH',
        source: 'field-sales',
        status: 'survey-completed',
        assignedTo: admin?._id || null,
        surveyDate: daysAgo(1),
        createdAt: daysAgo(8),
        checks: buildChecks({
          'signal-strength': { value: '-28.1', note: 'Holds 100 Mbps, will not hold 300 Mbps over the long term.' },
          'splitter-capacity': { value: '8' },
          'drop-distance': { value: '420' },
          infrastructure: { value: 'available' },
          power: { value: 'available' },
          'exchange-capacity': { value: 'available' },
          'site-access': { value: 'easy' },
          'right-of-way': { value: 'clear' },
          'address-verification': { value: 'verified' },
        }),
        notes: 'Offer the 100 Mbps package — the line will not carry 300 Mbps reliably.',
      },
      {
        customerName: 'Sajini Wickramasinghe',
        phone: '0756677889',
        email: 'sajini.w@example.lk',
        nic: '199511114321',
        address: '221, High Level Road, Nawinna',
        district: 'Colombo',
        landmark: 'Near the post box',
        packageName: '100 Mbps Fibre Broadband',
        speed: '100 Mbps',
        technology: 'FTTH',
        source: 'portal',
        status: 'qualified',
        assignedTo: admin?._id || null,
        surveyDate: daysAgo(3),
        createdAt: daysAgo(11),
        checks: buildChecks({
          'signal-strength': { value: '-22.6' },
          'splitter-capacity': { value: '4' },
          'drop-distance': { value: '310' },
          infrastructure: { value: 'available' },
          power: { value: 'available' },
          'exchange-capacity': { value: 'available' },
          'site-access': { value: 'easy' },
          'right-of-way': { value: 'clear' },
          'address-verification': { value: 'verified' },
        }),
      },
      {
        customerName: 'Tharindu Silva',
        phone: '0708899001',
        email: 'tharindu.s@example.lk',
        nic: '198808081111',
        address: '5, Kandy Road, Gampaha',
        district: 'Gampaha',
        landmark: 'Opposite the school',
        packageName: '50 Mbps Fibre Broadband',
        speed: '50 Mbps',
        technology: 'FTTH',
        source: 'partner',
        status: 'new',
        createdAt: daysAgo(0),
        notes: 'Partner reseller referral — confirm the address on the coverage map.',
      },
      {
        customerName: 'Ayesha Herath',
        phone: '0712200334',
        email: 'ayesha.h@example.lk',
        nic: '199702022222',
        address: '64, Temple Lane, Dehiwala',
        district: 'Colombo',
        landmark: 'Corner shop downstairs',
        packageName: '300 Mbps Fibre Broadband',
        speed: '300 Mbps',
        technology: 'FTTH',
        source: 'referral',
        status: 'survey-in-progress',
        assignedTo: admin?._id || null,
        surveyDate: daysAgo(0),
        createdAt: daysAgo(4),
        checks: buildChecks({ power: { value: 'available' } }),
      },
      {
        customerName: 'Dinesh Ranatunga',
        phone: '0769900112',
        email: 'dinesh.r@example.lk',
        nic: '198302105555',
        address: '9/2, Bamba Junction, Awissawella',
        district: 'Colombo',
        landmark: 'Near the rice mill',
        packageName: '50 Mbps Fibre Broadband',
        speed: '50 Mbps',
        technology: 'FTTH',
        source: 'walk-in',
        status: 'survey-completed',
        assignedTo: admin?._id || null,
        surveyDate: daysAgo(5),
        createdAt: daysAgo(14),
        checks: buildChecks({
          'signal-strength': { value: '-24.8' },
          'splitter-capacity': { value: '8' },
          'drop-distance': { value: '1080' },
          infrastructure: { value: 'partial' },
          power: { value: 'unstable', note: 'Customer runs a load on the same socket.' },
          'exchange-capacity': { value: 'available' },
          'site-access': { value: 'moderate' },
          'right-of-way': { value: 'permission-required', note: 'Needs a pole permission from the local council.' },
          'address-verification': { value: 'verified' },
        }),
        notes: 'Long drop and a marginal power supply — needs a decision before activation.',
      },
    ];

    for (const draft of drafts) {
      const evaluation = evaluateChecks(draft.checks);
      const lead = await Lead.create({
        ...draft,
        referenceNumber: `LEAD-${Math.floor(10000000 + Math.random() * 90000000)}`,
        riskLevel: evaluation.riskLevel,
        blockingIssues: evaluation.blockingIssues,
        createdBy: admin?._id || null,
      });
      console.log(`Seeded ${lead.referenceNumber} — ${lead.customerName} (${lead.status}, risk ${lead.riskLevel})`);
    }

    console.log(`\nSeeded ${drafts.length} lead(s).`);
  } catch (error) {
    console.error('Error seeding leads:', error.message);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed.');
  }
};

seedLeads();
