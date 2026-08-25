import nodemailer from 'nodemailer';

// ─────────────────────────────────────────────────────────────
// Transporter — use env SMTP creds when provided,
// otherwise auto-create an Ethereal test account (demo mode).
// Preview URL is logged to the console after every send.
// ─────────────────────────────────────────────────────────────

let _transporter = null;

async function getTransporter() {
  if (_transporter) return _transporter;

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    // Real SMTP (Gmail, SendGrid, etc.)
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
    // Demo mode — Ethereal catch-all (no real email sent)
    const testAccount = await nodemailer.createTestAccount();
    _transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });

    console.log('\n📧 Nodemailer: running in DEMO mode via Ethereal Email.');
    console.log(`   Ethereal user: ${testAccount.user}`);
    console.log('   All sent emails are captured at https://ethereal.email (no real delivery)\n');
  }

  return _transporter;
}

// ─────────────────────────────────────────────────────────────
// Build a premium HTML email body
// ─────────────────────────────────────────────────────────────
function buildPaymentConfirmationHtml({
  customerName,
  referenceNumber,
  orderId,
  amount,
  currency,
  serviceType,
  paidAt,
}) {
  const displayService = serviceType
    ? serviceType.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'SLTMobitel Service';

  const displayAmount = `${currency || 'LKR'} ${parseFloat(amount || 0).toLocaleString('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const displayDate = new Date(paidAt || Date.now()).toLocaleString('en-LK', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Colombo',
  });

  const displayRef = referenceNumber || orderId || '—';
  const displayName = customerName || 'Valued Customer';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Payment Confirmed — SLTMobitel EasyApply</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background-color: #f1f5f9;
      color: #1e293b;
    }
    .wrapper {
      max-width: 600px;
      margin: 32px auto;
      background: #ffffff;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 8px 40px rgba(0, 86, 179, 0.10);
    }
    /* ── Header banner ── */
    .header {
      background: linear-gradient(135deg, #003b73 0%, #0056b3 60%, #0284c7 100%);
      padding: 32px 36px 28px;
      text-align: center;
    }
    .header .brand {
      font-size: 22px;
      font-weight: 900;
      color: #ffffff;
      letter-spacing: 0.04em;
    }
    .header .brand span { color: #34d399; }
    .header .tagline {
      font-size: 12px;
      color: rgba(255,255,255,0.75);
      margin-top: 4px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    /* ── Success icon row ── */
    .success-icon-row {
      text-align: center;
      padding: 32px 36px 0;
    }
    .success-circle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 72px;
      height: 72px;
      background: #dcfce7;
      border-radius: 50%;
      margin-bottom: 16px;
    }
    .success-circle svg { width: 36px; height: 36px; stroke: #16a34a; fill: none; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
    .success-title {
      font-size: 22px;
      font-weight: 900;
      color: #0f172a;
      margin-bottom: 6px;
    }
    .success-sub {
      font-size: 14px;
      color: #64748b;
      line-height: 1.55;
    }
    /* ── Reference box ── */
    .ref-box {
      margin: 24px 36px;
      background: #f0f9ff;
      border: 1.5px dashed #0284c7;
      border-radius: 14px;
      padding: 20px 24px;
      text-align: center;
    }
    .ref-label {
      font-size: 11px;
      color: #0284c7;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      margin-bottom: 6px;
    }
    .ref-value {
      font-size: 26px;
      font-weight: 900;
      color: #0056b3;
      letter-spacing: 1px;
    }
    /* ── Details table ── */
    .details {
      margin: 0 36px 24px;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      overflow: hidden;
    }
    .details table { width: 100%; border-collapse: collapse; }
    .details td {
      padding: 13px 18px;
      font-size: 14px;
      border-bottom: 1px solid #f1f5f9;
    }
    .details tr:last-child td { border-bottom: none; }
    .details .lbl { color: #64748b; font-weight: 700; width: 42%; }
    .details .val { color: #0f172a; font-weight: 600; }
    .amount-val { color: #16a34a !important; font-weight: 900 !important; font-size: 16px !important; }
    /* ── Notice box ── */
    .notice {
      margin: 0 36px 24px;
      background: #fefce8;
      border-left: 4px solid #f59e0b;
      border-radius: 0 10px 10px 0;
      padding: 14px 18px;
      font-size: 13px;
      color: #78350f;
      line-height: 1.6;
    }
    .notice strong { color: #92400e; }
    /* ── Footer ── */
    .footer {
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      padding: 20px 36px;
      text-align: center;
    }
    .footer .helpline {
      font-size: 13px;
      color: #475569;
      margin-bottom: 8px;
    }
    .footer .helpline strong { color: #0056b3; }
    .footer .copy {
      font-size: 11px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="wrapper">

    <!-- Header -->
    <div class="header">
      <div class="brand">SLT<span>MOBITEL</span> EasyApply</div>
      <div class="tagline">Digital Service Portal — Official Payment Receipt</div>
    </div>

    <!-- Success icon -->
    <div class="success-icon-row">
      <div class="success-circle">
        <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div class="success-title">Payment Confirmed! 🎉</div>
      <div class="success-sub">
        Dear <strong>${displayName}</strong>, your payment has been received<br/>
        and your application is now confirmed.
      </div>
    </div>

    <!-- Reference box -->
    <div class="ref-box">
      <div class="ref-label">Application Reference Number</div>
      <div class="ref-value">${displayRef}</div>
    </div>

    <!-- Payment details -->
    <div class="details">
      <table>
        <tr>
          <td class="lbl">Service</td>
          <td class="val">${displayService}</td>
        </tr>
        <tr>
          <td class="lbl">Amount Paid</td>
          <td class="val amount-val">${displayAmount}</td>
        </tr>
        <tr>
          <td class="lbl">Payment Date</td>
          <td class="val">${displayDate}</td>
        </tr>
        <tr>
          <td class="lbl">Order ID</td>
          <td class="val">${orderId || displayRef}</td>
        </tr>
        <tr>
          <td class="lbl">Status</td>
          <td class="val" style="color:#16a34a;font-weight:900;">✔ Paid &amp; Confirmed</td>
        </tr>
      </table>
    </div>

    <!-- Notice -->
    <div class="notice">
      <strong>📌 Keep this for your records.</strong><br/>
      Quote reference <strong>${displayRef}</strong> for all inquiries.
      You will receive an SMS once your service is activated (within 24–48 hours).
      For urgent support call <strong>1212</strong> or visit your nearest SLT Teleshop.
    </div>

    <!-- Footer -->
    <div class="footer">
      <div class="helpline">
        Customer Helpline: <strong>1212</strong> &nbsp;|&nbsp;
        Web: <strong>sltmobitel.lk</strong>
      </div>
      <div class="copy">
        &copy; ${new Date().getFullYear()} Sri Lanka Telecom PLC. All rights reserved.<br/>
        This is an automated email — please do not reply.
      </div>
    </div>

  </div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Send a payment confirmation email.
 *
 * @param {object} opts
 * @param {string} opts.to            - Recipient email address
 * @param {string} opts.customerName  - Full name of the customer
 * @param {string} opts.referenceNumber - Application reference (e.g. REQ-12345678)
 * @param {string} opts.orderId       - PayHere order ID
 * @param {number|string} opts.amount - Amount paid
 * @param {string} opts.currency      - Currency code (default: LKR)
 * @param {string} opts.serviceType   - e.g. 'new-connection'
 * @param {Date}   opts.paidAt        - Payment timestamp
 */
export async function sendPaymentConfirmationEmail({
  to,
  customerName,
  referenceNumber,
  orderId,
  amount,
  currency = 'LKR',
  serviceType,
  paidAt,
}) {
  if (!to) {
    console.warn('⚠️  [emailService] No recipient email — skipping confirmation email.');
    return;
  }

  try {
    const transporter = await getTransporter();

    const from =
      process.env.SMTP_FROM || '"SLTMobitel EasyApply" <noreply@sltmobitel.lk>';

    const info = await transporter.sendMail({
      from,
      to,
      subject: `✅ Payment Confirmed — Ref: ${referenceNumber || orderId}`,
      html: buildPaymentConfirmationHtml({
        customerName,
        referenceNumber,
        orderId,
        amount,
        currency,
        serviceType,
        paidAt,
      }),
    });

    console.log(`\n📧 Payment confirmation email sent to ${to}`);
    console.log(`   Message ID : ${info.messageId}`);

    // Ethereal preview URL (only available in demo mode)
    const previewUrl = nodemailer.getTestMessageUrl(info);
    if (previewUrl) {
      console.log(`   📬 PREVIEW  : ${previewUrl}`);
      console.log('   ↑ Open this URL in your browser to see the email (demo only)\n');
    } else {
      console.log('   Email delivered via real SMTP.\n');
    }
  } catch (err) {
    // Never crash the payment webhook due to email failure
    console.error(`\n❌ [emailService] Failed to send confirmation email to ${to}: ${err.message}\n`);
  }
}
