import { isDbConnected } from '../config/db.js';
import NewConnectionDraft, { DRAFT_LIFETIME_MS, DRAFT_STATUS } from '../models/NewConnectionDraft.js';
import { uploadBuffer, getSignedFileUrl, deleteFile } from '../services/storageService.js';

// Wizard fields holding images.
const PHOTO_FIELDS = ['nicFront', 'nicBack', 'facePhoto', 'signature'];
const MAX_STEP_INDEX = 5;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

const dbUnavailable = (res, next) => {
  res.status(503);
  return next(new Error('Draft storage is temporarily unavailable'));
};

/** Store a base64 data URL in central storage and return the URL and key. */
const storePhoto = async (dataUrl, field, phone) => {
  const [meta, base64] = dataUrl.split(',');
  if (!base64) throw new Error(`${field} is not a valid image`);

  const contentType = (meta.match(/data:(image\/[a-zA-Z+]+);/) || [])[1] || 'image/jpeg';
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw new Error(`${field} exceeds the 5MB limit`);
  }

  const uploaded = await uploadBuffer({
    buffer,
    originalname: `draft-${field}-${phone}.jpg`,
    mimetype: contentType,
    folder: 'drafts',
  });

  return uploaded.url || uploaded.key;
};

const isPastResumeLimit = (draft) =>
  Boolean(draft?.resumeUntil) && new Date(draft.resumeUntil).getTime() <= Date.now();

const markExpired = async (draft) => {
  draft.status = DRAFT_STATUS.EXPIRED;
  draft.expiredAt = new Date();
  return await draft.save();
};

const loadActiveDraft = async (phone) => {
  const draft = await NewConnectionDraft.findOne({ phone, status: DRAFT_STATUS.ACTIVE });
  if (draft && isPastResumeLimit(draft)) {
    await markExpired(draft);
    return { draft: null, expiredDraft: draft };
  }
  return { draft, expiredDraft: null };
};

const expiredClientDraft = async (phone, draftId) => {
  if (!draftId) return null;
  const draft = await NewConnectionDraft.findOne({ id: draftId, phone });
  if (!draft) return null;
  if (draft.status === DRAFT_STATUS.EXPIRED) return draft;
  if (isPastResumeLimit(draft)) {
    await markExpired(draft);
    return draft;
  }
  return null;
};

const draftExpiredResponse = (res, draft) =>
  res.status(410).json({
    success: false,
    expired: true,
    expiredOn: draft.resumeUntil,
    message: 'This application passed its 30-day limit and can no longer be continued. Please start a new application.',
  });

const upsertDraft = async (phone, fields) => {
  let draft = await NewConnectionDraft.findOne({ phone, status: DRAFT_STATUS.ACTIVE });
  if (draft) {
    Object.assign(draft, fields);
    return await draft.save();
  }
  return await NewConnectionDraft.create({
    phone,
    status: DRAFT_STATUS.ACTIVE,
    ...fields,
  });
};

export const getDraft = async (req, res, next) => {
  if (!isDbConnected()) return dbUnavailable(res, next);

  try {
    const serverTime = new Date();
    const { draft, expiredDraft } = await loadActiveDraft(req.draftPhone);

    if (!draft) {
      const lastExpired = expiredDraft
        || await NewConnectionDraft.findOne({ phone: req.draftPhone, status: DRAFT_STATUS.EXPIRED });
      return res.status(200).json({
        success: true,
        draft: null,
        expired: lastExpired ? { id: lastExpired.id || lastExpired._id, expiredOn: lastExpired.resumeUntil } : null,
        serverTime,
      });
    }

    if (req.query.summary === 'true') {
      return res.status(200).json({
        success: true,
        draft: {
          id: draft.id || draft._id,
          stepIndex: draft.stepIndex,
          selectedProduct: draft.selectedProduct,
          updatedAt: draft.updatedAt,
          resumeUntil: draft.resumeUntil,
        },
        serverTime,
      });
    }

    const formData = { ...draft.formData };
    PHOTO_FIELDS.forEach((field) => {
      const photo = draft.photos?.[field];
      if (photo?.ref || photo?.url) {
        formData[field] = photo.ref || photo.url;
      }
    });

    res.status(200).json({
      success: true,
      draft: {
        id: draft.id || draft._id,
        formData,
        selectedProduct: draft.selectedProduct,
        stepIndex: draft.stepIndex,
        updatedAt: draft.updatedAt,
        resumeUntil: draft.resumeUntil,
      },
      serverTime,
    });
  } catch (error) {
    next(error);
  }
};

