import nodemailer from 'nodemailer';

// ─────────────────────────────────────────────────────────────
// Demo recipient addresses — all emails CC'd here for testing
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Transporter — use env SMTP creds when provided,
// otherwise auto-create an Ethereal test account (demo mode).
// ─────────────────────────────────────────────────────────────
let _transporter = null;

async function getTransporter() {
  if (_transporter) return _transporter;

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    _transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    console.log(`\n📧 Nodemailer: using SMTP host ${process.env.SMTP_HOST}\n`);
  } else {
    const testAccount = await nodemailer.createTestAccount();
    _transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    console.log('\n📧 Nodemailer: running in DEMO mode via Ethereal Email.');
    console.log(`   Ethereal user: ${testAccount.user}`);
    console.log('   All sent emails captured at https://ethereal.email\n');
  }

  return _transporter;
}

// ─────────────────────────────────────────────────────────────
// Shared UI helpers
// ─────────────────────────────────────────────────────────────
function formatServiceLabel(serviceType) {
  const map = {
    'new-connection': 'New Connection',
    'reconnection': 'Reconnection',
    'relocation': 'Relocation',
    'termination': 'Service Termination',
    'transfer': 'Ownership Transfer',
    'package-migration': 'Package Migration',
    'service-vacation': 'Service Vacation',
    'refund-request': 'Refund Request',
    'customer-request-acceptance': 'Customer Request',
    'internet-services': 'Internet Services',
    'appointment-booking': 'Appointment Booking',
  };
  return map[serviceType] || (serviceType || 'Service').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatAmountLKR(amount) {
  return `LKR ${parseFloat(amount || 0).toLocaleString('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(date) {
  return new Date(date || Date.now()).toLocaleString('en-LK', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo',
  });
}

// ─────────────────────────────────────────────────────────────
// Shared email shell (header + footer wrapper)
// ─────────────────────────────────────────────────────────────
function emailShell({ subject, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>${subject}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#f1f5f9;color:#1e293b;-webkit-font-smoothing:antialiased}
    .wrap{max-width:600px;margin:28px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,86,179,.10)}
    .hdr{background:linear-gradient(135deg,#003b73 0%,#0056b3 60%,#0284c7 100%);padding:28px 32px 24px;text-align:center}
    .brand{font-size:20px;font-weight:900;color:#fff;letter-spacing:.04em}
    .brand span{color:#34d399}
    .tagline{font-size:11px;color:rgba(255,255,255,.7);margin-top:3px;letter-spacing:.08em;text-transform:uppercase}
    .body{padding:28px 32px}
    .ftr{background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 32px;text-align:center}
    .ftr p{font-size:11px;color:#94a3b8;line-height:1.6}
    .ftr strong{color:#0056b3}
    @media(max-width:600px){
      .wrap{margin:0;border-radius:0;box-shadow:none}
      .hdr,.body,.ftr{padding:20px 16px}
    }
  </style>
</head>
<body>
<div class="wrap">
  <div class="hdr">
    <div class="brand">SLT<span>MOBITEL</span> EasyApply</div>
    <div class="tagline">Digital Service Portal — Official Notification</div>
  </div>
  <div class="body">${bodyHtml}</div>
  <div class="ftr">
    <p>Customer Helpline: <strong>1212</strong> &nbsp;|&nbsp; Web: <strong>sltmobitel.lk</strong></p>
    <p style="margin-top:6px">&copy; ${new Date().getFullYear()} Sri Lanka Telecom PLC. All rights reserved.<br/>This is an automated message — please do not reply.</p>
  </div>
</div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// 1. PAYMENT CONFIRMATION EMAIL
//    Triggered: PayHere IPN status_code=2 (and cart checkout)
// ─────────────────────────────────────────────────────────────
function buildPaymentConfirmationBody({ customerName, referenceNumber, orderId, amount, currency, serviceType, paidAt }) {
  const displayRef = referenceNumber || orderId || '—';
  const displayName = customerName || 'Valued Customer';

  return `
  <style>
    .sc{display:inline-block;background:#dcfce7;border-radius:50%;width:64px;height:64px;line-height:64px;text-align:center;margin:0 auto 16px;font-size:32px}
    .stitle{font-size:20px;font-weight:900;color:#0f172a;text-align:center;margin-bottom:6px}
    .ssub{font-size:14px;color:#64748b;text-align:center;line-height:1.55;margin-bottom:20px}
    .ref-box{background:#f0f9ff;border:1.5px dashed #0284c7;border-radius:12px;padding:16px 20px;text-align:center;margin-bottom:20px}
    .ref-lbl{font-size:10px;color:#0284c7;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px}
    .ref-val{font-size:24px;font-weight:900;color:#0056b3;letter-spacing:1px}
    .details{border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:20px}
    .details table{width:100%;border-collapse:collapse}
    .details td{padding:11px 16px;font-size:13px;border-bottom:1px solid #f1f5f9}
    .details tr:last-child td{border-bottom:none}
    .lbl{color:#64748b;font-weight:700;width:44%}
    .val{color:#0f172a;font-weight:600}
    .amt{color:#16a34a!important;font-weight:900!important;font-size:15px!important}
    .notice{background:#fefce8;border-left:4px solid #f59e0b;border-radius:0 10px 10px 0;padding:12px 16px;font-size:13px;color:#78350f;line-height:1.6}
  </style>
  <div style="text-align:center"><div class="sc">✅</div></div>
  <div class="stitle">Payment Confirmed! 🎉</div>
  <div class="ssub">Dear <strong>${displayName}</strong>, your payment has been received and your application is confirmed.</div>

  <div class="ref-box">
    <div class="ref-lbl">Application Reference Number</div>
    <div class="ref-val">${displayRef}</div>
  </div>

  <div class="details">
    <table>
      <tr><td class="lbl">Service</td><td class="val">${formatServiceLabel(serviceType)}</td></tr>
      <tr><td class="lbl">Amount Paid</td><td class="val amt">${formatAmountLKR(amount)}</td></tr>
      <tr><td class="lbl">Payment Date</td><td class="val">${formatDate(paidAt)}</td></tr>
      <tr><td class="lbl">Order ID</td><td class="val">${orderId || displayRef}</td></tr>
      <tr><td class="lbl">Status</td><td class="val" style="color:#16a34a;font-weight:900">✔ Paid &amp; Confirmed</td></tr>
    </table>
  </div>

  <div class="notice">
    <strong>📌 Keep this for your records.</strong><br/>
    Quote reference <strong>${displayRef}</strong> for all inquiries.
    You will receive an SMS once your service is activated (within 24–48 hours).
    For urgent support call <strong>1212</strong> or visit your nearest SLT Teleshop.
  </div>`;
}

// ─────────────────────────────────────────────────────────────
// 2. APPLICATION SUBMITTED EMAIL
//    Triggered: Every wizard/service form submission
// ─────────────────────────────────────────────────────────────
function buildApplicationSubmittedBody({ customerName, referenceNumber, serviceType, phone, submittedAt, requiresPayment }) {
  const displayRef = referenceNumber || '—';
  const displayName = customerName || 'Valued Customer';

  return `
  <style>
    .icon-ring{display:inline-block;background:#dbeafe;border-radius:50%;width:64px;height:64px;line-height:64px;text-align:center;margin:0 auto 16px;font-size:28px}
    .stitle{font-size:20px;font-weight:900;color:#0f172a;text-align:center;margin-bottom:6px}
    .ssub{font-size:14px;color:#64748b;text-align:center;line-height:1.55;margin-bottom:20px}
    .ref-box{background:#f0f9ff;border:1.5px dashed #0284c7;border-radius:12px;padding:16px 20px;text-align:center;margin-bottom:20px}
    .ref-lbl{font-size:10px;color:#0284c7;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px}
    .ref-val{font-size:24px;font-weight:900;color:#0056b3;letter-spacing:1px}
    .details{border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:20px}
    .details table{width:100%;border-collapse:collapse}
    .details td{padding:11px 16px;font-size:13px;border-bottom:1px solid #f1f5f9}
    .details tr:last-child td{border-bottom:none}
    .lbl{color:#64748b;font-weight:700;width:44%}
    .val{color:#0f172a;font-weight:600}
    .timeline{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:20px}
    .tl-row{display:flex;align-items:center;gap:10px;margin-bottom:12px;font-size:13px}
    .tl-row:last-child{margin-bottom:0}
    .tl-dot{width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;flex-shrink:0}
    .notice{background:#f0fdf4;border-left:4px solid #16a34a;border-radius:0 10px 10px 0;padding:12px 16px;font-size:13px;color:#14532d;line-height:1.6}
    .pay-notice{background:#fefce8;border-left:4px solid #f59e0b;border-radius:0 10px 10px 0;padding:12px 16px;font-size:13px;color:#78350f;line-height:1.6;margin-top:12px}
  </style>
  <div style="text-align:center"><div class="icon-ring">📋</div></div>
  <div class="stitle">Application Submitted!</div>
  <div class="ssub">Dear <strong>${displayName}</strong>, your SLTMobitel service request has been received and is now under review.</div>

  <div class="ref-box">
    <div class="ref-lbl">Application Reference Number</div>
    <div class="ref-val">${displayRef}</div>
  </div>

  <div class="details">
    <table>
      <tr><td class="lbl">Service Requested</td><td class="val">${formatServiceLabel(serviceType)}</td></tr>
      <tr><td class="lbl">Contact Number</td><td class="val">+94${phone || '—'}</td></tr>
      <tr><td class="lbl">Submitted On</td><td class="val">${formatDate(submittedAt)}</td></tr>
      <tr><td class="lbl">Status</td><td class="val" style="color:#0284c7;font-weight:900">📝 Under Review</td></tr>
    </table>
  </div>

  <div class="timeline">
    <div style="font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.05em;margin-bottom:12px">Processing Timeline</div>
    <div class="tl-row">
      <div class="tl-dot" style="background:#10b981;color:#fff">✓</div>
      <div style="flex:1;font-weight:700;color:#0f172a">Application Logged &amp; Received</div>
      <span style="font-size:11px;color:#15803d;font-weight:800;background:#dcfce7;padding:2px 8px;border-radius:20px">Done</span>
    </div>
    <div class="tl-row">
      <div class="tl-dot" style="background:#0284c7;color:#fff">⏱</div>
      <div style="flex:1;font-weight:700;color:#0f172a">Technical Verification &amp; Dispatch</div>
      <span style="font-size:11px;color:#0369a1;font-weight:800;background:#e0f2fe;padding:2px 8px;border-radius:20px">24–48 hrs</span>
    </div>
    <div class="tl-row">
      <div class="tl-dot" style="background:#cbd5e1;color:#fff">○</div>
      <div style="flex:1;font-weight:600;color:#64748b">SMS Notification &amp; Activation</div>
      <span style="font-size:11px;color:#64748b;font-weight:700;background:#f1f5f9;padding:2px 8px;border-radius:20px">Pending</span>
    </div>
  </div>

  <div class="notice">
    <strong>✅ What happens next?</strong><br/>
    Quote reference <strong>${displayRef}</strong> for any inquiry.
    Our team will contact you within 24–48 hours.
    For urgent support call <strong>1212</strong>.
  </div>
  ${requiresPayment ? `<div class="pay-notice"><strong>💳 Payment Required:</strong><br/>Your application requires payment to proceed. Please complete payment via the portal to activate your service.</div>` : ''}`;
}

// ─────────────────────────────────────────────────────────────
// Internal send helper
// ─────────────────────────────────────────────────────────────
async function _send({ to, subject, html }) {
  if (!to) {
    console.warn('⚠️  [emailService] No recipient — skipping email.');
    return;
  }

  try {
    const transporter = await getTransporter();
    const from = process.env.SMTP_FROM || '"SLTMobitel EasyApply" <noreply@sltmobitel.lk>';

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      html,
    });

    console.log(`\n📧 Email sent → ${to}`);
    console.log(`   Subject    : ${subject}`);
    console.log(`   Message ID : ${info.messageId}`);
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) console.log(`   📬 PREVIEW : ${preview}\n`);
    else console.log('   Delivered via real SMTP.\n');
  } catch (err) {
    console.error(`\n❌ [emailService] Send failed (${to}): ${err.message}\n`);
  }
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Send payment confirmation email (after PayHere IPN or cart checkout).
 */
export async function sendPaymentConfirmationEmail({
  to, customerName, referenceNumber, orderId, amount, currency = 'LKR', serviceType, paidAt,
}) {
  const subject = `✅ Payment Confirmed — Ref: ${referenceNumber || orderId}`;
  const html = emailShell({
    subject,
    bodyHtml: buildPaymentConfirmationBody({ customerName, referenceNumber, orderId, amount, currency, serviceType, paidAt }),
  });
  await _send({ to, subject, html });
}

/**
 * Send application submitted email (after any wizard submits to /api/applications).
 */
export async function sendApplicationSubmittedEmail({
  to, customerName, referenceNumber, serviceType, phone, submittedAt, requiresPayment = false,
}) {
  const subject = `📋 Application Received — Ref: ${referenceNumber}`;
  const html = emailShell({
    subject,
    bodyHtml: buildApplicationSubmittedBody({ customerName, referenceNumber, serviceType, phone, submittedAt, requiresPayment }),
  });
  await _send({ to, subject, html });
}
