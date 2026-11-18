import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  generateOtpEmailHtml,
  generateApplicationSubmittedEmailHtml,
  generatePaymentConfirmationEmailHtml,
} from './services/emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.join(__dirname, 'email-previews');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// 1. Generate OTP verification email preview
const otpHtml = generateOtpEmailHtml({
  otpCode: '380982',
  expiresInMinutes: 5,
});
fs.writeFileSync(path.join(outputDir, 'otp-verification.html'), otpHtml, 'utf8');

// 2. Generate Application Submitted email preview
const appSubmittedHtml = generateApplicationSubmittedEmailHtml({
  customerName: 'MAHALINGAM DAWANHAREN',
  referenceNumber: 'REQ-47991255',
  serviceType: 'new-connection',
  phone: '0774409720',
  submittedAt: new Date(),
  requiresPayment: false,
});
fs.writeFileSync(path.join(outputDir, 'application-submitted.html'), appSubmittedHtml, 'utf8');

// 3. Generate Payment Confirmation email preview
const paymentHtml = generatePaymentConfirmationEmailHtml({
  customerName: 'MAHALINGAM DAWANHAREN',
  referenceNumber: 'REQ-47991255',
  orderId: 'PAY-8923412',
  amount: 2500,
  serviceType: 'new-connection',
  paidAt: new Date(),
});
fs.writeFileSync(path.join(outputDir, 'payment-confirmation.html'), paymentHtml, 'utf8');

// 4. Generate Interactive Preview Dashboard (index.html)
const dashboardHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SLTMobitel Email Template Previews</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0b1120; color: #f8fafc; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
    .header { background: #1e293b; border-bottom: 1px solid #334155; padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    .brand { font-size: 16px; font-weight: 800; color: #ffffff; letter-spacing: 0.5px; }
    .brand span { color: #00d285; }
    .nav { display: flex; gap: 8px; }
    .nav button { padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; border-radius: 6px; color: #94a3b8; background: #0f172a; border: 1px solid #334155; transition: all 0.2s ease; }
    .nav button:hover { color: #ffffff; border-color: #64748b; }
    .nav button.active { background: #0056b3; color: #ffffff; border-color: #0056b3; }
    .vp-controls { display: flex; gap: 8px; align-items: center; }
    .vp-btn { padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 6px; color: #94a3b8; background: #0f172a; border: 1px solid #334155; }
    .vp-btn.active { background: #0284c7; color: #ffffff; border-color: #0284c7; }
    .stage { flex: 1; display: flex; align-items: center; justify-content: center; padding: 20px; overflow: auto; background: #070d19; }
    .frame-box { width: 640px; height: 95%; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.6); overflow: hidden; transition: width 0.3s ease; }
    iframe { width: 100%; height: 100%; border: none; }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">SLT<span>MOBITEL</span> EasyApply &bull; <small style="font-weight: 400; color: #94a3b8;">Email Previews</small></div>
    <div class="nav">
      <button class="active" onclick="switchTab('otp')">1. OTP Verification</button>
      <button onclick="switchTab('app')">2. Application Received</button>
      <button onclick="switchTab('pay')">3. Payment Confirmed</button>
    </div>
    <div class="vp-controls">
      <span style="font-size: 12px; color: #64748b;">Viewport:</span>
      <button class="vp-btn active" id="vp-desktop" onclick="setViewport('640px')">Desktop (640px)</button>
      <button class="vp-btn" id="vp-mobile" onclick="setViewport('380px')">Mobile (380px)</button>
    </div>
  </div>

  <div class="stage">
    <div class="frame-box" id="frameBox">
      <iframe id="previewFrame" src="otp-verification.html"></iframe>
    </div>
  </div>

  <script>
    const files = {
      otp: 'otp-verification.html',
      app: 'application-submitted.html',
      pay: 'payment-confirmation.html'
    };

    function switchTab(type) {
      document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById('previewFrame').src = files[type];
    }

    function setViewport(w) {
      document.getElementById('frameBox').style.width = w;
      document.getElementById('vp-desktop').classList.toggle('active', w === '640px');
      document.getElementById('vp-mobile').classList.toggle('active', w === '380px');
    }
  </script>
</body>
</html>`;
fs.writeFileSync(path.join(outputDir, 'index.html'), dashboardHtml, 'utf8');

console.log('✅ Generated standalone email template previews in:');
console.log('   ', outputDir);
