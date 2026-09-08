import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

let aiClient = null;

function getAIClient() {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured in backend environment.');
    }
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

/**
 * Normalizes input image string (base64 data URL or raw base64) to an inlineData object
 */
function toInlineData(imageInput, defaultMime = 'image/jpeg') {
  if (!imageInput) return null;
  
  if (typeof imageInput === 'string') {
    if (imageInput.startsWith('data:')) {
      const match = imageInput.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        return {
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        };
      }
    }
    // Raw base64 string
    return {
      inlineData: {
        mimeType: defaultMime,
        data: imageInput,
      },
    };
  }

  // If buffer provided
  if (Buffer.isBuffer(imageInput)) {
    return {
      inlineData: {
        mimeType: defaultMime,
        data: imageInput.toString('base64'),
      },
    };
  }

  return null;
}

/**
 * Scan Sri Lankan NIC Front and optional Back images using Gemini Flash Vision
 * @param {Object} params
 * @param {string|Buffer} params.nicFront - Base64 or buffer of NIC front side
 * @param {string|Buffer} [params.nicBack] - Base64 or buffer of NIC back side
 * @returns {Promise<Object>} Extracted NIC fields
 */
export async function scanSriLankanNIC({ nicFront, nicBack }) {
  const ai = getAIClient();

  const parts = [];

  const promptText = `
You are an expert OCR AI specializing in reading Sri Lankan National Identity Cards (NIC) (both 12-digit Smart Card New NIC and 9-digit Old NIC with V/X).

Analyze the provided image(s) carefully:
1. Extract the National Identity Card number (12 digits for New NIC or 9 digits + V/X for Old NIC).
2. Extract the Full Legal Name in English (Latin characters) exactly as printed on the card.
3. If the reverse/back side is provided, extract the full permanent address text.
4. Extract the City and District if identifiable from the address or card.
5. If Date of Birth or Gender are visible on the card, extract them.

Return ONLY a raw JSON object with NO markdown wrapping, matching this exact schema:
{
  "nicNumber": "199512345678",
  "fullName": "John Michael Perera",
  "address": "No. 12/A, Temple Road, Colombo",
  "city": "Colombo",
  "district": "Colombo",
  "dob": "1995-05-12",
  "gender": "Male",
  "cardType": "NEW_NIC"
}

If any specific field cannot be read, set its value to an empty string "".
Do not invent or hallucinate missing data.
`;

  parts.push({ text: promptText });

  const frontData = toInlineData(nicFront);
  if (frontData) {
    parts.push(frontData);
  } else {
    throw new Error('NIC Front image is required for scanning.');
  }

  const backData = toInlineData(nicBack);
  if (backData) {
    parts.push(backData);
  }

  // Attempt scan using gemini-3.6-flash (fallback to gemini-2.0-flash / gemini-1.5-flash if needed)
  const modelsToTry = ['gemini-3.6-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
  let rawResponseText = '';
  let lastError = null;

  for (const modelName of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: 'user',
            parts: parts,
          },
        ],
      });

      rawResponseText = response.text || '';
      if (rawResponseText) break;
    } catch (err) {
      lastError = err;
      console.warn(`Gemini model ${modelName} failed, trying next:`, err.message);
    }
  }

  if (!rawResponseText && lastError) {
    throw lastError;
  }

  // Sanitize and extract JSON object from response
  let cleanedJson = rawResponseText.trim();
  if (cleanedJson.startsWith('```')) {
    cleanedJson = cleanedJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }

  try {
    const parsed = JSON.parse(cleanedJson);
    return {
      success: true,
      nicNumber: (parsed.nicNumber || '').trim().toUpperCase(),
      fullName: (parsed.fullName || '').trim(),
      address: (parsed.address || '').trim(),
      city: (parsed.city || '').trim(),
      district: (parsed.district || '').trim(),
      dob: (parsed.dob || '').trim(),
      gender: (parsed.gender || '').trim(),
      cardType: parsed.cardType || 'NEW_NIC',
      engine: 'GEMINI_FLASH_VISION',
    };
  } catch (parseErr) {
    console.error('Failed to parse Gemini OCR JSON response:', rawResponseText);
    throw new Error('Gemini OCR returned invalid JSON structure.');
  }
}
