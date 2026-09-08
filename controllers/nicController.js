import { scanSriLankanNIC } from '../services/geminiNicService.js';

/**
 * @desc    Scan Sri Lankan NIC (Front & Back) using Gemini Flash Vision
 * @route   POST /api/nic/scan
 * @access  Public
 */
export async function scanNIC(req, res) {
  try {
    let nicFront = req.body.nicFront;
    let nicBack = req.body.nicBack;

    // Support multipart uploads if files are attached via multer
    if (req.files) {
      if (req.files.nicFront && req.files.nicFront[0]) {
        nicFront = req.files.nicFront[0].buffer;
      }
      if (req.files.nicBack && req.files.nicBack[0]) {
        nicBack = req.files.nicBack[0].buffer;
      }
    }

    if (!nicFront) {
      return res.status(400).json({
        success: false,
        message: 'NIC Front image is required for scanning.',
      });
    }

    const extractedData = await scanSriLankanNIC({ nicFront, nicBack });

    return res.status(200).json({
      success: true,
      message: 'NIC details extracted successfully',
      data: extractedData,
    });
  } catch (err) {
    console.error('Error scanning NIC with Gemini Vision:', err.message);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to scan NIC image. Please try fallback OCR.',
    });
  }
}
