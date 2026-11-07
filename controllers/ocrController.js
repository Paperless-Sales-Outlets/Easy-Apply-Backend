// Easy-Apply-Backend/controllers/ocrController.js
import { scanNicDocuments, recognizeImage } from '../services/paddleOcrService.js';

/**
 * @desc    Process Sri Lankan NIC card images using deep learning PaddleOCR
 * @route   POST /api/ocr/scan-nic
 * @access  Public
 */
export async function scanNic(req, res) {
  try {
    const {
      nicFront,
      nicBack,
      frontImage,
      backImage,
      image,
      side = 'front',
      expectedNIC
    } = req.body || {};

    const front = nicFront || frontImage || (side === 'front' ? image : null);
    const back = nicBack || backImage || (side === 'back' ? image : null);

    if (!front && !back) {
      return res.status(400).json({
        success: false,
        message: 'At least one NIC image (front or back) must be provided for scanning.',
      });
    }

    console.log(`[OCR Controller] Scan request received. hasFront: ${Boolean(front)}, hasBack: ${Boolean(back)}, expectedNIC: ${expectedNIC || 'none'}`);

    const result = await scanNicDocuments({
      nicFront: front,
      nicBack: back,
      expectedNIC,
    });

    console.log(`[OCR Controller] Result: fetchedCount=${result.fetchedCount}, nic=${result.nicNumber || 'none'}, name=${result.fullName || 'none'}, rawFrontLen=${result.rawFront?.length || 0}`);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[OCR Controller] Scan error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to process NIC image with server-side OCR.',
      error: err.message,
    });
  }
}

/**
 * @desc    General image text extraction
 * @route   POST /api/ocr/recognize
 * @access  Public
 */
export async function recognizeGeneralImage(req, res) {
  try {
    const { image } = req.body || {};
    if (!image) {
      return res.status(400).json({
        success: false,
        message: 'Image data is required.',
      });
    }

    const result = await recognizeImage(image);
    return res.status(200).json({
      success: true,
      text: result.text,
      confidence: result.confidence,
      results: result.results,
    });
  } catch (err) {
    console.error('[OCR Controller] Recognize error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to recognize image text.',
      error: err.message,
    });
  }
}
