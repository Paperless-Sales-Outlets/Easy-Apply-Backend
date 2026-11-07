import mongoose from 'mongoose';

// ── Lead lifecycle ───────────────────────────────────────────────────────
// A lead is a prospective new connection that must clear a technical site
// survey before it can be provisioned. The survey records a result for every
// criterion in LEAD_CHECK_CATALOG; a failed critical criterion is what makes
// a service "disrupted" for the customer and has to be handled before the
// connection is activated.
export const LEAD_STATUSES = [
  'new',                // captured, not triaged yet
  'survey-scheduled',   // site visit booked
  'survey-in-progress', // technician is on site / readings being taken
  'survey-completed',   // results recorded, awaiting a decision
  'qualified',          // all critical checks passed — safe to activate
  'conditional',        // passed only with waivers — needs sign-off
  'not-feasible',       // a critical check failed — must be handled
  'approved',           // signed off, ready for activation
  'converted',          // turned into a live connection
  'on-hold',            // paused (customer unreachable, awaiting documents)
];

// Result recorded for one criterion.
export const LEAD_CHECK_STATUSES = [
  'pending',  // not measured yet
  'pass',     // meets the threshold
  'marginal', // meets it only with an exception
  'fail',     // does not meet the threshold
  'waived',   // failed but accepted by an officer
  'na',       // not applicable to this site
];

export const LEAD_RISK_LEVELS = ['none', 'low', 'medium', 'high', 'critical'];

export const LEAD_RESOLUTIONS = [
  'resurvey',               // re-visit the site (different drop route, better meter position)
  'alternative-package',    // serve a lower package the line can carry
  'alternative-technology', // serve over a different medium (FTTC / wireless)
  'engineering-review',     // escalate to the network team for a build
  'waived',                 // exception granted, proceed as surveyed
  'rejected',               // cannot be served
];

export const LEAD_SOURCES = [
  'portal', 'call-centre', 'field-sales', 'partner', 'referral', 'walk-in',
];

export const LEAD_TECHNOLOGIES = ['FTTH', 'FTTC', 'Copper', 'Wireless', 'Other'];

// ── The serviceability catalogue ─────────────────────────────────────────
// Every reason a new connection can be blocked. Optical signal strength is
// the most common one, but weak infrastructure, exhausted splitters, long
// drop runs, no power at the premises, inaccessible sites and unverifiable
// addresses all break new connections just as often, so they are tracked as
// first-class checks too.
//
// type 'numeric' checks carry a `scale` describing which direction is good:
//   direction 'above' → larger is better (dBm)
//   direction 'below' → smaller is better (metres, splitter ratio)
// type 'select' checks carry fixed `options`.
export const LEAD_CHECK_CATALOG = [
  {
    key: 'signal-strength',
    label: 'Optical Signal Strength',
    type: 'numeric',
    unit: 'dBm',
    metric: 'ONT receive power measured at the premises',
    threshold: 'Pass at -27 dBm or above, marginal to -30 dBm, fail below',
    scale: { direction: 'above', good: -27, warn: -30 },
    critical: true,
    guidance:
      'Read the ONT optical level meter at the customer end. Below -30 dBm the selected package will not stay up, so the drop needs a shorter run, a lower-ratio splitter or an extra pair of fibres.',
  },
  {
    key: 'splitter-capacity',
    label: 'Splitter / PON Port Capacity',
    type: 'numeric',
    unit: '1:x',
    valuePrefix: '1:',
    metric: 'Split ratio and free port count at the distribution point',
    threshold: 'Pass at 1:8 or below, marginal to 1:16, fail above',
    scale: { direction: 'below', good: 8, warn: 16 },
    critical: true,
    guidance:
      'A 1:8 splitter with no free port cannot take another drop. Either re-terminate on a free port or move the customer to a new splitter fed from the same OLT.',
  },
  {
    key: 'drop-distance',
    label: 'Drop Cable Distance',
    type: 'numeric',
    unit: 'm',
    metric: 'Fibre length from the distribution point to the premises',
    threshold: 'Pass up to 1000 m, marginal to 1500 m, fail beyond',
    scale: { direction: 'below', good: 1000, warn: 1500 },
    critical: false,
    guidance:
      'Longer drops lose more power and add latency. Over the limit the customer should be moved to the nearer distribution point instead of extending the drop.',
  },
  {
    key: 'infrastructure',
    label: 'Existing Fibre Infrastructure',
    type: 'select',
    options: ['available', 'partial', 'not-available'],
    optionStatus: { available: 'pass', partial: 'marginal', 'not-available': 'fail' },
    metric: 'Is there an existing drop or an in-building riser?',
    threshold: 'Pass when a drop is already available',
    critical: false,
    guidance:
      'A new civil-work drop is a cost and a lead time. Flag partial availability so the commercial team can quote the extra work before activation.',
  },
  {
    key: 'power',
    label: 'Power Availability at Premises',
    type: 'select',
    options: ['available', 'unstable', 'not-available'],
    optionStatus: { available: 'pass', unstable: 'marginal', 'not-available': 'fail' },
    metric: 'Is there a grounded mains point for the ONT and router?',
    threshold: 'Pass when a stable grounded supply is present',
    critical: true,
    guidance:
      'Without power the ONT cannot be commissioned. The customer must confirm a supply before an installation slot is booked.',
  },
  {
    key: 'exchange-capacity',
    label: 'Exchange / Cabinet Port Availability',
    type: 'select',
    options: ['available', 'limited', 'unavailable'],
    optionStatus: { available: 'pass', limited: 'marginal', unavailable: 'fail' },
    metric: 'Free PON port and rack space at the serving exchange',
    threshold: 'Pass when a free port and rack space exist',
    critical: true,
    guidance:
      'The exchange port is the last bottleneck. An unavailable port means the lead must wait for a network build, not for a survey.',
  },
  {
    key: 'site-access',
    label: 'Site Access & Terrain',
    type: 'select',
    options: ['easy', 'moderate', 'difficult', 'inaccessible'],
    optionStatus: { easy: 'pass', moderate: 'pass', difficult: 'marginal', inaccessible: 'fail' },
    metric: 'How hard is it to reach and terminate the drop',
    threshold: 'Pass at easy or moderate access',
    critical: false,
    guidance:
      'Difficult access (high rise, dense city, long rural span) changes the installation cost and the time on site. Flag it early so the quote matches reality.',
  },
  {
    key: 'right-of-way',
    label: 'Right of Way & Cable Route',
    type: 'select',
    options: ['clear', 'permission-required', 'obstructed'],
    optionStatus: { clear: 'pass', 'permission-required': 'marginal', obstructed: 'fail' },
    metric: 'Can the cable be run from the distribution point',
    threshold: 'Pass when the route is clear',
    critical: false,
    guidance:
      'A route that needs third-party permission will delay activation regardless of how good the signal is. Record the permission owner in the note.',
  },
  {
    key: 'address-verification',
    label: 'Address & Geo Verification',
    type: 'select',
    options: ['verified', 'unverified', 'mismatch'],
    optionStatus: { verified: 'pass', unverified: 'marginal', mismatch: 'fail' },
    metric: 'Does the address match the network coverage record',
    threshold: 'Pass when the address is verified',
    critical: false,
    guidance:
      'A mismatch usually means the lead was quoted for a different building. Correct the address before the survey so the crew does not waste a visit.',
  },
];

