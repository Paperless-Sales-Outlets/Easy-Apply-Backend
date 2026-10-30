// Easy-Apply-Backend/services/paddleOcrService.js
// High-accuracy server-side OCR engine using PaddleOCR DBNet + SVTR on ONNX Runtime in pure Node.js.

import sharp from 'sharp';
import { PaddleOcrService, V4_EN_MOBILE_MODEL } from 'ppu-paddle-ocr';
import {
  cleanNIC,
  extractNICFromText,
  extractFullNameFromOCR,
  extractAddressFromOCR,
  deriveGenderAndDOBFromNIC,
  deriveServiceAreaFromAddress,
} from '../utils/nicParser.js';

let paddleInstance = null;
let initPromise = null;

/**
 * Gets or initializes the shared PaddleOcrService singleton.
 */
export async function getPaddleOcrInstance() {
  if (paddleInstance) return paddleInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      console.log('[PaddleOCR] Initializing ONNX Runtime PaddleOCR model (PP-OCRv4)...');
      const service = new PaddleOcrService({ model: V4_EN_MOBILE_MODEL });
      await service.initialize();
      paddleInstance = service;
      console.log('[PaddleOCR] Model initialized successfully.');
      return paddleInstance;
    } catch (err) {
      console.error('[PaddleOCR] Initialization failed:', err);
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

/**
 * Normalizes input image (base64 string, data URL, or Buffer) and returns an ArrayBuffer for PaddleOCR.
 * Sharp auto-rotates phone camera images according to EXIF metadata.
 */
async function prepareImageBuffer(imageInput) {
  if (!imageInput) return null;

  let rawBuf;
  if (Buffer.isBuffer(imageInput)) {
    rawBuf = imageInput;
  } else if (typeof imageInput === 'string') {
    const base64Data = imageInput.replace(/^data:image\/\w+;base64,/, '');
    rawBuf = Buffer.from(base64Data, 'base64');
  } else {
    throw new Error('Unsupported image input type. Expected Buffer or Base64 string.');
  }

  // Use sharp to auto-orient by EXIF and ensure standard PNG/JPEG
  const processedBuf = await sharp(rawBuf)
    .rotate() // Auto-orient EXIF orientation
    .toBuffer();

  return processedBuf.buffer.slice(
    processedBuf.byteOffset,
    processedBuf.byteOffset + processedBuf.byteLength
  );
}

/**
 * Performs deep learning text recognition on an image using PaddleOCR.
 *
 * @param {Buffer|string} imageInput
 * @returns {Promise<{ text: string, confidence: number, results: Array }>}
 */
export async function recognizeImage(imageInput) {
  const ocrService = await getPaddleOcrInstance();
  const arrayBuffer = await prepareImageBuffer(imageInput);
  if (!arrayBuffer) return { text: '', confidence: 0, results: [] };

  const result = await ocrService.recognize(arrayBuffer, { flatten: true });
  return {
    text: result?.text || '',
    confidence: result?.confidence || 0,
    results: result?.results || [],
  };
}

/**
 * Scans Sri Lankan National Identity Card images (front and/or back).
 *
 * @param {Object} options
 * @param {string|Buffer} [options.nicFront] - Front of NIC
 * @param {string|Buffer} [options.nicBack] - Reverse of NIC
 * @param {string} [options.expectedNIC] - Customer-entered NIC for disambiguation
 * @returns {Promise<Object>} Extracted details with confidence scores
 */
export async function scanNicDocuments({ nicFront, nicBack, expectedNIC }) {
  const startTime = Date.now();
  let frontText = '';
  let backText = '';
  let frontConfidence = 0;
  let backConfidence = 0;

  if (nicFront) {
    const frontRes = await recognizeImage(nicFront);
    frontText = frontRes.text;
    frontConfidence = frontRes.confidence;
  }

  if (nicBack) {
    const backRes = await recognizeImage(nicBack);
    backText = backRes.text;
    backConfidence = backRes.confidence;
  }

  const combinedText = `${frontText}\n${backText}`;

  // 1. NIC Extraction
  const nicResult =
    extractNICFromText(frontText, { expectedNIC }) ||
    extractNICFromText(backText, { expectedNIC }) ||
    extractNICFromText(combinedText, { expectedNIC });

  let nicNumber = nicResult?.nic ? cleanNIC(nicResult.nic) : '';
  if (!nicNumber && expectedNIC) {
    const cleanExp = cleanNIC(expectedNIC);
    if (cleanExp && (combinedText.includes(cleanExp.slice(0, 6)) || combinedText.includes(cleanExp.slice(-6)))) {
      nicNumber = cleanExp;
    }
  }

  // 2. Full Name Extraction (strictly from front text)
  const fullName =
    extractFullNameFromOCR(frontText) ||
    (frontText ? '' : extractFullNameFromOCR(combinedText));

  // 3. Address Extraction (strictly from back text)
  const address =
    extractAddressFromOCR(backText) ||
    (backText ? '' : extractAddressFromOCR(combinedText));

  // 4. Derived DOB & Gender from NIC number
  const derivedInfo = nicNumber ? deriveGenderAndDOBFromNIC(nicNumber) : null;
  const areaInfo = address ? deriveServiceAreaFromAddress(address) : null;

  const city = areaInfo?.city || '';
  const district = areaInfo?.district || '';
  const gender = derivedInfo?.gender || '';
  const dob = derivedInfo?.dob || '';

  // 5. Evaluate completeness
  const missingFields = [];
  if (!nicNumber) missingFields.push('nicNumber');
  if (!fullName || fullName.length < 3) missingFields.push('fullName');
  if (!dob) missingFields.push('dob');
  if (!gender) missingFields.push('gender');
  if (!address) missingFields.push('address');

  const fetchedCount = 5 - missingFields.length;
  const isPartial = missingFields.length > 0;
  const extractionStatus = !nicNumber ? 'FAILED' : isPartial ? 'PARTIAL' : 'COMPLETE';

  return {
    success: true,
    engine: 'PADDLE_OCR_NODE_ONNX',
    nicNumber,
    fullName,
    address,
    city,
    district,
    serviceArea: city && district ? `${city}, ${district}` : (city || district),
    dob,
    gender,
    suggestedTitle: gender === 'Female' ? 'Ms.' : gender === 'Male' ? 'Mr.' : '',
    extractionStatus,
    isPartial,
    missingFields,
    fetchedCount,
    frontConfidence,
    backConfidence,
    rawFront: frontText,
    rawBack: backText,
    timingMs: Date.now() - startTime,
  };
}
