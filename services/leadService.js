import Lead from '../models/Lead.js';
import {
  LEAD_CHECK_CATALOG,
  LEAD_CHECK_KEYS,
  LEAD_CHECK_STATUSES,
  LEAD_STATUSES,
} from '../models/Lead.js';

// ── Serviceability rules ─────────────────────────────────────────────────
// Everything that turns a pile of survey readings into a decision: how risky
// a lead is, which checks are blocking it, and which status it should land
// in. Kept in one place so the API and the seed script agree.

// Builds the blank checklist every new lead starts with.
export const buildChecklist = () =>
  LEAD_CHECK_CATALOG.map((entry) => ({
    key: entry.key,
    label: entry.label,
    type: entry.type,
    unit: entry.unit || '',
    valuePrefix: entry.valuePrefix || '',
    options: entry.options || [],
    threshold: entry.threshold || '',
    guidance: entry.guidance || '',
    critical: !!entry.critical,
    status: 'pending',
    value: '',
    note: '',
    updatedBy: null,
    updatedAt: null,
  }));
// Where a lead sits in the funnel, used by the tabs on the Lead Management
// screen. A lead can belong to more than one group at a time.
export const LEAD_GROUPS = {
  all: () => true,
  triage: (lead) => ['new', 'survey-scheduled', 'survey-in-progress', 'survey-completed'].includes(lead.status),
  atRisk: (lead) => lead.riskLevel === 'high' || lead.riskLevel === 'critical' || lead.status === 'not-feasible',
  awaitingSurvey: (lead) => ['new', 'survey-scheduled', 'survey-in-progress'].includes(lead.status),
  qualified: (lead) => ['qualified', 'approved', 'converted'].includes(lead.status),
  closed: (lead) => ['converted', 'on-hold'].includes(lead.status),
};

// Works out the risk band and the blocking issues from the recorded checks.
// A failed critical check is what makes the service unserviceable; the rest
// raise the risk band so they surface for review instead of passing silently.
export const evaluateChecks = (checks = []) => {
  let criticalFails = 0;
  let criticalMarginals = 0;
  let otherFails = 0;
  let otherMarginals = 0;
  let pending = 0;
  let passed = 0;

  const blockingIssues = [];

  for (const check of checks) {
    if (check.status === 'pending') {
      pending += 1;
      continue;
    }
    if (check.status === 'pass' || check.status === 'waived' || check.status === 'na') {
      passed += 1;
      continue;
    }
    if (check.status === 'marginal') {
      if (check.critical) criticalMarginals += 1;
      else otherMarginals += 1;
      continue;
    }
    if (check.status === 'fail') {
      if (check.critical) {
        criticalFails += 1;
        blockingIssues.push(check.label);
      } else {
        otherFails += 1;
      }
    }
  }

  let riskLevel = 'none';
  if (criticalFails > 0) riskLevel = 'critical';
  else if (criticalMarginals > 0) riskLevel = 'high';
  else if (otherFails >= 3) riskLevel = 'high';
  else if (otherFails >= 1 || otherMarginals >= 3) riskLevel = 'medium';
  else if (otherMarginals >= 1) riskLevel = 'low';

  const total = checks.length;
  const recorded = total - pending;
  const failed = criticalFails + otherFails;
  const marginal = criticalMarginals + otherMarginals;

  return {
    riskLevel,
    blockingIssues,
    pending,
    passed,
    total,
    recorded,
    failed,
    marginal,
    criticalFails,
    // Every criterion has been measured and nothing critical failed.
    surveyComplete: total > 0 && pending === 0,
    serviceable: criticalFails === 0 && pending === 0,
    // Passed, but only because something was waived or came out marginal.
    conditional: criticalFails === 0 && (criticalMarginals + otherMarginals) > 0,
  };
};

// The status a lead should move to given its readings. Only used as a
// suggestion — an officer always has the final say.
export const suggestStatus = (evaluation, currentStatus) => {
  if (['converted', 'on-hold', 'approved'].includes(currentStatus)) return currentStatus;
  if (!evaluation.surveyComplete) {
    if (currentStatus === 'new') return 'survey-scheduled';
    return currentStatus;
  }
  if (evaluation.criticalFails > 0) return 'not-feasible';
  if (evaluation.conditional) return 'conditional';
  return 'qualified';
};

// Applies the evaluation to a lead document and saves it.
export const refreshLead = async (lead) => {
  const evaluation = evaluateChecks(lead.checks || []);
  lead.riskLevel = evaluation.riskLevel;
  lead.blockingIssues = evaluation.blockingIssues;
  await lead.save();
  return { lead, evaluation };
};

// Normalises a raw reading into a number where the check is numeric.
export const parseNumeric = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const cleaned = String(value).replace(/[^0-9.+-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '+') return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
};

