import express from 'express';
import { fetchConsentCatalog, consentHubConfigured } from '../services/consentHubService.js';

const router = express.Router();

// GET /api/consents/catalog -> the Easy Apply consents published in ConsentHub
router.get('/catalog', async (req, res) => {
  if (!consentHubConfigured()) return res.status(503).json({ success: false, message: 'Consent service is not configured.' });
  try {
    res.json({ success: true, data: await fetchConsentCatalog() });
  } catch (err) {
    console.error('ConsentHub catalog failed:', err.message);
    res.status(502).json({ success: false, message: 'Could not load consents. Please try again.' });
  }
});

export default router;
