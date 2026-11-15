import nodemailer from 'nodemailer';

// ─────────────────────────────────────────────────────────────
// Transporter — use env SMTP creds when SMTP_HOST + SMTP_USER are set.
// SMTP_PASS may be empty or "N/A" — in that case we use relay/no-auth mode
// (common on internal corporate relays that trust by IP or username only).
// Falls back to Ethereal test account when no host is configured at all.
// ─────────────────────────────────────────────────────────────
let _transporter = null;

/**
 * Resolve whether SMTP_PASS is a real password or an empty / "N/A" placeholder.
 */
function resolveSmtpPass(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (trimmed === '' || trimmed.toUpperCase() === 'N/A') return null;
  return trimmed;
}

async function getTransporter() {
  if (_transporter) return _transporter;

  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;

  if (smtpHost && smtpUser) {
    // ── Live SMTP (corporate relay or authenticated) ──────────────────────
    const smtpPass = resolveSmtpPass(process.env.SMTP_PASS);
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    // Port 465 is direct SSL/TLS. Ports 25 and 587 use STARTTLS (secure must be false).
    const smtpSecure = smtpPort === 465 || (process.env.SMTP_SECURE === 'true' && smtpPort !== 25 && smtpPort !== 587);

    // If no password provided, omit auth object completely so Nodemailer works as pure open/IP relay
    const authBlock = smtpPass ? { user: smtpUser, pass: smtpPass } : undefined;

    _transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: authBlock,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 8000,
      tls: {
        // Accept self-signed / internal corporate TLS certificates
        rejectUnauthorized: false,
      },
    });

    const modeLabel = smtpPass ? 'authenticated' : 'relay / no-auth';
    console.log(`\n📧 Nodemailer: using SMTP host ${smtpHost}:${smtpPort} (${modeLabel})\n`);
  } else {
    // ── Demo mode via Ethereal — captures emails at https://ethereal.email ──
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
// Shared UI formatting helpers
// ─────────────────────────────────────────────────────────────
function formatServiceLabel(serviceType) {
  const map = {
    'new-connection': 'New Connection',
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
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Colombo',
  });
}

function formatPhoneNumber(phone) {
  if (!phone) return '—';
  let cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.startsWith('94')) cleaned = cleaned.slice(2);
  if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
  if (cleaned.length === 9) {
    return `+94 ${cleaned.slice(0, 2)} ${cleaned.slice(2, 5)} ${cleaned.slice(5)}`;
  }
  return `+94 ${cleaned}`;
}