// Does a numeric reading meet the check's threshold? `null` means the reading
// could not be parsed, which is never a pass.
export const rateNumeric = (entry, rawValue) => {
  const num = parseNumeric(rawValue);
  if (num === null) return null;
  const { direction, good, warn } = entry.scale || {};
  if (direction === 'above') {
    if (num >= good) return 'pass';
    if (num >= warn) return 'marginal';
    return 'fail';
  }
  if (num <= good) return 'pass';
  if (num <= warn) return 'marginal';
  return 'fail';
};

// Does a picked option meet the check's threshold? The catalogue maps each
// option to the result it implies.
export const rateSelect = (entry, rawValue) => {
  const value = String(rawValue || '').trim();
  if (!value) return null;
  const map = entry.optionStatus || {};
  return map[value] || null;
};

// Rates a reading of any type against its catalogue entry.
export const rateCheck = (entry, rawValue) => {
  if (!entry) return null;
  if (entry.type === 'numeric') return rateNumeric(entry, rawValue);
  return rateSelect(entry, rawValue);
};

// Merges a submitted set of check results into the lead's checklist,
// preserving any check the submission did not mention.
export const mergeChecks = (existing = [], incoming = []) => {
  const byKey = new Map(existing.map((c) => [c.key, c]));
  const catalog = new Map(LEAD_CHECK_CATALOG.map((c) => [c.key, c]));

  for (const patch of incoming) {
    const key = String(patch.key || '').trim();
    if (!LEAD_CHECK_KEYS.includes(key)) continue;

    const current = byKey.get(key) || {
      ...catalog.get(key),
      status: 'pending',
      value: '',
      note: '',
    };

    const next = { ...current };

    if (patch.status !== undefined) {
      const status = String(patch.status).toLowerCase();
      if (!LEAD_CHECK_STATUSES.includes(status)) continue;
      next.status = status;
    }

    if (patch.value !== undefined) next.value = String(patch.value).trim();
    if (patch.note !== undefined) next.note = String(patch.note).trim();

    // A reading without an explicit status is rated automatically, so the
    // technician does not have to judge the threshold themselves.
    if (patch.status === undefined && patch.value !== undefined) {
      const rated = rateCheck(catalog.get(key), next.value);
      if (rated) next.status = rated;
    }

    byKey.set(key, next);
  }

  // Keep the catalogue order so the checklist always reads the same way.
  return LEAD_CHECK_CATALOG.map((entry) => byKey.get(entry.key)).filter(Boolean);
};

// Generates a unique lead reference, e.g. LEAD-48219374.
export const generateReference = async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const digits = Math.floor(10000000 + Math.random() * 90000000).toString();
    const reference = `LEAD-${digits}`;
    const existing = await Lead.findOne({ referenceNumber: reference }).select('_id').lean();
    if (!existing) return reference;
  }
  return `LEAD-${Date.now()}`;
};

// Shape a lead for the API. The checklist is returned in full — it is only
// nine entries and the UI renders all of them.
export const sanitizeLead = (lead) => {
  const evaluation = evaluateChecks(lead.checks || []);
  return {
    id: lead._id,
    referenceNumber: lead.referenceNumber,
    customerName: lead.customerName,
    phone: lead.phone,
    email: lead.email || '',
    nic: lead.nic || '',
    address: lead.address,
    district: lead.district || '',
    landmark: lead.landmark || '',
    location: lead.location || {},
    packageName: lead.packageName || '',
    speed: lead.speed || '',
    technology: lead.technology,
    source: lead.source,
    applicationRef: lead.applicationRef || '',
    status: lead.status,
    riskLevel: lead.riskLevel,
    blockingIssues: lead.blockingIssues || [],
    checks: (lead.checks || []).map((c) => ({
      key: c.key,
      label: c.label,
      type: c.type,
      unit: c.unit || '',
      valuePrefix: c.valuePrefix || '',
      options: c.options || [],
      threshold: c.threshold || '',
      guidance: c.guidance || '',
      critical: !!c.critical,
      status: c.status,
      value: c.value || '',
      note: c.note || '',
      updatedBy: c.updatedBy?._id || c.updatedBy || null,
      updatedByName: c.updatedBy?.name || null,
      updatedAt: c.updatedAt || null,
    })),
    assignedTo: lead.assignedTo?._id || lead.assignedTo || null,
    assignedToName: lead.assignedTo?.name || null,
    surveyDate: lead.surveyDate || null,
    resolution: lead.resolution || null,
    resolutionNote: lead.resolutionNote || '',
    resolvedBy: lead.resolvedBy?._id || lead.resolvedBy || null,
    resolvedByName: lead.resolvedBy?.name || null,
    resolvedAt: lead.resolvedAt || null,
    notes: lead.notes || '',
    createdBy: lead.createdBy?._id || lead.createdBy || null,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    evaluation,
  };
};

export { LEAD_STATUSES, LEAD_CHECK_STATUSES };
