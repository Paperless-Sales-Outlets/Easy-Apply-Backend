// Talks to the ConsentHub (CMS) integration API. The API key stays here, never in the browser.
import mongoose from 'mongoose';

// The CMS has no "create customer" API: it reads customers from SLT's CRM store, so the applicant is registered there
// (ponytail: direct write to the CRM stand-in collection; switch to the CRM API when the CMS gateway moves to it).
let crmCustomers;
const crmCollection = () => {
  if (!crmCustomers) crmCustomers = mongoose.createConnection(process.env.CONSENT_HUB_CRM_MONGODB_URI).collection('customer');
  return crmCustomers;
};

/** Makes sure the applicant exists in the CRM and returns the customerId to send to the CMS (an existing customer with this NIC keeps their id). */
export async function registerCustomer({ nic, name, phone, email }) {
  const cleanNic = String(nic || '').trim().toUpperCase();
  if (!cleanNic || !process.env.CONSENT_HUB_CRM_MONGODB_URI) return cleanNic;
  try {
    const crm = crmCollection();
    const existing = await crm.findOne({ customerNic: cleanNic });
    if (existing) return existing.customerId;
    await crm.updateOne(
      { customerId: cleanNic },
      { $setOnInsert: { customerId: cleanNic, customerNic: cleanNic, customerName: name || '', customerPhone: phone || '', customerEmail: email || '', services: [], createdDate: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    console.error(`ConsentHub: could not register customer ${cleanNic}: ${err.message}`);
  }
  return cleanNic;
}
const base = () => `${(process.env.CONSENT_HUB_URL || '').replace(/\/$/, '')}/api/v1/integration/consents`;
const headers = () => ({ 'x-api-key': process.env.CONSENT_HUB_API_KEY || '', 'Content-Type': 'application/json' });

export const consentHubConfigured = () => Boolean(process.env.CONSENT_HUB_URL && process.env.CONSENT_HUB_API_KEY);

export async function fetchConsentCatalog() {
  const res = await fetch(`${base()}/catalog`, { headers: headers(), signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw new Error(body.message || `ConsentHub responded ${res.status}`);
  return body.data;
}

/**
 * Records an "accept" for each consent code. Never throws: a CMS outage must not lose an application.
 * `verifiedEmail` = the customer's email, only when it is the one they verified by OTP at sign-up; the CMS then shows it
 * with the consent (ponytail: the OTP times are the acceptance time, Easy Apply does not keep the original OTP times).
 */
export async function recordConsentAcceptances(customerId, consentCodes, { ipAddress, userAgent, verifiedEmail } = {}) {
  if (!consentHubConfigured() || !customerId || !Array.isArray(consentCodes)) return;
  const occurredAt = new Date().toISOString();
  const verification = verifiedEmail ? { method: 'EMAIL_OTP', email: verifiedEmail, otpSentAt: occurredAt, otpVerifiedAt: occurredAt } : undefined;
  await Promise.all(consentCodes.map(async (consentCode) => {
    try {
      const res = await fetch(`${base()}/events`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ customerId: String(customerId), consentCode, action: 'accept', channel: 'web', occurredAt, verification, ipAddress, userAgent }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) console.error(`ConsentHub: ${consentCode} for ${customerId} -> HTTP ${res.status}`);
    } catch (err) {
      console.error(`ConsentHub: ${consentCode} for ${customerId} failed: ${err.message}`);
    }
  }));
}
