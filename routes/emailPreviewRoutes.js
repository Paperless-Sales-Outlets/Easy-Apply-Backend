import express from 'express';
import {
  generateOtpEmailHtml,
  generateApplicationSubmittedEmailHtml,
  generatePaymentConfirmationEmailHtml,
} from '../services/emailService.js';

const router = express.Router();

/**
 * Interactive preview dashboard where the developer/user can inspect all email templates,
 * toggle between templates, and switch between desktop and mobile viewport widths.
 */
router.get('/', (req, res) => {
  const currentTab = req.query.tab || 'otp';
  const viewport = req.query.viewport === 'mobile' ? '380px' : '640px';

  let previewHtml = '';
  if (currentTab === 'application-submitted') {
    previewHtml = generateApplicationSubmittedEmailHtml({
      customerName: 'MAHALINGAM DAWANHAREN',
      referenceNumber: 'REQ-47991255',
      serviceType: 'new-connection',
      phone: '0774409720',
      submittedAt: new Date(),
      requiresPayment: false,
    });
  } else if (currentTab === 'payment-confirmation') {
    previewHtml = generatePaymentConfirmationEmailHtml({
      customerName: 'MAHALINGAM DAWANHAREN',
      referenceNumber: 'REQ-47991255',
      orderId: 'PAY-8923412',
      amount: 2500,
      serviceType: 'new-connection',
      paidAt: new Date(),
    });
  } else {
    previewHtml = generateOtpEmailHtml({
      otpCode: '380982',
      expiresInMinutes: 5,
    });
  }

  // Wrap in a sleek toolbar interface for browser preview
  const dashboardHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SLTMobitel Email Template Previewer</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
    .top-bar { background: #1e293b; border-bottom: 1px solid #334155; padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    .brand-title { font-size: 16px; font-weight: 700; color: #ffffff; display: flex; align-items: center; gap: 8px; }
    .brand-pill { background: #0056b3; color: #ffffff; font-size: 11px; padding: 2px 8px; border-radius: 6px; font-weight: 600; text-transform: uppercase; }
    .nav-tabs { display: flex; gap: 8px; }
    .nav-tab { padding: 8px 16px; font-size: 13px; font-weight: 600; text-decoration: none; border-radius: 6px; color: #94a3b8; background: #0f172a; border: 1px solid #334155; transition: all 0.2s; }
    .nav-tab:hover { color: #ffffff; border-color: #64748b; }
    .nav-tab.active { background: #0056b3; color: #ffffff; border-color: #0056b3; }
    .viewport-controls { display: flex; gap: 6px; align-items: center; }
    .vp-btn { padding: 6px 12px; font-size: 12px; font-weight: 600; text-decoration: none; border-radius: 6px; color: #94a3b8; background: #0f172a; border: 1px solid #334155; }
    .vp-btn.active { background: #0284c7; color: #ffffff; border-color: #0284c7; }
    .preview-stage { flex: 1; background: #0b1120; display: flex; align-items: center; justify-content: center; padding: 20px; overflow: auto; }
    .iframe-wrapper { width: ${viewport}; height: 95%; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); overflow: hidden; transition: width 0.3s ease; }
    iframe { width: 100%; height: 100%; border: none; }
  </style>
</head>
<body>
  <div class="top-bar">
    <div class="brand-title">
      <span>SLTMOBITEL</span>
      <span class="brand-pill">Email Templates</span>
    </div>

    <div class="nav-tabs">
      <a href="?tab=otp&viewport=${req.query.viewport || 'desktop'}" class="nav-tab ${currentTab === 'otp' ? 'active' : ''}">
        1. OTP Verification
      </a>
      <a href="?tab=application-submitted&viewport=${req.query.viewport || 'desktop'}" class="nav-tab ${currentTab === 'application-submitted' ? 'active' : ''}">
        2. Application Received
      </a>
      <a href="?tab=payment-confirmation&viewport=${req.query.viewport || 'desktop'}" class="nav-tab ${currentTab === 'payment-confirmation' ? 'active' : ''}">
        3. Payment Confirmed
      </a>
    </div>

    <div class="viewport-controls">
      <span style="font-size: 12px; color: #64748b; margin-right: 4px;">Viewport:</span>
      <a href="?tab=${currentTab}&viewport=desktop" class="vp-btn ${viewport === '640px' ? 'active' : ''}">Desktop (640px)</a>
      <a href="?tab=${currentTab}&viewport=mobile" class="vp-btn ${viewport === '380px' ? 'active' : ''}">Mobile (380px)</a>
      <a href="/api/email-preview/raw/${currentTab}" target="_blank" class="vp-btn" style="color: #38bdf8;">Open Raw &nearr;</a>
    </div>
  </div>

  <div class="preview-stage">
    <div class="iframe-wrapper">
      <iframe srcdoc="${previewHtml.replace(/"/g, '&quot;')}" title="Email Preview"></iframe>
    </div>
  </div>
</body>
</html>`;

  res.send(dashboardHtml);
});

/**
 * Raw HTML endpoints to view the standalone email directly
 */
router.get('/raw/otp', (req, res) => {
  const code = req.query.code || '380982';
  const html = generateOtpEmailHtml({ otpCode: code });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

router.get('/raw/application-submitted', (req, res) => {
  const html = generateApplicationSubmittedEmailHtml({
    customerName: req.query.name || 'MAHALINGAM DAWANHAREN',
    referenceNumber: req.query.ref || 'REQ-47991255',
    serviceType: req.query.service || 'new-connection',
    phone: req.query.phone || '0774409720',
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

router.get('/raw/payment-confirmation', (req, res) => {
  const html = generatePaymentConfirmationEmailHtml({
    customerName: req.query.name || 'MAHALINGAM DAWANHAREN',
    referenceNumber: req.query.ref || 'REQ-47991255',
    amount: req.query.amount || 2500,
  });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

export default router;
