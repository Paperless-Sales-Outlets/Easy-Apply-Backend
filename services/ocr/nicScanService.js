// Easy-Apply-Backend/services/ocr/nicScanService.js
// Orchestrates NIC OCR: Gemini Vision is the primary engine; when it is
// unavailable (no key, quota, network, bad JSON, empty result) the local
// PaddleOCR model takes over so scanning keeps working without any external API.

import { scanSriLankanNIC } from './geminiNicService.js';
import { scanNicDocuments } from './paddleOcrService.js';

const CORE_FIELDS = ['nicNumber', 'fullName', 'dob', 'gender', 'address'];

/**
 * Converts a Gemini result into the same flat shape the local engine returns,
 * so callers (and the frontend) never need to know which engine ran.
 */
function normalizeGeminiResult(data) {
  const missingFields = CORE_FIELDS.filter((key) => !data[key]);
  const { city, district, gender } = data;
  return {
    ...data,
    success: Boolean(data.nicNumber),
    serviceArea: city && district ? `${city}, ${district}` : city || district || '',
    suggestedTitle: gender === 'Female' ? 'Ms.' : gender === 'Male' ? 'Mr.' : '',
    isPartial: missingFields.length > 0,
    missingFields,
    fetchedCount: CORE_FIELDS.length - missingFields.length,
    extractionStatus: !data.nicNumber ? 'FAILED' : missingFields.length ? 'PARTIAL' : 'COMPLETE',
  };
}

/**
 * Scans a NIC with Gemini, falling back to the local PaddleOCR engine.
 *
 * @param {Object} params
 * @param {string|Buffer} [params.nicFront]
 * @param {string|Buffer} [params.nicBack]
 * @param {string} [params.expectedNIC] - customer-entered NIC, used to disambiguate local OCR
 * @returns {Promise<Object>} flat OCR result including `engine` and `fallbackReason`
 * @throws if both engines fail
 */
export async function scanNic({ nicFront, nicBack, expectedNIC }) {
  if (!nicFront && !nicBack) {
    throw new Error('At least one NIC image (front or back) is required.');
  }

  let fallbackReason = '';

  // Gemini needs a front image; a back-only scan goes straight to the local engine.
  if (nicFront) {
    try {
      const result = normalizeGeminiResult(await scanSriLankanNIC({ nicFront, nicBack }));
      if (result.success) return result;
      fallbackReason = 'Gemini could not read a NIC number';
    } catch (err) {
      fallbackReason = err.message;
    }
    console.warn(`[NIC OCR] Gemini failed (${fallbackReason}); using local PaddleOCR.`);
  }

  try {
    const local = await scanNicDocuments({ nicFront, nicBack, expectedNIC });
    return { ...local, fallbackReason };
  } catch (err) {
    throw new Error(`NIC scan failed on all OCR engines: ${err.message}`);
  }
}
