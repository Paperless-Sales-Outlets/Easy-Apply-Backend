import mongoose from 'mongoose';
import NewConnectionDraft, { DRAFT_LIFETIME_MS } from '../models/NewConnectionDraft.js';

// Wizard fields holding images. They are stored as GridFS files rather than
// inside the draft document (see models/NewConnectionDraft.js).
const PHOTO_FIELDS = ['nicFront', 'nicBack', 'facePhoto'];

// Last step of the New Connection wizard (location, loop, identity, signature,
// payment, review). Anything higher is clamped.
const MAX_STEP_INDEX = 5;

// Matches the 5MB upload cap in IdentityCaptureField, with a little headroom.
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

const GRIDFS_BUCKET = 'uploads';

const dbUnavailable = (res, next) => {
  res.status(503);
  return next(new Error('Draft storage is temporarily unavailable'));
};

const getBucket = () =>
  new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: GRIDFS_BUCKET });

/** Store a base64 data URL in GridFS and return the new file id. */
const storePhoto = (dataUrl, field, phone) => {
  const [meta, base64] = dataUrl.split(',');
  if (!base64) throw new Error(`${field} is not a valid image`);

  const contentType = (meta.match(/data:(image\/[a-zA-Z+]+);/) || [])[1] || 'image/jpeg';
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > MAX_PHOTO_BYTES) {
    throw new Error(`${field} exceeds the 5MB limit`);
  }

  return new Promise((resolve, reject) => {
    const stream = getBucket().openUploadStream(`draft-${field}-${phone}-${Date.now()}`, {
      contentType,
      metadata: { kind: 'new-connection-draft', field, phone, uploadedAt: new Date() },
    });
    stream.on('error', reject);
    stream.on('finish', () => resolve(stream.id));
    stream.end(buffer);
  });
};

/** Read a GridFS file back as a data URL, or null if it no longer exists. */
const readPhoto = async (fileId) => {
  try {
    const bucket = getBucket();
    const [file] = await bucket.find({ _id: fileId }).toArray();
    if (!file) return null;

    const chunks = [];
    await new Promise((resolve, reject) => {
      bucket
        .openDownloadStream(fileId)
        .on('data', (chunk) => chunks.push(chunk))
        .on('error', reject)
        .on('end', resolve);
    });

    const contentType = file.contentType || file.metadata?.contentType || 'image/jpeg';
    return `data:${contentType};base64,${Buffer.concat(chunks).toString('base64')}`;
  } catch (err) {
    console.warn('Draft photo could not be read:', String(fileId), err.message);
    return null;
  }
};

/** Best-effort removal of GridFS files no longer referenced by a draft. */
const removePhotos = async (fileIds) => {
  const bucket = getBucket();
  await Promise.all(
    fileIds.filter(Boolean).map((id) =>
      bucket.delete(id).catch((err) => {
        console.warn('Draft photo could not be removed:', String(id), err.message);
      })
    )
  );
};

const photoFileIds = (draft) =>
  PHOTO_FIELDS.map((field) => draft?.photos?.[field]?.fileId).filter(Boolean);

const isExpired = (draft) => draft.expiresAt && draft.expiresAt.getTime() <= Date.now();

/** Delete a draft and its photo files. */
const destroyDraft = async (draft) => {
  await NewConnectionDraft.deleteOne({ _id: draft._id });
  await removePhotos(photoFileIds(draft));
};

/**
 * Update (or create) the draft for a phone number. The form and each photo are
 * saved by separate requests that can arrive together, so if both try to
 * create the draft at once the loser simply retries as an update.
 */
const upsertDraft = async (phone, update) => {
  const options = { upsert: true, new: true, setDefaultsOnInsert: true };
  try {
    return await NewConnectionDraft.findOneAndUpdate({ phone }, update, options);
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return NewConnectionDraft.findOneAndUpdate({ phone }, update, options);
  }
};

