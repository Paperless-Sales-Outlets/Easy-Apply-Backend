import { createRequire } from 'node:module';
import path from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Local face matching for automated KYC
//
// Compares the customer's live selfie with the photo on their NIC (and with a
// selfie a person has already verified). Everything runs on this server with
// the open-source face-api models — no image is ever sent to another service.
//
// The models turn each face into a 128-number "descriptor"; the euclidean
// distance between two descriptors says how alike two faces are (0 = same
// image). face-api's usual same-person cut-off is 0.6. Automated KYC is
// deliberately much stricter, so it only *passes* a face when the match is
// strong — anything weaker is handed to a person, never auto-rejected:
//
//   distance ≤ KYC_FACE_MATCH_MAX (default 0.45)  → strong match   → pass
//   anything else / no face / engine unavailable  → not sure       → flagged
//
// The packages load lazily, so the server still starts (and KYC still works,
// with every face check flagged) if they are missing on a machine.
// ─────────────────────────────────────────────────────────────────────────────

const require = createRequire(import.meta.url);

const envNumber = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 && n < 2 ? n : fallback;
};

// Strongest-match thresholds. Lower = stricter.
export const FACE_MATCH_MAX = envNumber('KYC_FACE_MATCH_MAX', 0.45);
// Two selfies of the same person are far more alike than a selfie and an ID
// photo, so the bar against an already-verified selfie is stricter still.
export const SELFIE_MATCH_MAX = envNumber('KYC_SELFIE_MATCH_MAX', 0.4);

const MAX_SIDE = 1024;          // images are scaled down to this before detection
const MIN_FACE_SIDE = 40;       // px (after scaling) — smaller is too blurry to trust
const DETECT_CONFIDENCE = 0.5;
const NIC_DETECT_CONFIDENCE = 0.35; // NIC portraits are small and printed
const CACHE_LIMIT = 200;

let enginePromise = null;

export const faceMatchingEnabled = () => String(process.env.KYC_FACE_MATCH || '').toLowerCase() !== 'off';

async function loadEngine() {
  const tf = require('@tensorflow/tfjs');
  const wasm = require('@tensorflow/tfjs-backend-wasm');
  const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
  const sharp = (await import('sharp')).default;

  const wasmDir = path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm'));
  wasm.setWasmPaths(`${wasmDir}${path.sep}`);
  await tf.setBackend('wasm');
  await tf.ready();

  const modelDir = path.join(path.dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir);
  await faceapi.nets.faceLandmark68Net.loadFromDisk(modelDir);
  await faceapi.nets.faceRecognitionNet.loadFromDisk(modelDir);

  console.log('[kyc-face] local face matching ready');
  return { tf, faceapi, sharp };
}

/** The loaded engine, or null when it is switched off or cannot load. */
export async function getFaceEngine() {
  if (!faceMatchingEnabled()) return null;
  if (!enginePromise) {
    enginePromise = loadEngine().catch((err) => {
      console.error('[kyc-face] face matching unavailable:', err.message);
      return null;
    });
  }
  return enginePromise;
}

// One image at a time: face detection is CPU-heavy and must not starve the API.
let queue = Promise.resolve();
const serial = (job) => {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
};

// Descriptors keyed by the image's content hash, so a NIC photo that several
// cases share is only analysed once.
const cache = new Map();
const remember = (key, value) => {
  if (!key) return value;
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return value;
};

/**
 * Finds the faces in one image.
 * → { ok: true, faces: number, face: { descriptor, score, size } | null }
 *   or { ok: false, reason } when the image cannot be read.
 */
export async function analyseFace(buffer, { kind = 'selfie', hash = null } = {}) {
  const cacheKey = hash ? `${kind}:${hash}` : null;
  if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey);

  const engine = await getFaceEngine();
  if (!engine) return { ok: false, reason: 'engine' };

  return serial(async () => {
    const { tf, faceapi, sharp } = engine;
    let pixels;
    try {
      // .rotate() applies the phone's EXIF orientation so portrait selfies are upright.
      pixels = await sharp(buffer, { failOn: 'error' })
        .rotate()
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });
    } catch {
      return remember(cacheKey, { ok: false, reason: 'unreadable' });
    }

    const { data, info } = pixels;
    const input = tf.tensor3d(new Uint8Array(data.buffer, data.byteOffset, data.length), [info.height, info.width, 3], 'int32');
    try {
      const options = new faceapi.SsdMobilenetv1Options({
        minConfidence: kind === 'nic' ? NIC_DETECT_CONFIDENCE : DETECT_CONFIDENCE,
        maxResults: 10,
      });
      const found = await faceapi.detectAllFaces(input, options).withFaceLandmarks().withFaceDescriptors();
      const usable = found
        .map((f) => ({
          descriptor: Array.from(f.descriptor),
          score: f.detection.score,
          size: Math.round(Math.min(f.detection.box.width, f.detection.box.height)),
        }))
        .filter((f) => f.size >= MIN_FACE_SIDE)
        .sort((a, b) => b.size - a.size);
      return remember(cacheKey, { ok: true, faces: usable.length, face: usable[0] || null, all: usable });
    } finally {
      input.dispose();
    }
  });
}

export function faceDistance(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}
