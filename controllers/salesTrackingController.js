import SalesOfficerQr from '../models/SalesOfficerQr.js';
import { buildQrUrl } from '../services/salesTrackingService.js';

// @desc    Validate a sales tracking token and return safe minimal redirect information
// @route   GET /api/v1/sales-tracking/:token
// @access  Public
export const resolveTrackingToken = async (req, res, next) => {
  try {
    const { token } = req.params;

    if (!token || typeof token !== 'string') {
      res.status(400);
      return next(new Error('Tracking token is required'));
    }

    const cleanToken = token.trim();

    const qrRecord = await SalesOfficerQr.findOne({
      trackingToken: cleanToken,
      isActive: true,
    }).populate('officer', 'isActive role');

    if (!qrRecord || !qrRecord.officer || qrRecord.officer.isActive === false) {
      res.status(404);
      return next(new Error('Invalid, inactive, or expired sales tracking token'));
    }

    // Atomically increment scan count and record last scanned timestamp
    qrRecord.scansCount = (qrRecord.scansCount || 0) + 1;
    qrRecord.lastScannedAt = new Date();
    await qrRecord.save();

    const portalUrl = buildQrUrl(cleanToken);

    res.status(200).json({
      success: true,
      valid: true,
      trackingToken: cleanToken,
      portalUrl,
    });
  } catch (error) {
    next(error);
  }
};
