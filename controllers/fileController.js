import { downloadBuffer } from '../services/storageService.js';

// MIME type map for common document extensions
const MIME_TYPES = {
  '.pdf':  'application/pdf',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.webp': 'image/webp',
};

function sniffMimeType(buf) {
  if (!buf || buf.length < 4) return 'application/octet-stream';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF') return 'image/webp';
  if (buf.toString('ascii', 0, 4) === '%PDF') return 'application/pdf';
  return 'image/jpeg';
}

// ---------------------------------------------------------------------------
// @desc  Serve a stored KYC document with on-the-fly authenticated decryption
// @route GET /api/files/:id(*)
// @access Protected (Admin / Staff)
// ---------------------------------------------------------------------------
export const serveGridFsFile = async (req, res, next) => {
  const targetKey = req.params.id || req.params[0] || req.path.replace(/^\/+/, '');

  if (!targetKey) {
    res.status(400);
    return next(new Error('Invalid file ID or key'));
  }

  try {
    const { buffer, isEncrypted } = await downloadBuffer(targetKey);

    if (!buffer || buffer.length === 0) {
      res.status(404);
      return next(new Error('File not found in storage'));
    }

    const contentType = sniffMimeType(buffer);

    res.set('Content-Type', contentType);
    res.set('Content-Length', buffer.length);
    res.set('Cache-Control', 'private, max-age=300');
    if (isEncrypted) {
      res.set('x-decrypted-at-rest', 'true');
    }

    return res.status(200).send(buffer);
  } catch (error) {
    console.error(`[File Controller] Error serving "${targetKey}":`, error.message);
    res.status(404);
    return next(new Error('File not found or failed to decrypt'));
  }
};

export default serveGridFsFile;
