// Easy-Apply-Backend/controllers/nicController.js
import { scanNic } from '../services/ocr/nicScanService.js';

/**
 * @desc    Scan a Sri Lankan NIC (front & optional back); multipart or base64 JSON
 * @route   POST /api/nic/scan
 * @access  Public
 */
export async function scanNIC(req, res) {
  try {
    const nicFront = req.files?.nicFront?.[0]?.buffer || req.body?.nicFront;
    const nicBack = req.files?.nicBack?.[0]?.buffer || req.body?.nicBack;

    if (!nicFront) {
      return res.status(400).json({ success: false, message: 'NIC Front image is required for scanning.' });
    }

    const data = await scanNic({ nicFront, nicBack });
    return res.status(200).json({ success: true, message: 'NIC details extracted successfully', data });
  } catch (err) {
    console.error('[NIC Controller] Scan error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to scan NIC image. Please enter your details manually.',
    });
  }
}
