import Lead from '../../models/Lead.js';
import {
  LEAD_CHECK_CATALOG,
  LEAD_RESOLUTIONS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  LEAD_TECHNOLOGIES,
} from '../../models/Lead.js';
import {
  buildChecklist,
  generateReference,
  mergeChecks,
  refreshLead,
  sanitizeLead,
  suggestStatus,
} from '../../services/leadService.js';
import { recordAudit } from '../../services/auditService.js';

// @desc    The serviceability check catalogue — every reason a new connection
//          can be blocked, with the thresholds a survey is measured against
// @route   GET /api/admin/leads/check-catalog
// @access  Private (Admin/Staff)
export const getLeadCheckCatalog = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      checks: LEAD_CHECK_CATALOG,
      statuses: LEAD_STATUSES,
      resolutions: LEAD_RESOLUTIONS,
      sources: LEAD_SOURCES,
      technologies: LEAD_TECHNOLOGIES,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    A single lead with its full survey record
// @route   GET /api/admin/leads/:id
// @access  Private (Admin/Staff)
export const getLeadById = async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id)
      .populate('assignedTo', 'name email role')
      .populate('createdBy', 'name role')
      .lean();

    if (!lead) {
      res.status(404);
      return next(new Error('Lead not found'));
    }

    res.status(200).json({ success: true, lead: sanitizeLead(lead) });
  } catch (error) {
    next(error);
  }
};

// @desc    Capture a new lead and open its serviceability checklist
// @route   POST /api/admin/leads
// @access  Private (Admin/Staff)
export const createLead = async (req, res, next) => {
  try {
    const {
      customerName,
      phone,
      email,
      nic,
      address,
      district,
      landmark,
      packageName,
      speed,
      technology,
      source,
      applicationRef,
      notes,
    } = req.body;

    if (!customerName || !String(customerName).trim()) {
      res.status(400);
      return next(new Error('Customer name is required'));
    }
    if (!phone || !String(phone).trim()) {
      res.status(400);
      return next(new Error('Contact number is required'));
    }
    if (!address || !String(address).trim()) {
      res.status(400);
      return next(new Error('Installation address is required'));
    }

    const referenceNumber = await generateReference();

    const lead = await Lead.create({
      referenceNumber,
      customerName: String(customerName).trim(),
      phone: String(phone).trim(),
      email: email ? String(email).trim().toLowerCase() : '',
      nic: nic ? String(nic).trim().toUpperCase() : '',
      address: String(address).trim(),
      district: district ? String(district).trim() : '',
      landmark: landmark ? String(landmark).trim() : '',
      packageName: packageName ? String(packageName).trim() : '',
      speed: speed ? String(speed).trim() : '',
      technology: technology || 'FTTH',
      source: source || 'portal',
      applicationRef: applicationRef ? String(applicationRef).trim() : '',
      notes: notes ? String(notes).trim() : '',
      status: 'new',
      checks: buildChecklist(),
      createdBy: req.user?._id,
    });

    await recordAudit({
      req,
      action: 'CREATE',
      module: 'Lead Management',
      targetId: lead._id,
      description: `Captured lead ${lead.referenceNumber} for ${lead.customerName}`,
      metadata: { packageName: lead.packageName, source: lead.source, technology: lead.technology },
    });

    res.status(201).json({ success: true, lead: sanitizeLead(lead) });
  } catch (error) {
    if (error.code === 11000) {
      res.status(409);
      return next(new Error('A lead with this reference already exists'));
    }
    next(error);
  }
};

// @desc    Update a lead's details, status, assignment or notes
// @route   PATCH /api/admin/leads/:id
// @access  Private (Admin/Staff)
export const updateLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      customerName,
      phone,
      email,
      nic,
      address,
      district,
      landmark,
      packageName,
      speed,
      technology,
      source,
      applicationRef,
      status,
      assignedTo,
      surveyDate,
      notes,
    } = req.body;

    const lead = await Lead.findById(id);
    if (!lead) {
      res.status(404);
      return next(new Error('Lead not found'));
    }

    if (status !== undefined) {
      const cleanStatus = String(status).trim().toLowerCase();
      if (!LEAD_STATUSES.includes(cleanStatus)) {
        res.status(400);
        return next(new Error(`Invalid status. Must be one of: ${LEAD_STATUSES.join(', ')}`));
      }
      lead.status = cleanStatus;
    }

    if (assignedTo !== undefined) {
      lead.assignedTo = assignedTo || null;
    }

    if (surveyDate !== undefined) {
      lead.surveyDate = surveyDate ? new Date(surveyDate) : null;
    }

    const stringFields = {
      customerName, phone, email, nic, address, district, landmark,
      packageName, speed, applicationRef, notes,
    };

    for (const [field, value] of Object.entries(stringFields)) {
      if (value === undefined) continue;
      let clean = String(value).trim();
      if (field === 'email') clean = clean.toLowerCase();
      if (field === 'nic') clean = clean.toUpperCase();
      lead[field] = clean;
    }

    if (technology !== undefined) {
      if (!LEAD_TECHNOLOGIES.includes(technology)) {
        res.status(400);
        return next(new Error(`Invalid technology. Must be one of: ${LEAD_TECHNOLOGIES.join(', ')}`));
      }
      lead.technology = technology;
    }

    if (source !== undefined) {
      if (!LEAD_SOURCES.includes(source)) {
        res.status(400);
        return next(new Error(`Invalid source. Must be one of: ${LEAD_SOURCES.join(', ')}`));
      }
      lead.source = source;
    }

    await lead.save();

    await recordAudit({
      req,
      action: 'UPDATE',
      module: 'Lead Management',
      targetId: lead._id,
      description: `Updated lead ${lead.referenceNumber}`,
      metadata: { status: lead.status, assignedTo: lead.assignedTo },
    });

    const populated = await Lead.findById(lead._id).populate('assignedTo', 'name email role').lean();

    res.status(200).json({ success: true, lead: sanitizeLead(populated) });
  } catch (error) {
    next(error);
  }
};

