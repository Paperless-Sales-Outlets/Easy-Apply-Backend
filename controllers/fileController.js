import { Readable } from 'node:stream';
import { getSignedFileUrl } from '../services/storageService.js';

// ---------------------------------------------------------------------------
// @desc  Stream a stored KYC file (NIC photo, selfie, signature) from object storage
// @route GET /api/files/:id
// @access Protected (Admin / Staff)
//
// The file is fetched server-side and streamed back. Redirecting the browser to the
// signed storage URL does not work for the admin app: its request carries credentials,
// and the storage host answers CORS with a wildcard origin, which browsers reject.
// ---------------------------------------------------------------------------
export const serveGridFsFile = async (req, res, next) => {
  const { id } = req.params;

  if (!id) {
    res.status(400);
    return next(new Error('Invalid file ID or key'));
  }

  try {
    const fileUrl = await getSignedFileUrl(id, 300);
    if (!fileUrl || !/^https?:\/\//.test(fileUrl)) {
      res.status(404);
      return next(new Error('File not found in storage'));
    }

    const upstream = await fetch(fileUrl, { signal: AbortSignal.timeout(20000) });
    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status === 404 || upstream.status === 400 ? 404 : 502);
      return next(new Error(
        upstream.status === 404 || upstream.status === 400
          ? 'File not found in storage'
          : `Storage responded with status ${upstream.status}`
      ));
    }

    res.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    const length = upstream.headers.get('content-length');
    if (length) res.set('Content-Length', length);
    res.set('Cache-Control', 'private, max-age=300');

    // Stop reading from storage if the browser goes away mid-download.
    const body = Readable.fromWeb(upstream.body);
    res.on('close', () => body.destroy());
    body.on('error', next);
    return body.pipe(res);
  } catch (error) {
    next(error);
  }
};

export default serveGridFsFile;
