// Easy-Apply-Backend/controllers/ocrController.js
import { scanNic as scanNicWithFallback } from '../services/ocr/nicScanService.js';
import { recognizeImage } from '../services/ocr/paddleOcrService.js';

/**
 * @desc    Scan a Sri Lankan NIC (Gemini first, local PaddleOCR fallback)
 * @route   POST /api/ocr/scan-nic
 * @access  Public
 */
export async function scanNic(req, res) {
  try {
    const { nicFront, nicBack, frontImage, backImage, image, side = 'front', expectedNIC } = req.body || {};

    const front = nicFront || frontImage || (side === 'front' ? image : null);
    const back = nicBack || backImage || (side === 'back' ? image : null);

    if (!front && !back) {
      return res.status(400).json({
        success: false,
        message: 'At least one NIC image (front or back) must be provided for scanning.',
      });
    }

    const result = await scanNicWithFallback({ nicFront: front, nicBack: back, expectedNIC });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[OCR Controller] Scan error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to process NIC image. Please enter your details manually.',
      error: err.message,
    });
  }
}

/**
 * @desc    General image text extraction (local PaddleOCR)
 * @route   POST /api/ocr/recognize
 * @access  Public
 */
export async function recognizeGeneralImage(req, res) {
  try {
    const { image } = req.body || {};
    if (!image) {
      return res.status(400).json({ success: false, message: 'Image data is required.' });
    }

    const { text, confidence, results } = await recognizeImage(image);
    return res.status(200).json({ success: true, text, confidence, results });
  } catch (err) {
    console.error('[OCR Controller] Recognize error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to recognize image text.',
      error: err.message,
    });
  }
}