export const saveDraft = async (req, res, next) => {
  if (!isDbConnected()) return dbUnavailable(res, next);

  const { formData, selectedProduct = null, stepIndex = 0, draftId } = req.body || {};

  if (!formData || typeof formData !== 'object' || Array.isArray(formData)) {
    res.status(400);
    return next(new Error('formData object is required'));
  }

  try {
    const phone = req.draftPhone;

    const staleDraft = await expiredClientDraft(phone, draftId);
    if (staleDraft) return draftExpiredResponse(res, staleDraft);
    const { expiredDraft } = await loadActiveDraft(phone);
    if (expiredDraft) return draftExpiredResponse(res, expiredDraft);

    const cleanForm = { ...formData };
    PHOTO_FIELDS.forEach((field) => delete cleanForm[field]);

    const safeStep = Math.min(Math.max(Number.parseInt(stepIndex, 10) || 0, 0), MAX_STEP_INDEX);

    const draft = await upsertDraft(phone, {
      formData: cleanForm,
      selectedProduct,
      stepIndex: safeStep,
    });

    res.status(200).json({
      success: true,
      draft: {
        id: draft.id || draft._id,
        stepIndex: draft.stepIndex,
        updatedAt: draft.updatedAt,
        resumeUntil: draft.resumeUntil,
      },
      serverTime: new Date(),
    });
  } catch (error) {
    next(error);
  }
};

export const saveDraftPhoto = async (req, res, next) => {
  if (!isDbConnected()) return dbUnavailable(res, next);

  const { field } = req.params;
  if (!PHOTO_FIELDS.includes(field)) {
    res.status(400);
    return next(new Error('Unknown photo'));
  }

  const image = typeof req.body?.image === 'string' ? req.body.image.trim() : '';
  const draftId = req.body?.draftId || req.query.draftId;
  const phone = req.draftPhone;

  try {
    const staleDraft = await expiredClientDraft(phone, draftId);
    if (staleDraft) return draftExpiredResponse(res, staleDraft);
    const { draft: existing, expiredDraft } = await loadActiveDraft(phone);
    if (expiredDraft) return draftExpiredResponse(res, expiredDraft);

    if (!existing && !image) {
      return res.status(200).json({ success: true, draft: null, serverTime: new Date() });
    }

    const photos = { ...(existing?.photos || {}) };

    if (image.startsWith('data:image/')) {
      const url = await storePhoto(image, field, phone);
      photos[field] = { ref: url, url };
    } else if (image) {
      photos[field] = { ref: image, url: image };
    } else {
      delete photos[field];
    }

    const draft = await upsertDraft(phone, { photos });

    res.status(200).json({
      success: true,
      draft: { id: draft.id || draft._id, resumeUntil: draft.resumeUntil },
      serverTime: new Date(),
    });
  } catch (error) {
    if (/exceeds the 5MB limit|not a valid image/.test(error.message)) res.status(400);
    next(error);
  }
};

export const removeDraftPhoto = (req, res, next) => {
  req.body = { image: '', draftId: req.query.draftId };
  return saveDraftPhoto(req, res, next);
};

export const deleteDraft = async (req, res, next) => {
  if (!isDbConnected()) return dbUnavailable(res, next);

  try {
    const draft = await NewConnectionDraft.findOne({ phone: req.draftPhone, status: DRAFT_STATUS.ACTIVE });
    if (draft) {
      await NewConnectionDraft.findByIdAndDelete(draft.id || draft._id);
    }

    res.status(200).json({ success: true, message: 'Draft deleted' });
  } catch (error) {
    next(error);
  }
};

export default {
  getDraft,
  saveDraft,
  saveDraftPhoto,
  removeDraftPhoto,
  deleteDraft,
};