export const LEAD_CHECK_KEYS = LEAD_CHECK_CATALOG.map((c) => c.key);

const leadCheckSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    type: { type: String, enum: ['numeric', 'select'], default: 'select' },
    unit: { type: String, trim: true, default: '' },
    // Display-only prefix for readings that are stored as a bare number but
    // shown with a label, e.g. a split ratio stored as 8 and shown as 1:8.
    valuePrefix: { type: String, trim: true, default: '' },
    options: { type: [String], default: [] },
    threshold: { type: String, trim: true, default: '' },
    guidance: { type: String, trim: true, default: '' },
    critical: { type: Boolean, default: false },
    status: {
      type: String,
      enum: LEAD_CHECK_STATUSES,
      default: 'pending',
    },
    // The measured reading, kept as a string so both "-28.5 dBm" and
    // "1:8" can be stored without a second field.
    value: { type: String, trim: true, default: '' },
    note: { type: String, trim: true, default: '', maxlength: 500 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedAt: { type: Date, default: null },
  },
  { _id: false }
);

const leadSchema = new mongoose.Schema(
  {
    referenceNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    customerName: {
      type: String,
      required: [true, 'Customer name is required'],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Contact number is required'],
      trim: true,
    },
    email: { type: String, trim: true, lowercase: true, default: '' },
    nic: { type: String, trim: true, uppercase: true, default: '' },
    address: {
      type: String,
      required: [true, 'Installation address is required'],
      trim: true,
    },
    district: { type: String, trim: true, default: '' },
    landmark: { type: String, trim: true, default: '', maxlength: 300 },
    location: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    packageName: { type: String, trim: true, default: '' },
    speed: { type: String, trim: true, default: '' },
    technology: {
      type: String,
      enum: LEAD_TECHNOLOGIES,
      default: 'FTTH',
    },
    source: {
      type: String,
      enum: LEAD_SOURCES,
      default: 'portal',
    },
    // The EasyApply application this lead came from, when it came from one.
    applicationRef: { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: LEAD_STATUSES,
      default: 'new',
    },
    riskLevel: {
      type: String,
      enum: LEAD_RISK_LEVELS,
      default: 'none',
    },
    // Labels of the critical checks that failed — the concrete reasons this
    // service would be disrupted for the customer.
    blockingIssues: { type: [String], default: [] },
    checks: { type: [leadCheckSchema], default: [] },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    surveyDate: { type: Date, default: null },
    resolution: {
      type: String,
      enum: [...LEAD_RESOLUTIONS, null],
      default: null,
    },
    resolutionNote: {
      type: String,
      trim: true,
      default: '',
      maxlength: 2000,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolvedAt: { type: Date, default: null },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 2000,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

leadSchema.index({ status: 1, createdAt: -1 });
leadSchema.index({ riskLevel: 1, createdAt: -1 });
leadSchema.index({ assignedTo: 1, status: 1 });
leadSchema.index({ phone: 1 });

const Lead = mongoose.model('Lead', leadSchema);

export default Lead;