// @desc    Record the site survey results for a lead. Sending a reading for a
//          numeric check rates it against the catalogue threshold.
// @route   PATCH /api/admin/leads/:id/checks
// @access  Private (Admin/Staff)
export const updateLeadChecks = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { checks } = req.body;

    if (!Array.isArray(checks)) {
      res.status(400);
      return next(new Error('A list of check results is required'));
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      res.status(404);
      return next(new Error('Lead not found'));
    }

    lead.checks = mergeChecks(lead.checks || [], checks);
    lead.checks.forEach((check) => {
      check.updatedBy = req.user?._id || null;
      check.updatedAt = new Date();
    });

    const { evaluation } = await refreshLead(lead);

    // Move the lead along the funnel automatically once the survey is in,
    // unless an officer has already taken it further.
    if (['new', 'survey-scheduled', 'survey-in-progress', 'survey-completed'].includes(lead.status)) {
      const suggested = suggestStatus(evaluation, lead.status);
      if (suggested !== lead.status) {
        lead.status = suggested;
        await lead.save();
      }
    }

    await recordAudit({
      req,
      action: 'UPDATE',
      module: 'Lead Management',
      targetId: lead._id,
      description: `Recorded survey results for lead ${lead.referenceNumber} — risk ${lead.riskLevel}`,
      metadata: {
        riskLevel: lead.riskLevel,
        blockingIssues: lead.blockingIssues,
        failed: evaluation.failed,
        marginal: evaluation.marginal,
      },
    });

    const populated = await Lead.findById(lead._id).populate('assignedTo', 'name email role').lean();

    res.status(200).json({ success: true, lead: sanitizeLead(populated) });
  } catch (error) {
    next(error);
  }
};

// @desc    Decide what happens to a lead that cannot be served as surveyed
// @route   PATCH /api/admin/leads/:id/resolve
// @access  Private (Admin/Staff)
export const resolveLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { resolution, note, status } = req.body;

    if (!resolution || !LEAD_RESOLUTIONS.includes(resolution)) {
      res.status(400);
      return next(new Error(`A valid resolution is required. Must be one of: ${LEAD_RESOLUTIONS.join(', ')}`));
    }

    const lead = await Lead.findById(id);
    if (!lead) {
      res.status(404);
      return next(new Error('Lead not found'));
    }

    lead.resolution = resolution;
    lead.resolutionNote = note ? String(note).trim() : '';
    lead.resolvedBy = req.user?._id || null;
    lead.resolvedAt = new Date();

    if (status) {
      const cleanStatus = String(status).trim().toLowerCase();
      if (!LEAD_STATUSES.includes(cleanStatus)) {
        res.status(400);
        return next(new Error(`Invalid status. Must be one of: ${LEAD_STATUSES.join(', ')}`));
      }
      lead.status = cleanStatus;
    } else if (resolution === 'rejected') {
      lead.status = 'not-feasible';
    } else if (resolution === 'resurvey') {
      lead.status = 'survey-scheduled';
    } else if (resolution === 'waived') {
      lead.status = 'qualified';
    }

    await lead.save();

    await recordAudit({
      req,
      action: 'STATUS_UPDATE',
      module: 'Lead Management',
      targetId: lead._id,
      description: `Resolved lead ${lead.referenceNumber} as ${resolution}`,
      metadata: { resolution, status: lead.status, note: lead.resolutionNote },
    });

    const populated = await Lead.findById(lead._id).populate('assignedTo', 'name email role').lean();

    res.status(200).json({ success: true, lead: sanitizeLead(populated) });
  } catch (error) {
    next(error);
  }
};

// @desc    Remove a lead
// @route   DELETE /api/admin/leads/:id
// @access  Private (Admin)
export const deleteLead = async (req, res, next) => {
  try {
    const { id } = req.params;

    const lead = await Lead.findById(id);
    if (!lead) {
      res.status(404);
      return next(new Error('Lead not found'));
    }

    await Lead.findByIdAndDelete(id);

    await recordAudit({
      req,
      action: 'DELETE',
      module: 'Lead Management',
      targetId: id,
      description: `Deleted lead ${lead.referenceNumber}`,
    });

    res.status(200).json({ success: true, message: 'Lead removed' });
  } catch (error) {
    next(error);
  }
};

// @desc    Recalculate risk and blocking issues without editing anything
// @route   POST /api/admin/leads/:id/recalculate
// @access  Private (Admin/Staff)
export const recalculateLead = async (req, res, next) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
      res.status(404);
      return next(new Error('Lead not found'));
    }

    const { evaluation } = await refreshLead(lead);
    const populated = await Lead.findById(lead._id).populate('assignedTo', 'name email role').lean();

    res.status(200).json({ success: true, lead: sanitizeLead(populated), evaluation });
  } catch (error) {
    next(error);
  }
};