// @desc    Get the verified mobile number's unfinished New Connection application.
//          ?summary=true skips the photos, for the home page banner.
// @route   GET /api/drafts/new-connection
// @access  Private (OTP-verified mobile, x-draft-token)
export const getDraft = async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) return dbUnavailable(res, next);

  try {
    const draft = await NewConnectionDraft.findOne({ phone: req.draftPhone });

    // The TTL monitor only runs once a minute, so check expiry here as well.
    if (!draft || isExpired(draft)) {
      if (draft) await destroyDraft(draft);
      return res.status(200).json({ success: true, draft: null });
    }

    if (req.query.summary === 'true') {
      return res.status(200).json({
        success: true,
        draft: {
          stepIndex: draft.stepIndex,
          selectedProduct: draft.selectedProduct,
          updatedAt: draft.updatedAt,
        },
      });
    }

    // Hand photos back inside formData, exactly as the wizard holds them.
    const formData = { ...(draft.formData || {}) };
    await Promise.all(
      PHOTO_FIELDS.map(async (field) => {
        const photo = draft.photos?.[field];
        if (photo?.fileId) {
          const dataUrl = await readPhoto(photo.fileId);
          if (dataUrl) formData[field] = dataUrl;
        } else if (photo?.ref) {
          formData[field] = photo.ref;
        }
      })
    );

    res.status(200).json({
      success: true,
      draft: {
        formData,
        selectedProduct: draft.selectedProduct,
        stepIndex: draft.stepIndex,
        updatedAt: draft.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create or update the verified mobile number's draft: form fields,
//          package and step. Small and quick on purpose — photos are saved
//          separately (PUT /photos/:field) so a slow upload never holds back
//          the customer's progress.
// @route   PUT /api/drafts/new-connection
// @access  Private (OTP-verified mobile, x-draft-token)
export const saveDraft = async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) return dbUnavailable(res, next);

  const { formData, selectedProduct = null, stepIndex = 0 } = req.body || {};

  if (!formData || typeof formData !== 'object' || Array.isArray(formData)) {
    res.status(400);
    return next(new Error('formData object is required'));
  }

  try {
    // Photos never live inside formData on the server.
    const cleanForm = { ...formData };
    PHOTO_FIELDS.forEach((field) => delete cleanForm[field]);

    const safeStep = Math.min(Math.max(Number.parseInt(stepIndex, 10) || 0, 0), MAX_STEP_INDEX);

    const draft = await upsertDraft(req.draftPhone, {
      $set: {
        formData: cleanForm,
        selectedProduct,
        stepIndex: safeStep,
        expiresAt: new Date(Date.now() + DRAFT_LIFETIME_MS),
      },
    });

    res.status(200).json({
      success: true,
      draft: {
        stepIndex: draft.stepIndex,
        updatedAt: draft.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Save one photo (nicFront, nicBack or facePhoto) on the draft.
//          `image` is a base64 data URL, a reference to a file already on
//          record, or an empty string to remove the photo.
// @route   PUT /api/drafts/new-connection/photos/:field
// @access  Private (OTP-verified mobile, x-draft-token)
export const saveDraftPhoto = async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) return dbUnavailable(res, next);

  const { field } = req.params;
  if (!PHOTO_FIELDS.includes(field)) {
    res.status(400);
    return next(new Error('Unknown photo'));
  }

  const image = typeof req.body?.image === 'string' ? req.body.image.trim() : '';
  const phone = req.draftPhone;
  let newFileId = null;

  try {
    const existing = await NewConnectionDraft.findOne({ phone }).select(`photos.${field}`);
    const previousFileId = existing?.photos?.[field]?.fileId;

    let update;
    if (image.startsWith('data:image/')) {
      newFileId = await storePhoto(image, field, phone);
      update = { $set: { [`photos.${field}`]: { fileId: newFileId } } };
    } else if (image) {
      update = { $set: { [`photos.${field}`]: { ref: image } } };
    } else {
      update = { $unset: { [`photos.${field}`]: '' } };
    }

    if (!existing && !image) {
      // Nothing saved yet and nothing to remove.
      return res.status(200).json({ success: true });
    }

    await upsertDraft(phone, update);

    // Only drop the old image once the draft points at the new one.
    if (previousFileId) await removePhotos([previousFileId]);

    res.status(200).json({ success: true });
  } catch (error) {
    // Don't leave an orphaned image behind when the save itself failed.
    if (newFileId) await removePhotos([newFileId]);
    if (/exceeds the 5MB limit|not a valid image/.test(error.message)) res.status(400);
    next(error);
  }
};

// @desc    Remove one photo from the draft
// @route   DELETE /api/drafts/new-connection/photos/:field
// @access  Private (OTP-verified mobile, x-draft-token)
export const removeDraftPhoto = (req, res, next) => {
  req.body = { image: '' };
  return saveDraftPhoto(req, res, next);
};

// @desc    Delete the verified mobile number's draft (start over, or after submit)
// @route   DELETE /api/drafts/new-connection
// @access  Private (OTP-verified mobile, x-draft-token)
export const deleteDraft = async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) return dbUnavailable(res, next);

  try {
    const draft = await NewConnectionDraft.findOne({ phone: req.draftPhone });
    if (draft) await destroyDraft(draft);

    res.status(200).json({ success: true, message: 'Draft deleted' });
  } catch (error) {
    next(error);
  }
};
