import express from 'express';
import {
  getDraft,
  saveDraft,
  deleteDraft,
  saveDraftPhoto,
  removeDraftPhoto,
} from '../controllers/draftController.js';
import { protectDraft } from '../middleware/draftAuthMiddleware.js';

const router = express.Router();

// All routes need the `x-draft-token` header issued by POST /api/otp/verify.

// @route   GET /api/drafts/new-connection
// @desc    Load the verified mobile number's unfinished New Connection application
// @access  Private (OTP-verified mobile)
router.get('/new-connection', protectDraft, getDraft);

// @route   PUT /api/drafts/new-connection
// @desc    Save progress on the New Connection application
// @access  Private (OTP-verified mobile)
router.put('/new-connection', protectDraft, saveDraft);

// @route   DELETE /api/drafts/new-connection
// @desc    Discard the unfinished application (start over / after submit)
// @access  Private (OTP-verified mobile)
router.delete('/new-connection', protectDraft, deleteDraft);

// @route   PUT /api/drafts/new-connection/photos/:field
// @desc    Save one photo (nicFront, nicBack, facePhoto), separately from the form
// @access  Private (OTP-verified mobile)
router.put('/new-connection/photos/:field', protectDraft, saveDraftPhoto);

// @route   DELETE /api/drafts/new-connection/photos/:field
// @desc    Remove one photo from the draft
// @access  Private (OTP-verified mobile)
router.delete('/new-connection/photos/:field', protectDraft, removeDraftPhoto);

export default router;