// ─────────────────────────────────────────────────────────────
// Shared Bulletproof Email Shell (Table-based, Cross-Client Safe)
// ─────────────────────────────────────────────────────────────
export function emailShell({ subject, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <title>${subject}</title>
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    @media only screen and (max-width: 600px) {
      .email-container { width: 100% !important; border-radius: 0 !important; }
      .email-content { padding: 24px 18px !important; }
      .otp-digit-td { width: 40px !important; height: 48px !important; font-size: 24px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 24px 0; background-color: #f1f5f9; -webkit-font-smoothing: antialiased;">
  <!-- Centered Container Table -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f1f5f9;">
    <tr>
      <td align="center">
        <!-- Main Card Container -->
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 600px; background-color: #ffffff; border-radius: 14px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 20px rgba(0, 51, 102, 0.08); margin: 0 auto;">
          
          <!-- Header Banner -->
          <tr>
            <td align="center" style="background: linear-gradient(135deg, #002d62 0%, #004b99 55%, #0066cc 100%); padding: 28px 24px; text-align: center;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                <tr>
                  <td align="center" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                    <div style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: 0.5px;">
                      SLT<span style="color: #00d285; font-weight: 900;">MOBITEL</span> <span style="font-weight: 300; color: #e0f2fe; margin-left: 4px;">EasyApply</span>
                    </div>
                    <div style="font-size: 11px; font-weight: 600; color: #bae6fd; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 5px;">
                      Digital Service Portal — Official Notification
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Email Content Body -->
          <tr>
            <td class="email-content" style="padding: 32px 36px; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 24px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
              <div style="font-size: 12px; color: #64748b; line-height: 1.6;">
                Customer Helpline: <strong style="color: #004b99;">1212</strong> &nbsp;|&nbsp; Web: <a href="https://sltmobitel.lk" target="_blank" style="color: #004b99; text-decoration: none; font-weight: 600;">sltmobitel.lk</a>
              </div>
              <div style="font-size: 11px; color: #94a3b8; line-height: 1.6; margin-top: 6px;">
                &copy; ${new Date().getFullYear()} Sri Lanka Telecom PLC. All rights reserved.<br/>
                This is an official automated notification — please do not reply.
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// 1. PAYMENT CONFIRMATION EMAIL
// ─────────────────────────────────────────────────────────────
export function buildPaymentConfirmationBody({
  customerName,
  referenceNumber,
  orderId,
  amount,
  serviceType,
  paidAt,
}) {
  const displayRef = referenceNumber || orderId || '—';
  const displayName = customerName || 'Valued Customer';

  return `
  <!-- Success Icon Badge (Clean SVG, No Emojis) -->
  <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto 16px auto;">
    <tr>
      <td align="center" width="56" height="56" style="width: 56px; height: 56px; background-color: #dcfce7; border-radius: 50%; text-align: center; vertical-align: middle;">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display: block; margin: auto;">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </td>
    </tr>
  </table>

  <h1 style="margin: 0 0 8px 0; font-size: 21px; font-weight: 700; color: #0f172a; text-align: center; letter-spacing: -0.3px;">
    Payment Confirmed
  </h1>
  <p style="margin: 0 0 22px 0; font-size: 14px; line-height: 1.55; color: #475569; text-align: center;">
    Dear <strong>${displayName}</strong>, your payment has been received successfully and your application is now confirmed.
  </p>

  <!-- Reference Card -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f0f7ff; border: 1px solid #bae6fd; border-radius: 10px; margin-bottom: 22px;">
    <tr>
      <td align="center" style="padding: 16px 20px;">
        <div style="font-size: 11px; font-weight: 700; color: #0284c7; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 5px;">
          Application Reference Number
        </div>
        <div style="font-size: 24px; font-weight: 800; color: #003366; letter-spacing: 1.5px; font-family: 'Courier New', Courier, monospace, sans-serif;">
          ${displayRef}
        </div>
      </td>
    </tr>
  </table>

  <!-- Details Table -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 22px; overflow: hidden; background-color: #ffffff;">
    <tr>
      <td style="padding: 12px 16px; font-size: 13px; font-weight: 600; color: #64748b; border-bottom: 1px solid #f1f5f9; width: 44%;">Service</td>
      <td style="padding: 12px 16px; font-size: 13px; font-weight: 600; color: #0f172a; border-bottom: 1px solid #f1f5f9;">${formatServiceLabel(serviceType)}</td>
    </tr>
    <tr>
      <td style="padding: 12px 16px; font-size: 13px; font-weight: 600; color: #64748b; border-bottom: 1px solid #f1f5f9;">Amount Paid</td>
      <td style="padding: 12px 16px; font-size: 15px; font-weight: 800; color: #16a34a; border-bottom: 1px solid #f1f5f9;">${formatAmountLKR(amount)}</td>
    </tr>
    <tr>
      <td style="padding: 12px 16px; font-size: 13px; font-weight: 600; color: #64748b; border-bottom: 1px solid #f1f5f9;">Payment Date</td>
      <td style="padding: 12px 16px; font-size: 13px; font-weight: 500; color: #0f172a; border-bottom: 1px solid #f1f5f9;">${formatDate(paidAt)}</td>
    </tr>
    <tr>
      <td style="padding: 12px 16px; font-size: 13px; font-weight: 600; color: #64748b; border-bottom: 1px solid #f1f5f9;">Order ID</td>
      <td style="padding: 12px 16px; font-size: 13px; font-family: 'Courier New', Courier, monospace; color: #334155; border-bottom: 1px solid #f1f5f9;">${orderId || displayRef}</td>
    </tr>
    <tr>
      <td style="padding: 12px 16px; font-size: 13px; font-weight: 600; color: #64748b;">Payment Status</td>
      <td style="padding: 12px 16px; font-size: 13px;">
        <span style="display: inline-block; background-color: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; font-size: 12px; font-weight: 700; padding: 2px 10px; border-radius: 12px;">Paid &amp; Confirmed</span>
      </td>
    </tr>
  </table>

  <!-- Important Notice Card -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #0056b3; border-radius: 6px;">
    <tr>
      <td style="padding: 14px 16px; font-size: 13px; line-height: 1.6; color: #334155;">
        <strong style="display: block; color: #003366; margin-bottom: 4px; font-size: 13px;">Important Information</strong>
        Please retain Reference Number <strong>${displayRef}</strong> for all inquiries.<br/>
        You will receive an SMS and email notification when your connection is scheduled and activated (typically within 24–48 hours). For urgent support, contact the 24/7 SLT Helpline at <strong>1212</strong>.
      </td>
    </tr>
  </table>`;
}

// ─────────────────────────────────────────────────────────────
// 2. APPLICATION SUBMITTED EMAIL
// ─────────────────────────────────────────────────────────────
export function buildApplicationSubmittedBody({
  customerName,
  referenceNumber,
  serviceType,
  phone,
  submittedAt,
  requiresPayment,
}) {
  const displayRef = referenceNumber || '—';
  const displayName = customerName || 'Valued Customer';

  return `
  <!-- Status Icon Badge (Clean SVG, No Emojis) -->
  <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto 16px auto;">
    <tr>
      <td align="center" width="56" height="56" style="width: 56px; height: 56px; background-color: #e0f2fe; border-radius: 50%; text-align: center; vertical-align: middle;">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display: block; margin: auto;">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="16" y1="13" x2="8" y2="13"></line>
          <line x1="16" y1="17" x2="8" y2="17"></line>
          <polyline points="10 9 9 9 8 9"></polyline>
        </svg>
      </td>
    </tr>
  </table>

  <h1 style="margin: 0 0 8px 0; font-size: 21px; font-weight: 700; color: #0f172a; text-align: center; letter-spacing: -0.3px;">
    Application Received
  </h1>
  <p style="margin: 0 0 22px 0; font-size: 14px; line-height: 1.55; color: #475569; text-align: center;">
    Dear <strong>${displayName}</strong>, thank you for choosing SLTMOBITEL. Your service request has been successfully recorded and is now under technical review.
  </p>

  <!-- Reference Card -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f0f7ff; border: 1px solid #bae6fd; border-radius: 10px; margin-bottom: 22px;">
    <tr>
      <td align="center" style="padding: 16px 20px;">
        <div style="font-size: 11px; font-weight: 700; color: #0284c7; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 5px;">
          Application Reference Number
        </div>
        <div style="font-size: 24px; font-weight: 800; color: #003366; letter-spacing: 1.5px; font-family: 'Courier New', Courier, monospace, sans-serif;">
          ${displayRef}
        </div>
      </td>
    </tr>
  </table>

  <!-- Details Table -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 22px; overflow: hidden; background-color: #ffffff;">
    <tr>
      <td style="padding: 12px 16px; font-size: 13px; font-weight: 600; color: #64748b; border-bottom: 1px solid #f1f5f9; width: 44%;">Service Requested</td>
      <td style="padding: 12px 16px; font-size: 13px; font-weight: 600; color: #0f172a; border-bottom: 1px solid #f1f5f9;">${formatServiceLabel(serviceType)}</td>
    </tr>
    <tr>
      <td style="padding: 12px 16px; font-size: 13px; font-weight: 600; color: #64748b; border-bottom: 1px solid #f1f5f9;">Contact Number</td>
      <td style="padding: 12px 16px; font-size: 13px; font-weight: 600; color: #0f172a; border-bottom: 1px solid #f1f5f9;">${formatPhoneNumber(phone)}</td>
    </tr>
    <tr>
      <td style="padding: 12px 16px; font-size: 13px; font-weight: 600; color: #64748b; border-bottom: 1px solid #f1f5f9;">Submitted On</td>
      <td style="padding: 12px 16px; font-size: 13px; font-weight: 500; color: #0f172a; border-bottom: 1px solid #f1f5f9;">${formatDate(submittedAt)}</td>
    </tr>
    <tr>
      <td style="padding: 12px 16px; font-size: 13px; font-weight: 600; color: #64748b;">Current Status</td>
      <td style="padding: 12px 16px; font-size: 13px;">
        <span style="display: inline-block; background-color: #eff6ff; color: #0284c7; border: 1px solid #bae6fd; font-size: 12px; font-weight: 700; padding: 2px 10px; border-radius: 12px;">Under Review</span>
      </td>
    </tr>
  </table>

  <!-- Processing Timeline (Rock-Solid Nested Table — No Broken Bars) -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 22px;">
    <tr>
      <td style="padding: 18px 20px;">
        <div style="font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 14px;">
          Processing Timeline
        </div>

        <!-- Step 1: Received -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 12px;">
          <tr>
            <td width="28" valign="middle" align="center" style="width: 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="24" height="24" align="center" valign="middle" style="width: 24px; height: 24px; background-color: #10b981; border-radius: 50%; color: #ffffff; font-size: 12px; font-weight: bold; text-align: center; line-height: 24px;">&#10003;</td>
                </tr>
              </table>
            </td>
            <td valign="middle" style="padding-left: 10px; font-size: 13px; font-weight: 600; color: #0f172a;">
              Application Logged &amp; Verified
            </td>
            <td valign="middle" align="right" style="font-size: 11px;">
              <span style="display: inline-block; background-color: #dcfce7; color: #15803d; font-weight: 700; padding: 2px 8px; border-radius: 10px;">Completed</span>
            </td>
          </tr>
        </table>

        <!-- Step 2: Verification -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 12px;">
          <tr>
            <td width="28" valign="middle" align="center" style="width: 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="24" height="24" align="center" valign="middle" style="width: 24px; height: 24px; background-color: #0284c7; border-radius: 50%; color: #ffffff; font-size: 11px; font-weight: bold; text-align: center; line-height: 24px;">2</td>
                </tr>
              </table>
            </td>
            <td valign="middle" style="padding-left: 10px; font-size: 13px; font-weight: 600; color: #0f172a;">
              Technical Feasibility &amp; Dispatch
            </td>
            <td valign="middle" align="right" style="font-size: 11px;">
              <span style="display: inline-block; background-color: #e0f2fe; color: #0369a1; font-weight: 700; padding: 2px 8px; border-radius: 10px;">24–48 hrs</span>
            </td>
          </tr>
        </table>

        <!-- Step 3: Activation -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="28" valign="middle" align="center" style="width: 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="24" height="24" align="center" valign="middle" style="width: 24px; height: 24px; background-color: #e2e8f0; border-radius: 50%; color: #64748b; font-size: 11px; font-weight: bold; text-align: center; line-height: 24px;">3</td>
                </tr>
              </table>
            </td>
            <td valign="middle" style="padding-left: 10px; font-size: 13px; font-weight: 500; color: #64748b;">
              Service Activation &amp; Handover
            </td>
            <td valign="middle" align="right" style="font-size: 11px;">
              <span style="display: inline-block; background-color: #f1f5f9; color: #64748b; font-weight: 600; padding: 2px 8px; border-radius: 10px;">Pending</span>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

  <!-- Next Steps Card -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f0fdf4; border: 1px solid #dcfce7; border-left: 4px solid #16a34a; border-radius: 6px;">
    <tr>
      <td style="padding: 14px 16px; font-size: 13px; line-height: 1.6; color: #166534;">
        <strong style="display: block; color: #14532d; margin-bottom: 3px; font-size: 13px;">What Happens Next?</strong>
        An SLTMOBITEL representative will verify your network coverage and details. Please quote Reference Number <strong>${displayRef}</strong> for all inquiries.<br/>
        Our team will contact you within 24–48 hours. For urgent assistance, contact the 24/7 Helpline at <strong>1212</strong>.
      </td>
    </tr>
  </table>

  ${requiresPayment ? `
  <!-- Payment Notice -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #fffbeb; border: 1px solid #fef3c7; border-left: 4px solid #f59e0b; border-radius: 6px; margin-top: 14px;">
    <tr>
      <td style="padding: 14px 16px; font-size: 13px; line-height: 1.6; color: #92400e;">
        <strong style="display: block; color: #78350f; margin-bottom: 3px; font-size: 13px;">Payment Pending</strong>
        Your application requires payment completion to proceed with technician dispatch and connection setup. Please complete payment via the portal.
      </td>
    </tr>
  </table>` : ''}`;
}

// ─────────────────────────────────────────────────────────────
// 3. OTP VERIFICATION EMAIL
// ─────────────────────────────────────────────────────────────
export function buildOtpEmailBody({ otpCode, expiresInMinutes = 5 }) {
  const digits = String(otpCode).split('');
  const digitTds = digits
    .map(
      (d) =>
        `<td class="otp-digit-td" width="46" height="54" align="center" valign="middle" style="width: 46px; height: 54px; background-color: #ffffff; border: 1.5px solid #0056b3; border-radius: 8px; font-family: 'Courier New', Courier, monospace, sans-serif; font-size: 28px; font-weight: 700; color: #003366; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.03);">${d}</td>`
    )
    .join('<td width="6" style="width: 6px;"></td>');

  return `
  <!-- Security Icon Badge (Clean SVG, No Emojis) -->
  <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto 16px auto;">
    <tr>
      <td align="center" width="56" height="56" style="width: 56px; height: 56px; background-color: #e0f2fe; border-radius: 50%; text-align: center; vertical-align: middle;">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#0056b3" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display: block; margin: auto;">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
      </td>
    </tr>
  </table>

  <h1 style="margin: 0 0 8px 0; font-size: 21px; font-weight: 700; color: #0f172a; text-align: center; letter-spacing: -0.3px;">
    Verification Code
  </h1>
  <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.55; color: #475569; text-align: center;">
    Please use the 6-digit one-time code below to verify your email address on SLTMobitel EasyApply.
  </p>

  <!-- OTP Digits Container -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 24px;">
    <tr>
      <td align="center" style="padding: 24px 16px;">
        <div style="font-size: 11px; font-weight: 700; color: #0284c7; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 16px;">
          One-Time Password (OTP)
        </div>

        <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0">
          <tr>
            ${digitTds}
          </tr>
        </table>

        <div style="margin-top: 16px; font-size: 12px; color: #64748b;">
          Valid for <strong style="color: #0056b3;">${expiresInMinutes} minutes</strong>
        </div>
      </td>
    </tr>
  </table>

  <!-- Security Notice Card -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #fffbeb; border: 1px solid #fef3c7; border-left: 4px solid #f59e0b; border-radius: 6px;">
    <tr>
      <td style="padding: 14px 16px; font-size: 13px; line-height: 1.6; color: #92400e;">
        <strong style="display: block; color: #78350f; margin-bottom: 3px; font-size: 13px;">Security Notice</strong>
        Never disclose this code to anyone, including SLTMobitel staff or sales representatives.<br/>
        If you did not initiate this verification request, you can safely ignore this message.
      </td>
    </tr>
  </table>`;
}

// ─────────────────────────────────────────────────────────────
// HTML Generators for Previews & Tests
// ─────────────────────────────────────────────────────────────
export function generateOtpEmailHtml({ otpCode = '380982', expiresInMinutes = 5 } = {}) {
  const subject = `Your SLTMobitel Verification Code: ${otpCode}`;
  return emailShell({
    subject,
    bodyHtml: buildOtpEmailBody({ otpCode, expiresInMinutes }),
  });
}

export function generateApplicationSubmittedEmailHtml({
  customerName = 'MAHALINGAM DAWANHAREN',
  referenceNumber = 'REQ-47991255',
  serviceType = 'new-connection',
  phone = '0774409720',
  submittedAt = new Date(),
  requiresPayment = false,
} = {}) {
  const subject = `Application Received — Ref: ${referenceNumber}`;
  return emailShell({
    subject,
    bodyHtml: buildApplicationSubmittedBody({
      customerName,
      referenceNumber,
      serviceType,
      phone,
      submittedAt,
      requiresPayment,
    }),
  });
}

export function generatePaymentConfirmationEmailHtml({
  customerName = 'MAHALINGAM DAWANHAREN',
  referenceNumber = 'REQ-47991255',
  orderId = 'PAY-8923412',
  amount = 2500,
  serviceType = 'new-connection',
  paidAt = new Date(),
} = {}) {
  const subject = `Payment Confirmed — Ref: ${referenceNumber || orderId}`;
  return emailShell({
    subject,
    bodyHtml: buildPaymentConfirmationBody({
      customerName,
      referenceNumber,
      orderId,
      amount,
      serviceType,
      paidAt,
    }),
  });
}

// ─────────────────────────────────────────────────────────────
// Internal send helper
// ─────────────────────────────────────────────────────────────
async function _send({ to, subject, html }) {
  if (!to) {
    console.warn('⚠️  [emailService] No recipient — skipping email.');
    return;
  }

  if (process.env.NODE_ENV === 'test') {
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
    console.error(`\n❌ [emailService] Send failed (${to}): ${err.message}`);
    if (err.code === 'ETIMEDOUT' || err.message?.includes('ETIMEDOUT')) {
      console.warn(
        `   💡 Tip: Connection to SMTP host timed out. Port 25 is typically blocked by home/WiFi ISPs or requires connecting to the SLT Corporate VPN/Intranet.\n`
      );
    } else {
      console.log('');
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Public Email Sender Methods
// ─────────────────────────────────────────────────────────────

/**
 * Send payment confirmation email (after PayHere IPN or cart checkout).
 */
export async function sendPaymentConfirmationEmail({
  to,
  customerName,
  referenceNumber,
  orderId,
  amount,
  serviceType,
  paidAt,
}) {
  const subject = `Payment Confirmed — Ref: ${referenceNumber || orderId}`;
  const html = generatePaymentConfirmationEmailHtml({
    customerName,
    referenceNumber,
    orderId,
    amount,
    serviceType,
    paidAt,
  });
  await _send({ to, subject, html });
}

/**
 * Send application submitted email (after any wizard submits to /api/applications).
 */
export async function sendApplicationSubmittedEmail({
  to,
  customerName,
  referenceNumber,
  serviceType,
  phone,
  submittedAt,
  requiresPayment = false,
}) {
  const subject = `Application Received — Ref: ${referenceNumber}`;
  const html = generateApplicationSubmittedEmailHtml({
    customerName,
    referenceNumber,
    serviceType,
    phone,
    submittedAt,
    requiresPayment,
  });
  await _send({ to, subject, html });
}

/**
 * Send a 6-digit OTP code to a customer's email address.
 * Called by POST /api/otp/send-email.
 */
export async function sendOtpEmail({ to, otpCode, expiresInMinutes = 5 }) {
  const subject = `Your SLTMobitel Verification Code: ${otpCode}`;
  const html = generateOtpEmailHtml({ otpCode, expiresInMinutes });
  await _send({ to, subject, html });
}
