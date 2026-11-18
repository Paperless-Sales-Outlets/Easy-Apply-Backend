import { isDbConnected } from '../config/db.js';
import NewConnectionDraft, {
  DRAFT_STATUS,
  DRAFT_PHOTO_FIELDS as PHOTO_FIELDS,
  draftPhotoRefs,
} from '../models/NewConnectionDraft.js';
import { uploadBuffer, getSignedFileUrl, deleteFile } from '../services/storageService.js';
import { deleteDraftPhotoFiles } from '../services/draftExpiryService.js';

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

// Drafts never expire: the customer's saved progress is kept until they
// submit the application or discard the draft.
const loadActiveDraft = (phone) =>
  NewConnectionDraft.findOne({ phone, status: DRAFT_STATUS.ACTIVE });

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
    const draft = await loadActiveDraft(req.draftPhone);

    if (!draft) {
      return res.status(200).json({ success: true, draft: null, serverTime });
    }

    if (req.query.summary === 'true') {
      return res.status(200).json({
        success: true,
        draft: {
          id: draft.id || draft._id,
          stepIndex: draft.stepIndex,
          selectedProduct: draft.selectedProduct,
          updatedAt: draft.updatedAt,
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
      },
      serverTime,
    });
  } catch (error) {
    next(error);
  }
};

export const saveDraft = async (req, res, next) => {
  if (!isDbConnected()) return dbUnavailable(res, next);

  const { formData, selectedProduct = null, stepIndex = 0 } = req.body || {};

  if (!formData || typeof formData !== 'object' || Array.isArray(formData)) {
    res.status(400);
    return next(new Error('formData object is required'));
  }

  try {
    const phone = req.draftPhone;

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
  const phone = req.draftPhone;

  try {
    const existing = await loadActiveDraft(phone);

    if (!existing && !image) {
      return res.status(200).json({ success: true, draft: null, serverTime: new Date() });
    }

    const photos = { ...(existing?.photos || {}) };
    const oldRef = photos[field]?.ref || photos[field]?.url || null;

    if (image.startsWith('data:image/')) {
      const url = await storePhoto(image, field, phone);
      photos[field] = { ref: url, url };
    } else if (image) {
      photos[field] = { ref: image, url: image };
    } else {
      delete photos[field];
    }

    const draft = await upsertDraft(phone, { photos });

    // Replaced or removed: delete the old file only after the draft no longer
    // points at it.
    if (oldRef && oldRef !== photos[field]?.ref) {
      await deleteDraftPhotoFiles([oldRef]);
    }

    res.status(200).json({
      success: true,
      draft: { id: draft.id || draft._id },
      serverTime: new Date(),
    });
  } catch (error) {
    if (/exceeds the 5MB limit|not a valid image/.test(error.message)) res.status(400);
    next(error);
  }
};

export const removeDraftPhoto = (req, res, next) => {
  req.body = { image: '' };
  return saveDraftPhoto(req, res, next);
};

export const deleteDraft = async (req, res, next) => {
  if (!isDbConnected()) return dbUnavailable(res, next);

  try {
    const draft = await NewConnectionDraft.findOne({ phone: req.draftPhone, status: DRAFT_STATUS.ACTIVE });
    if (draft) {
      await NewConnectionDraft.findByIdAndDelete(draft.id || draft._id);
      // Files a just-submitted application reuses are kept (see deleteDraftPhotoFiles).
      await deleteDraftPhotoFiles(draftPhotoRefs(draft.photos));
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
