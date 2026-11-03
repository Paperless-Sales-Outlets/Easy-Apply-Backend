import path from 'path';
import { getSignedFileUrl, getStorageClient } from '../services/storageService.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';

// MIME type map for common document extensions
const MIME_TYPES = {
  '.pdf':  'application/pdf',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
};

// ---------------------------------------------------------------------------
// @desc  Serve/redirect a file from central object storage
// @route GET /api/files/:id
// @access Protected (Admin / Staff)
// ---------------------------------------------------------------------------
export const serveGridFsFile = async (req, res, next) => {
  const { id } = req.params;

  if (!id) {
    res.status(400);
    return next(new Error('Invalid file ID or key'));
  }

  try {
    // Generate signed S3 / Supabase storage URL
    const fileUrl = await getSignedFileUrl(id, 3600);

    if (fileUrl && /^https?:\/\//.test(fileUrl)) {
      // Redirect directly to the signed cloud storage URL
      return res.redirect(fileUrl);
    }

    res.status(404);
    return next(new Error('File not found in storage'));
  } catch (error) {
    next(error);
  }
};

export default serveGridFsFile;
