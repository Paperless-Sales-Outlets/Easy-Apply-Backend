import NewConnectionDraft, { DRAFT_STATUS } from '../../models/NewConnectionDraft.js';
import { downloadBuffer } from '../../services/storageService.js';
import { sniffImageType } from '../../services/kycIdentityImages.js';

const PHOTO_FIELDS = ['nicFront', 'nicBack', 'facePhoto'];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STEP_DEFS = [
  { key: 'location', label: 'Customer & Location' },
  { key: 'loop', label: 'Fibre Availability' },
  { key: 'identity', label: 'Identity & KYC' },
  { key: 'signature', label: 'Declaration & Signature' },
  { key: 'payment', label: 'Payment' },
  { key: 'review', label: 'Review & Submit' },
];

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const escapeOr = (value) => new RegExp(escapeRegex(String(value).trim()), 'i');

const asText = (value) => (typeof value === 'string' ? value.trim() : '');

const formDataOf = (draft) =>
  draft?.formData && typeof draft.formData === 'object' && !Array.isArray(draft.formData)
    ? draft.formData
    : {};

const productOf = (draft) =>
  draft?.selectedProduct && typeof draft.selectedProduct === 'object' ? draft.selectedProduct : {};

const productNameOf = (draft) => {
  const product = productOf(draft);
  return asText(product.productName) || asText(product.name);
};

const stepIndexOf = (draft) =>
  Math.min(Math.max(Number.parseInt(draft?.stepIndex, 10) || 0, 0), STEP_DEFS.length - 1);

const isPastDue = (draft) =>
  Boolean(draft?.resumeUntil) && new Date(draft.resumeUntil).getTime() <= Date.now();

const draftReference = (draft) =>
  `DRAFT-${String(draft._id).slice(-8).toUpperCase()}`;

const customerNameOf = (draft) => {
  const form = formDataOf(draft);
  return asText(form.nameFull)
    || asText(form.fullName)
    || asText(form.customerName)
    || 'Unnamed customer';
};

const addressOf = (draft) => {
  const form = formDataOf(draft);
  return asText(form.installAddress)
    || asText(form.address)
    || [asText(form.city), asText(form.district)].filter(Boolean).join(', ');
};

const reasonOf = (draft) => {
  if (draft.status === DRAFT_STATUS.EXPIRED) return 'Expired after the 30-day limit';
  return `Stopped at ${STEP_DEFS[stepIndexOf(draft)].label}`;
};

const sanitizeDraft = (draft) => {
  const form = formDataOf(draft);
  const product = productOf(draft);
  const index = stepIndexOf(draft);
  const step = STEP_DEFS[index];
  const expired = draft.status === DRAFT_STATUS.EXPIRED;

  return {
    id: draft._id,
    referenceNumber: draftReference(draft),
    customerName: customerNameOf(draft),
    phone: draft.phone || asText(form.mobileNumber),
    email: asText(form.email),
    nic: asText(form.nic),
    address: addressOf(draft),
    city: asText(form.city),
    district: asText(form.district),
    packageName: asText(product.productName) || asText(product.name) || asText(form.broadbandPackage) || asText(form.otherBroadbandPackage),
    speed: asText(product.speed),
    monthlyPrice: product.monthlyPrice ?? null,
    installationFee: product.installationFee ?? null,
    technology: asText(product.technology) || 'FTTH',
    status: draft.status,
    isExpired: expired,
    isPastDue: isPastDue(draft),
    stepIndex: index,
    stepKey: step.key,
    stepLabel: step.label,
    stepNumber: index + 1,
    stepCount: STEP_DEFS.length,
    progress: Math.round((index / (STEP_DEFS.length - 1)) * 100),
    hasProduct: Boolean(productNameOf(draft)),
    hasPayment: Boolean(asText(form.paymentReference)) || form.paymentCompleted === true,
    paymentCompleted: form.paymentCompleted === true,
    reason: reasonOf(draft),
    resumeUntil: draft.resumeUntil || null,
    expiredAt: draft.expiredAt || null,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    photos: PHOTO_FIELDS.reduce((acc, field) => {
      acc[field] = Boolean(draft.photos?.[field]?.ref || draft.photos?.[field]?.url);
      return acc;
    }, {}),
  };
};

