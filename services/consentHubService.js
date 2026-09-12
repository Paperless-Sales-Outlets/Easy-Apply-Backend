const getBaseUrl = () => process.env.CONSENT_HUB_BASE_URL || 'http://localhost:4000';
const getToken = () => process.env.CONSENT_HUB_SERVICE_TOKEN;
const getTimeout = () => parseInt(process.env.CONSENT_HUB_TIMEOUT_MS || '10000', 10);

export const getPrivacyNotice = async (serviceType = 'new-connection', language = 'en') => {
  const url = `${getBaseUrl()}/api/v1/integrations/easyapply/privacy-notice?serviceType=${serviceType}&language=${language}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getTimeout());

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Accept': 'application/json'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`ConsentHub API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('[ConsentHubService] getPrivacyNotice error:', error.message);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const captureConsent = async (consentPayload, idempotencyKey) => {
  const url = `${getBaseUrl()}/api/v1/integrations/easyapply/consents`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getTimeout());

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getToken()}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
        'Accept': 'application/json'
      },
      body: JSON.stringify(consentPayload),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`ConsentHub API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('[ConsentHubService] captureConsent error:', error.message);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};
