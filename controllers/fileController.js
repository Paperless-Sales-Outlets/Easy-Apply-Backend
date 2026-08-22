import mongoose from 'mongoose';
import { GridFSBucket } from 'mongodb';
import { ObjectId } from 'bson';
import path from 'path';
import fs from 'fs';

// MIME type map for common document extensions
const MIME_TYPES = {
  '.pdf':  'application/pdf',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
};

// ---------------------------------------------------------------------------
// @desc  Stream a file out of MongoDB GridFS by its ObjectId
// @route GET /api/files/:id
// @access Protected (Admin / Staff) — apply authMiddleware in the router
// ---------------------------------------------------------------------------
export const serveGridFsFile = async (req, res, next) => {
  const { id } = req.params;

  // Basic ObjectId shape check
  if (!ObjectId.isValid(id)) {
    res.status(400);
    return next(new Error('Invalid file ID'));
  }

  if (mongoose.connection.readyState !== 1) {
    res.status(503);
    return next(new Error('Database is not connected'));
  }

  try {
    const bucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: 'uploads',
    });

    const objectId = new ObjectId(id);

    // Look up the file metadata first so we can set the correct Content-Type
    const files = await bucket.find({ _id: objectId }).toArray();

    if (!files || files.length === 0) {
      res.status(404);
      return next(new Error('File not found'));
    }

    const file = files[0];
    const ext = path.extname(file.filename || '').toLowerCase();
    const contentType =
      file.metadata?.mimetype ||
      MIME_TYPES[ext] ||
      'application/octet-stream';

    // Stream the file directly to the HTTP response
    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${file.filename}"`
    );

    const downloadStream = bucket.openDownloadStream(objectId);

    downloadStream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500);
        next(new Error(`File streaming error: ${err.message}`));
      }
    });

    downloadStream.pipe(res);

  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------------------------
// @desc  Delete a file from GridFS by its ObjectId (admin clean-up)
// @route DELETE /api/files/:id
// @access Protected (Admin only)
// ---------------------------------------------------------------------------
export const deleteGridFsFile = async (req, res, next) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    res.status(400);
    return next(new Error('Invalid file ID'));
  }

  if (mongoose.connection.readyState !== 1) {
    res.status(503);
    return next(new Error('Database is not connected'));
  }

  try {
    const bucket = new GridFSBucket(mongoose.connection.db, {
      bucketName: 'uploads',
    });

    await bucket.delete(new ObjectId(id));

    res.status(200).json({ success: true, message: 'File deleted' });
  } catch (error) {
    next(error);
  }
};
