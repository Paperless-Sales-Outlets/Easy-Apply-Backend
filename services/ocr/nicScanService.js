// Easy-Apply-Backend/services/ocr/nicScanService.js
// Orchestrates NIC OCR across two engines: Gemini Vision and the local
// PaddleOCR model. Which one runs is controlled by NIC_OCR_ENGINE:
//
//   auto   (default) Gemini first; if it fails or reads no NIC number, the local model runs.
//   local  Local model only. Gemini is never called, so no image leaves the server.
//   gemini Gemini only; failures are reported, not retried locally.

import { scanSriLankanNIC } from './geminiNicService.js';
import { scanNicDocuments } from './paddleOcrService.js';

const CORE_FIELDS = ['nicNumber', 'fullName', 'dob', 'gender', 'address'];
export const ENGINE_MODES = ['auto', 'local', 'gemini'];

/** Reads NIC_OCR_ENGINE; an unknown value falls back to 'auto' with a warning. */
export function getEngineMode(env = process.env) {
  const mode = String(env.NIC_OCR_ENGINE || 'auto').trim().toLowerCase();
  if (ENGINE_MODES.includes(mode)) return mode;
  console.warn(`[NIC OCR] Unknown NIC_OCR_ENGINE "${env.NIC_OCR_ENGINE}"; using "auto".`);
  return 'auto';
}

/**
 * Converts a Gemini result into the same flat shape the local engine returns,
 * so callers (and the frontend) never need to know which engine ran.
 */
export function normalizeGeminiResult(data) {
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
 * Builds a scanner. The engines are parameters so tests can supply fakes.
 *
 * @param {Object} [deps]
 * @param {Function} [deps.gemini] - ({ nicFront, nicBack }) => Promise<raw Gemini result>
 * @param {Function} [deps.local]  - ({ nicFront, nicBack, expectedNIC }) => Promise<local result>
 * @param {Function} [deps.getMode] - () => 'auto' | 'local' | 'gemini'
 * @returns {Function} scan({ nicFront, nicBack, expectedNIC }) => flat OCR result
 */
export function createNicScanner({
  gemini = scanSriLankanNIC,
  local = scanNicDocuments,
  getMode = getEngineMode,
} = {}) {
  return async function scanNic({ nicFront, nicBack, expectedNIC } = {}) {
    if (!nicFront && !nicBack) {
      throw new Error('At least one NIC image (front or back) is required.');
    }

    const mode = getMode();
    let fallbackReason = '';

    // Gemini needs a front image; a back-only scan goes straight to the local engine.
    if (mode !== 'local' && nicFront) {
      try {
        const result = normalizeGeminiResult(await gemini({ nicFront, nicBack }));
        if (result.success) return result;
        fallbackReason = 'Gemini could not read a NIC number';
      } catch (err) {
        fallbackReason = err.message;
      }

      if (mode === 'gemini') {
        throw new Error(`NIC scan failed on Gemini: ${fallbackReason}`);
      }
      console.warn(`[NIC OCR] Gemini failed (${fallbackReason}); using local PaddleOCR.`);
    }

    try {
      const result = await local({ nicFront, nicBack, expectedNIC });
      return { ...result, fallbackReason };
    } catch (err) {
      throw new Error(`NIC scan failed on all OCR engines: ${err.message}`);
    }
  };
}

/** Default scanner wired to the real engines and NIC_OCR_ENGINE. */
export const scanNic = createNicScanner();