// Draft photos sit encrypted in central storage, so the browser cannot load the
// stored link directly: decrypt here and hand back a data URL.
const readPhoto = async (ref) => {
  if (ref.startsWith('data:')) return ref;
  try {
    const { buffer } = await downloadBuffer(ref);
    return `data:${sniffImageType(buffer) || 'image/jpeg'};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
};

const loadPhotos = async (draft) => {
  const photos = {};
  await Promise.all(
    PHOTO_FIELDS.map(async (field) => {
      const ref = draft.photos?.[field]?.ref || draft.photos?.[field]?.url;
      if (ref) photos[field] = await readPhoto(ref);
    })
  );
  return photos;
};

export const getDraftLeadStats = async (req, res, next) => {
  try {
    const drafts = await NewConnectionDraft.find({})
      .select('status stepIndex formData selectedProduct resumeUntil expiredAt createdAt updatedAt')
      .lean();

    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const byStep = STEP_DEFS.map((step) => ({ key: step.key, label: step.label, count: 0 }));
    const blocking = {};

    let active = 0;
    let expired = 0;
    let stale = 0;
    let reachedPayment = 0;
    let reachedReview = 0;
    let paidNotSubmitted = 0;
    let withProduct = 0;
    let recent = 0;

    for (const draft of drafts) {
      const index = stepIndexOf(draft);
      const form = formDataOf(draft);
      const isExpired = draft.status === DRAFT_STATUS.EXPIRED;

      if (isExpired) expired += 1;
      else active += 1;

      if (!isExpired && new Date(draft.updatedAt || draft.createdAt).getTime() < weekAgo) stale += 1;
      if (new Date(draft.createdAt).getTime() >= weekAgo) recent += 1;
      if (index >= 4) reachedPayment += 1;
      if (index >= 5) reachedReview += 1;
      if (index >= 5 && (asText(form.paymentReference) || form.paymentCompleted === true)) paidNotSubmitted += 1;
      if (productNameOf(draft)) withProduct += 1;

      byStep[index].count += 1;

      const reason = isExpired ? 'Expired after the 30-day limit' : `Stopped at ${STEP_DEFS[index].label}`;
      blocking[reason] = (blocking[reason] || 0) + 1;
    }

    const blockingIssues = Object.entries(blocking)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

    res.status(200).json({
      success: true,
      stats: {
        total: drafts.length,
        active,
        expired,
        stale,
        recent,
        reachedPayment,
        reachedReview,
        paidNotSubmitted,
        withProduct,
        withoutProduct: drafts.length - withProduct,
        byStep,
        blockingIssues,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getDraftLeads = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      group,
      stage,
      search,
      sortBy = 'updatedAt',
      sortOrder = 'desc',
    } = req.query;

    const conditions = [];

    if (status === DRAFT_STATUS.ACTIVE || status === DRAFT_STATUS.EXPIRED) {
      conditions.push({ status });
    }

    if (group === DRAFT_STATUS.ACTIVE || group === DRAFT_STATUS.EXPIRED) {
      conditions.push({ status: group });
    } else if (group === 'payment') {
      conditions.push({ stepIndex: { $gte: 4 } });
    } else if (group === 'review') {
      conditions.push({ stepIndex: { $gte: 5 } });
    }

    if (stage) {
      const index = STEP_DEFS.findIndex((s) => s.key === stage);
      if (index !== -1) conditions.push({ stepIndex: index });
    }

    if (search && String(search).trim()) {
      const q = escapeOr(search);
      conditions.push({
        $or: [
          { phone: q },
          { 'formData.nameFull': q },
          { 'formData.fullName': q },
          { 'formData.customerName': q },
          { 'formData.nic': q },
          { 'formData.email': q },
          { 'formData.installAddress': q },
          { 'formData.address': q },
          { 'formData.city': q },
          { 'formData.district': q },
          { 'selectedProduct.productName': q },
        ],
      });
    }

    const filter = conditions.length ? { $and: conditions } : {};

    const allowedSortFields = ['createdAt', 'updatedAt', 'resumeUntil', 'stepIndex'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'updatedAt';
    const sortDir = sortOrder === 'asc' ? 1 : -1;

    const pageNum = Math.max(1, Number.parseInt(page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * pageSize;

    const [drafts, totalCount] = await Promise.all([
      NewConnectionDraft.find(filter)
        .sort({ [sortField]: sortDir })
        .skip(skip)
        .limit(pageSize)
        .lean(),
      NewConnectionDraft.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / pageSize);

    res.status(200).json({
      success: true,
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount,
        pageSize,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1,
      },
      filters: {
        status: status || null,
        group: group || null,
        stage: stage || null,
        search: search || null,
      },
      sort: { sortBy: sortField, sortOrder: sortDir === 1 ? 'asc' : 'desc' },
      drafts: drafts.map(sanitizeDraft),
    });
  } catch (error) {
    next(error);
  }
};

export const getDraftLeadById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!UUID_PATTERN.test(id)) {
      res.status(400);
      return next(new Error('Invalid draft id'));
    }

    const draft = await NewConnectionDraft.findById(id).lean();
    if (!draft) {
      res.status(404);
      return next(new Error('Draft not found'));
    }

    const photos = await loadPhotos(draft);
    const formData = { ...formDataOf(draft) };

    PHOTO_FIELDS.forEach((field) => {
      if (photos[field]) formData[field] = photos[field];
    });

    res.status(200).json({
      success: true,
      draft: {
        ...sanitizeDraft(draft),
        formData,
        selectedProduct: productOf(draft),
        photos,
      },
    });
  } catch (error) {
    next(error);
  }
};
