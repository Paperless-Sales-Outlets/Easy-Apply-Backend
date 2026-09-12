import { getPrivacyNotice } from '../services/consentHubService.js';

// @desc    Get privacy notice configuration from ConsentHub
// @route   GET /api/consent/config
// @access  Public
export const getConsentConfig = async (req, res, next) => {
  try {
    const { serviceType = 'new-connection', language = 'en' } = req.query;

    if (serviceType !== 'new-connection') {
      return res.status(400).json({ error: 'Only new-connection is supported for now' });
    }

    const config = await getPrivacyNotice(serviceType, language);
    
    res.status(200).json({
      success: true,
      data: config
    });
  } catch (error) {
    // If ConsentHub fails, we shouldn't crash the whole wizard, maybe just return a fallback or error
    console.error('[consentController] getConsentConfig error:', error.message);
    res.status(502).json({
      success: false,
      error: 'Failed to retrieve privacy notice configuration from ConsentHub.'
    });
  }
};
