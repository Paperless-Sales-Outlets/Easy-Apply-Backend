const getBaseUrl = () => process.env.CONSENT_HUB_BASE_URL || 'http://localhost:4000';
const getToken = () => process.env.CONSENT_HUB_SERVICE_TOKEN;
const getTimeout = () => parseInt(process.env.CONSENT_HUB_TIMEOUT_MS || '10000', 10);

export const getPrivacyNotice = async (serviceType = 'new-connection', language = 'en') => {
  const url = `${getBaseUrl()}/api/v1/integrations/easyapply/privacy-notices/active?serviceType=${serviceType}&language=${language}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), getTimeout());
  
  const token = getToken();
  console.log(`[Diagnostic] Outgoing Request: GET ${url}`);
  console.log(`[Diagnostic] serviceType: ${serviceType}`);
  console.log(`[Diagnostic] Token configured: ${!!token}, Length: ${token ? token.length : 0}`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const err = new Error(`ConsentHub API Error: ${response.status} ${response.statusText}`);
      err.status = response.status;
      err.upstreamBody = errorBody;
      throw err;
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
