/**
 * Legacy S3 service wrapper.
 * Re-exports the unified Supabase / Central Object Storage service.
 */
import storageService, {
  getSignedFileUrl,
  getStorageClient,
  uploadBuffer,
  deleteFile,
  isStorageConfigured,
} from './storageService.js';

export {
  getSignedFileUrl,
  getStorageClient,
  uploadBuffer,
  deleteFile,
  isStorageConfigured,
};

export default storageService;
