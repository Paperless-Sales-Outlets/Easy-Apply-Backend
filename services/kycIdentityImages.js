import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { getSignedFileUrl } from './s3Service.js';

// ─────────────────────────────────────────────────────────────────────────────
// Identity images for automated KYC (admin side, read-only)
//
// The customer flow stores NIC photos and selfies in several shapes, depending
// on which screen captured them:
//   • a GridFS ObjectId            (registration — customer.identityDocuments)
//   • "gridfs://<id>" / "/api/files/<id>"   (application uploads)
//   • "data:image/…;base64,…"      (images posted inside the form)
//   • "/uploads/documents/<file>"  (disk / S3 uploads)
// This module turns any of them into the actual bytes plus *when* the image was
// captured, which is what tells a fresh capture from one already on file.
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 15 * 1024 * 1024;
export const MIN_IMAGE_BYTES = 5 * 1024;

// A capture counts as "with this request" when it was taken at most this long
// before the request was submitted (the customer uploads, then fills the form).
export const FRESH_CAPTURE_HOURS = 24;

/** Normalises a stored reference → { kind: 'gridfs'|'inline'|'path', … } or null. */
export function docRef(raw) {
  if (!raw) return null;
  const s = typeof raw === 'string'
    ? raw
    : raw._bsontype === 'ObjectId' || raw instanceof mongoose.Types.ObjectId ? String(raw) : raw.url || raw.fileId;
  if (typeof s !== 'string') return null;
  if (s.startsWith('data:image/')) return { kind: 'inline', value: s, key: `inline:${s.length}:${s.slice(-48)}` };
  const m = s.match(/^(?:gridfs:\/\/|\/api\/files\/)?([0-9a-fA-F]{24})$/);
  if (m) return { kind: 'gridfs', id: m[1], key: `gridfs:${m[1].toLowerCase()}` };
  if (s.startsWith('/uploads/') || /^https?:\/\//.test(s)) return { kind: 'path', value: s, key: `path:${s}` };
  return null; // e.g. the DIGITALLY_VERIFIED_OTP marker
}

/** Same stored image? (two references can point at one file) */
export const sameRef = (a, b) => Boolean(a && b && a.key === b.key);

/**
 * The image format from the file's first bytes, or null when it is not an image.
 * Stored content types cannot be trusted: since the MongoDB driver upgrade most
 * uploads are saved without one.
 */
export function sniffImageType(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  if (b.toString('ascii', 0, 2) === 'BM') return 'image/bmp';
  if (b.toString('ascii', 4, 8) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1|avif)/.test(b.toString('ascii', 8, 12))) return 'image/heic';
  return null;
}

/**
 * GridFS file records for a list of refs, keyed by id. With `sniff`, each file
 * also gets `imageType`, read from its first bytes.
 */
export async function gridfsInfo(refs, { sniff = false } = {}) {
  const ids = [...new Set(refs.filter((r) => r?.kind === 'gridfs').map((r) => r.id))]
    .map((id) => new mongoose.Types.ObjectId(id));
  if (!ids.length) return new Map();
  const db = mongoose.connection.db;
  const files = await db.collection('uploads.files')
    .find({ _id: { $in: ids } })
    .project({ length: 1, contentType: 1, uploadDate: 1, metadata: 1 })
    .toArray();
  if (sniff && files.length) {
    const firstChunks = await db.collection('uploads.chunks')
      .find({ files_id: { $in: files.map((f) => f._id) }, n: 0 })
      .project({ files_id: 1, data: 1 })
      .toArray();
    const head = new Map(firstChunks.map((c) => [String(c.files_id), c.data?.buffer ? Buffer.from(c.data.buffer).subarray(0, 32) : null]));
    files.forEach((f) => { f.imageType = sniffImageType(head.get(String(f._id))); });
  }
  return new Map(files.map((f) => [String(f._id), f]));
}

/** Image format of an inline data URL, from its decoded first bytes. */
export function inlineImageType(dataUrl) {
  const base64 = String(dataUrl).split(',')[1] || '';
  return sniffImageType(Buffer.from(base64.slice(0, 64), 'base64'));
}

/** When an image was captured, if that can be known. */
export function capturedAtOf(ref, info, fallback) {
  if (!ref) return null;
  if (ref.kind === 'gridfs') {
    const f = info.get(ref.id);
    return f?.metadata?.uploadedAt || f?.uploadDate || null;
  }
  // Inline / path images carry no date of their own — they arrived with the record.
  return fallback || null;
}

/** 'request' = captured for this request, 'on-file' = captured earlier, null = unknown. */
export function captureSource(capturedAt, submittedAt) {
  if (!capturedAt || !submittedAt) return null;
  const ageMs = new Date(submittedAt).getTime() - new Date(capturedAt).getTime();
  if (Number.isNaN(ageMs)) return null;
  return ageMs <= FRESH_CAPTURE_HOURS * 3600 * 1000 ? 'request' : 'on-file';
}

async function readGridfs(id) {
  const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
  const chunks = [];
  let total = 0;
  await new Promise((resolve, reject) => {
    bucket.openDownloadStream(new mongoose.Types.ObjectId(id))
      .on('data', (c) => {
        total += c.length;
        if (total > MAX_BYTES) reject(new Error('image too large'));
        else chunks.push(c);
      })
      .on('end', resolve)
      .on('error', reject);
  });
  return Buffer.concat(chunks);
}

async function readPath(value) {
  // A full web address came from the submitted form, so it is never fetched —
  // that would let anyone make this server call an address of their choosing.
  if (/^https?:\/\//.test(value)) return null;
  // Local disk first (dev / single server), then our own S3 bucket when configured.
  const rel = value.replace(/^\/+/, '').split(/[?#]/)[0];
  const local = path.resolve(BACKEND_ROOT, rel);
  if (local.startsWith(path.join(BACKEND_ROOT, 'uploads'))) {
    try { return await fs.readFile(local); } catch (_) { /* not on this disk */ }
  }
  const signed = await getSignedFileUrl(value);
  return /^https?:\/\//.test(signed) ? fetchBytes(signed) : null;
}

async function fetchBytes(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > MAX_BYTES ? null : buf;
}

/**
 * The bytes of one stored image → { buffer, hash } or null when it cannot be read.
 */
export async function readImage(ref) {
  if (!ref) return null;
  try {
    let buffer = null;
    if (ref.kind === 'gridfs') buffer = await readGridfs(ref.id);
    else if (ref.kind === 'inline') {
      const base64 = ref.value.split(',')[1] || '';
      buffer = Buffer.from(base64, 'base64');
    } else if (ref.kind === 'path') buffer = await readPath(ref.value);
    if (!buffer || !buffer.length || buffer.length > MAX_BYTES) return null;
    return { buffer, hash: crypto.createHash('sha256').update(buffer).digest('hex') };
  } catch (err) {
    return null;
  }
}
