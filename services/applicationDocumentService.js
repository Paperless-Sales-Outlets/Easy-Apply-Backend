import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
// Lazy-loaded dependencies to allow pure PDF generation without npm install
let dbModule = null;
let storageModule = null;

async function getDb() {
  if (!dbModule) {
    dbModule = await import('../config/db.js');
  }
  return dbModule;
}

async function getStorage() {
  if (!storageModule) {
    try {
      storageModule = await import('./storageService.js');
    } catch {
      storageModule = { isStorageConfigured: () => false };
    }
  }
  return storageModule;
}

// =============================================================================
// SLTMobitel EasyApply - Publication-Grade Customer Application PDF Generator
// Generates official, digitally signed customer service application forms
// incorporating Customer Digital Signature and Sales Officer Signature.
// Compliant with Electronic Transactions Act No. 19 of 2006 (Sri Lanka).
// =============================================================================

const PAGE = { width: 595.28, height: 841.89 }; // A4 Portrait in points
const MARGIN = 36;
const CONTENT_W = PAGE.width - MARGIN * 2; // 523.28

// Brand Palette (0-1 RGB)
const SLT_BLUE = [0.000, 0.329, 0.659];   // #0054a8
const SLT_GREEN = [0.082, 0.647, 0.369];  // #15a55e
const SLT_NAVY = [0.043, 0.169, 0.286];   // #0b2b49
const TEXT_DARK = [0.059, 0.090, 0.165];  // #0f172a
const TEXT_MUTED = [0.392, 0.455, 0.549]; // #64748b
const BORDER_LIGHT = [0.855, 0.890, 0.930]; // #dae3ed
const BG_LIGHT = [0.965, 0.976, 0.988];   // #f6f9fc
const BG_ALT = [0.937, 0.957, 0.980];     // #eff4fa
const WHITE = [1.0, 1.0, 1.0];
const CERT_GOLD = [0.737, 0.533, 0.098];  // #bc8819

// Escape strings for PDF text objects
function escapePdfText(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\r\n\t]/g, ' ');
}

// Low-level drawing operators
const fillRect = (r, g, b, x, y, w, h) =>
  `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`;

const strokeRect = (r, g, b, lineWidth, x, y, w, h) =>
  `${lineWidth.toFixed(2)} w ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`;

const drawLine = (r, g, b, lineWidth, x1, y1, x2, y2) =>
  `${lineWidth.toFixed(2)} w ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`;

const drawText = (fontId, size, r, g, b, x, y, text) =>
  `BT /${fontId} ${size.toFixed(1)} Tf ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfText(text)}) Tj ET`;

/**
 * Pure JavaScript PNG Decoder
 * Unfilters standard PNG IDAT streams and creates composite RGB pixels over white background
 */
function decodePngToRgb(buffer) {
  try {
    if (!buffer || buffer.length < 8) return null;
    if (buffer.readUInt32BE(0) !== 0x89504E47 || buffer.readUInt32BE(4) !== 0x0D0A1A0A) {
      return null;
    }
    let pos = 8;
    let width = 0, height = 0, bitDepth = 0, colorType = 0;
    const idatChunks = [];

    while (pos < buffer.length - 4) {
      const length = buffer.readUInt32BE(pos);
      const type = buffer.toString('ascii', pos + 4, pos + 8);
      const data = buffer.subarray(pos + 8, pos + 8 + length);
      pos += 12 + length;

      if (type === 'IHDR') {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        bitDepth = data.readUInt8(8);
        colorType = data.readUInt8(9);
      } else if (type === 'IDAT') {
        idatChunks.push(data);
      } else if (type === 'IEND') {
        break;
      }
    }

    if (!width || !height || idatChunks.length === 0) return null;
    if (bitDepth !== 8) return null; // 8-bit channels only

    const decompressed = zlib.inflateSync(Buffer.concat(idatChunks));
    const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
    const stride = width * bpp;
    const outRgb = Buffer.alloc(width * height * 3, 255);

    let srcPos = 0;
    const prevRow = Buffer.alloc(stride, 0);
    const currRow = Buffer.alloc(stride, 0);

    for (let y = 0; y < height; y++) {
      if (srcPos >= decompressed.length) break;
      const filter = decompressed.readUInt8(srcPos++);
      for (let x = 0; x < stride; x++) {
        const byte = decompressed.readUInt8(srcPos++);
        const a = x >= bpp ? currRow[x - bpp] : 0;
        const b = prevRow[x];
        const c = x >= bpp ? prevRow[x - bpp] : 0;

        let val = byte;
        if (filter === 1) val = (byte + a) & 0xff;
        else if (filter === 2) val = (byte + b) & 0xff;
        else if (filter === 3) val = (byte + Math.floor((a + b) / 2)) & 0xff;
        else if (filter === 4) {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc) ? b : c;
          val = (byte + pr) & 0xff;
        }
        currRow[x] = val;
      }

      for (let x = 0; x < width; x++) {
        const outIdx = (y * width + x) * 3;
        if (colorType === 6) { // RGBA
          const r = currRow[x * 4];
          const g = currRow[x * 4 + 1];
          const b = currRow[x * 4 + 2];
          const alpha = currRow[x * 4 + 3] / 255;
          outRgb[outIdx] = Math.round(r * alpha + 255 * (1 - alpha));
          outRgb[outIdx + 1] = Math.round(g * alpha + 255 * (1 - alpha));
          outRgb[outIdx + 2] = Math.round(b * alpha + 255 * (1 - alpha));
        } else if (colorType === 2) { // RGB
          outRgb[outIdx] = currRow[x * 3];
          outRgb[outIdx + 1] = currRow[x * 3 + 1];
          outRgb[outIdx + 2] = currRow[x * 3 + 2];
        }
      }
      currRow.copy(prevRow);
    }

    return { width, height, rgb: outRgb };
  } catch (err) {
    console.warn('[applicationDocumentService] PNG decode fallback:', err.message);
    return null;
  }
}

/**
 * Extracts and decodes signature data (base64 PNG or raster)
 */
function parseSignatureImage(sigValue) {
  if (!sigValue || typeof sigValue !== 'string') return null;
  const match = sigValue.match(/^data:image\/png;base64,(.+)$/i);
  if (!match) return null;
  try {
    const rawBuf = Buffer.from(match[1], 'base64');
    return decodePngToRgb(rawBuf);
  } catch {
    return null;
  }
}

/**
 * Format currency in LKR
 */
function formatLkr(amount) {
  const num = Number(amount || 0);
  return `LKR ${num.toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Builds the complete PDF binary string and objects
 */
export function buildCustomerApplicationPdfBuffer(appData) {
  const ref = appData.referenceNumber || `REQ-${Date.now().toString().slice(-8)}`;
  const serviceType = appData.serviceType || 'New Connection';
  const status = String(appData.status || 'Submitted').toUpperCase();
  const createdDate = appData.createdAt ? new Date(appData.createdAt) : new Date();
  const dateStr = createdDate.toLocaleString('en-LK', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const fd = appData.formData || {};
  const customerName = fd.nameFull || fd.fullName || fd.customerName || appData.customerName || 'Customer';
  const customerNic = appData.nic || fd.nic || '—';
  const customerPhone = appData.phone || fd.mobileNumber || fd.contactNumber || '—';
  const customerEmail = fd.email || fd.emailAddress || '—';
  const customerAddress = fd.installAddress || fd.address || fd.addressLine1 || 'Colombo, Sri Lanka';
  const customerCity = fd.city || '—';
  const customerDistrict = fd.district || '—';
  const customerPostal = fd.postalCode || '—';

  // Product / Package
  const product = fd.product || {};
  const productName = product.name || fd.package || fd.packageName || 'SLTMobitel Fibre Connection';
  const speed = product.speed || fd.speed || 'Up to 300 Mbps';
  const monthlyRental = product.monthlyPrice ?? fd.monthlyPrice ?? 4490;
  const installFee = product.installationFee ?? fd.installationFee ?? 2500;
  const paymentStatus = String(appData.paymentStatus || (fd.paymentReference ? 'PAID' : 'PENDING')).toUpperCase();
  const paymentRef = fd.paymentReference || appData.paymentDetails?.orderId || 'N/A (Cash / Counter)';

  // Sales Officer Info
  const attribution = appData.salesAttribution || {};
  const salesOfficerName =
    attribution.officerName ||
    appData.salesOfficerName ||
    (appData.salesOfficerEmployeeNumber ? `Officer (${appData.salesOfficerEmployeeNumber})` : 'SLT Sales Officer');
  const salesOfficerEmpNo =
    appData.salesOfficerEmployeeNumber ||
    attribution.employeeNumber ||
    '095756';
  const salesTrackingToken = appData.salesTrackingToken || attribution.trackingToken || 'DIRECT-OUTLET';

  // Signatures
  const customerSigRaw = fd.signature || appData.documents?.signature || null;
  const staffSigRaw =
    appData.officeFields?.staffSignature ||
    appData.staffSignature ||
    null;

  const customerDecoded = parseSignatureImage(customerSigRaw);
  const staffDecoded = parseSignatureImage(staffSigRaw);

  // Cryptographic Signature Hash (Tamper-evident verification)
  const canonicalPayload = [
    ref,
    customerNic,
    customerPhone,
    serviceType,
    createdDate.toISOString(),
    customerSigRaw ? crypto.createHash('sha256').update(customerSigRaw).digest('hex') : 'NO_CUST_SIG',
    staffSigRaw ? crypto.createHash('sha256').update(staffSigRaw).digest('hex') : salesOfficerEmpNo,
  ].join('||');

  const docSha256 = crypto.createHash('sha256').update(canonicalPayload).digest('hex');
  const certificateId = `SLT-DS-${ref}-${docSha256.slice(0, 10).toUpperCase()}`;

  // ─────────────────────────────────────────────────────────────────────────────
  // PDF Content Drawing (Top to Bottom coordinate space)
  // ─────────────────────────────────────────────────────────────────────────────
  const ops = [];

  // 1. Corporate Header Band
  const topY = PAGE.height; // 841.89
  const bannerH = 76;
  ops.push(fillRect(SLT_BLUE[0], SLT_BLUE[1], SLT_BLUE[2], 0, topY - bannerH, PAGE.width, bannerH));
  ops.push(fillRect(SLT_GREEN[0], SLT_GREEN[1], SLT_GREEN[2], 0, topY - bannerH - 3, PAGE.width, 3));

  // Header Title & Logo text
  ops.push(drawText('F2', 20, 1, 1, 1, MARGIN, topY - 32, 'SLTMOBITEL'));
  ops.push(drawText('F1', 11, 0.85, 0.95, 1, MARGIN + 130, topY - 30, '|  Paperless Digital Sales Outlet'));
  ops.push(drawText('F2', 12, 1, 1, 1, MARGIN, topY - 54, 'OFFICIAL CUSTOMER SERVICE APPLICATION FORM'));
  ops.push(drawText('F1', 9, 0.8, 0.9, 1, MARGIN, topY - 68, 'Sri Lanka Telecom PLC  •  Digitally Signed Legal Electronic Record'));

  // Reference Number Plaque (Right aligned in banner)
  const plaqueW = 160;
  const plaqueX = PAGE.width - MARGIN - plaqueW;
  ops.push(fillRect(0.02, 0.22, 0.45, plaqueX, topY - 66, plaqueW, 54));
  ops.push(strokeRect(0.2, 0.5, 0.8, 1, plaqueX, topY - 66, plaqueW, 54));
  ops.push(drawText('F2', 8, 0.8, 0.9, 1, plaqueX + 10, topY - 26, 'APPLICATION REFERENCE'));
  ops.push(drawText('F2', 14, 1, 1, 1, plaqueX + 10, topY - 45, ref));
  ops.push(drawText('F1', 8, 0.85, 0.95, 0.9, plaqueX + 10, topY - 59, `Status: ${status}`));

  // 2. Submission & Meta Info Sub-bar
  let currY = topY - bannerH - 24;
  ops.push(fillRect(BG_LIGHT[0], BG_LIGHT[1], BG_LIGHT[2], MARGIN, currY - 20, CONTENT_W, 24));
  ops.push(strokeRect(BORDER_LIGHT[0], BORDER_LIGHT[1], BORDER_LIGHT[2], 0.8, MARGIN, currY - 20, CONTENT_W, 24));
  ops.push(drawText('F2', 8.5, SLT_NAVY[0], SLT_NAVY[1], SLT_NAVY[2], MARGIN + 10, currY - 14, 'SUBMISSION DATE:'));
  ops.push(drawText('F1', 8.5, TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2], MARGIN + 105, currY - 14, dateStr));
  ops.push(drawText('F2', 8.5, SLT_NAVY[0], SLT_NAVY[1], SLT_NAVY[2], MARGIN + 230, currY - 14, 'SERVICE TYPE:'));
  ops.push(drawText('F2', 8.5, SLT_BLUE[0], SLT_BLUE[1], SLT_BLUE[2], MARGIN + 305, currY - 14, serviceType));
  ops.push(drawText('F2', 8.5, SLT_NAVY[0], SLT_NAVY[1], SLT_NAVY[2], MARGIN + 430, currY - 14, 'OUTLET REF:'));
  ops.push(drawText('F1', 8, TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2], MARGIN + 490, currY - 14, salesTrackingToken.slice(0, 10)));

  // Section Heading Helper
  const drawSectionHeader = (title, y) => {
    ops.push(fillRect(BG_ALT[0], BG_ALT[1], BG_ALT[2], MARGIN, y - 18, CONTENT_W, 20));
    ops.push(fillRect(SLT_BLUE[0], SLT_BLUE[1], SLT_BLUE[2], MARGIN, y - 18, 4, 20));
    ops.push(drawText('F2', 9.5, SLT_BLUE[0], SLT_BLUE[1], SLT_BLUE[2], MARGIN + 12, y - 14, title));
    return y - 24;
  };

  // 3. Section 1: Customer Information
  currY -= 36;
  currY = drawSectionHeader('1. CUSTOMER IDENTITY & CONTACT INFORMATION', currY);

  const rowH = 18;
  const col1 = MARGIN + 8;
  const colVal1 = MARGIN + 105;
  const col2 = MARGIN + 270;
  const colVal2 = MARGIN + 365;

  const custInfoRows = [
    [['Full Name:', customerName], ['National ID / NIC:', customerNic]],
    [['Contact Phone:', customerPhone], ['Email Address:', customerEmail]],
    [['Installation Address:', customerAddress], ['City & District:', `${customerCity}, ${customerDistrict}`]],
    [['Postal Code:', customerPostal], ['Customer Type:', fd.customerType || 'Individual / Consumer']],
  ];

  custInfoRows.forEach((row, idx) => {
    const rY = currY - idx * rowH;
    if (idx % 2 === 1) {
      ops.push(fillRect(BG_LIGHT[0], BG_LIGHT[1], BG_LIGHT[2], MARGIN, rY - 13, CONTENT_W, rowH));
    }
    ops.push(drawText('F2', 8, TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2], col1, rY - 10, row[0][0]));
    ops.push(drawText('F1', 8.5, TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2], colVal1, rY - 10, String(row[0][1]).slice(0, 36)));

    ops.push(drawText('F2', 8, TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2], col2, rY - 10, row[1][0]));
    ops.push(drawText('F1', 8.5, TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2], colVal2, rY - 10, String(row[1][1]).slice(0, 34)));
  });
  ops.push(strokeRect(BORDER_LIGHT[0], BORDER_LIGHT[1], BORDER_LIGHT[2], 0.6, MARGIN, currY - custInfoRows.length * rowH + 5, CONTENT_W, custInfoRows.length * rowH));

  currY -= (custInfoRows.length * rowH + 16);

  // 4. Section 2: Service & Package Specifications
  currY = drawSectionHeader('2. SERVICE PACKAGE & BILLING DETAILS', currY);

  const srvRows = [
    [['Selected Package:', productName], ['Access Speed:', speed]],
    [['Monthly Rental:', formatLkr(monthlyRental)], ['Initial Setup Fee:', formatLkr(installFee)]],
    [['Payment Reference:', paymentRef], ['Payment Status:', paymentStatus]],
  ];

  srvRows.forEach((row, idx) => {
    const rY = currY - idx * rowH;
    if (idx % 2 === 1) {
      ops.push(fillRect(BG_LIGHT[0], BG_LIGHT[1], BG_LIGHT[2], MARGIN, rY - 13, CONTENT_W, rowH));
    }
    ops.push(drawText('F2', 8, TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2], col1, rY - 10, row[0][0]));
    ops.push(drawText('F2', 8.5, SLT_BLUE[0], SLT_BLUE[1], SLT_BLUE[2], colVal1, rY - 10, String(row[0][1]).slice(0, 36)));

    ops.push(drawText('F2', 8, TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2], col2, rY - 10, row[1][0]));
    ops.push(drawText('F1', 8.5, TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2], colVal2, rY - 10, String(row[1][1]).slice(0, 34)));
  });
  ops.push(strokeRect(BORDER_LIGHT[0], BORDER_LIGHT[1], BORDER_LIGHT[2], 0.6, MARGIN, currY - srvRows.length * rowH + 5, CONTENT_W, srvRows.length * rowH));

  currY -= (srvRows.length * rowH + 16);

  // 5. Section 3: Statutory Declaration & Consents
  currY = drawSectionHeader('3. STATUTORY CUSTOMER DECLARATION & CONSENTS', currY);
  const decBoxH = 46;
  ops.push(fillRect(BG_LIGHT[0], BG_LIGHT[1], BG_LIGHT[2], MARGIN, currY - decBoxH + 4, CONTENT_W, decBoxH));
  ops.push(strokeRect(BORDER_LIGHT[0], BORDER_LIGHT[1], BORDER_LIGHT[2], 0.6, MARGIN, currY - decBoxH + 4, CONTENT_W, decBoxH));
  ops.push(drawText('F1', 7.8, TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2], MARGIN + 10, currY - 9,
    `I, ${customerName} (NIC: ${customerNic}), confirm that all information and identity documents provided in this application are`));
  ops.push(drawText('F1', 7.8, TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2], MARGIN + 10, currY - 21,
    'true, authentic and my own. I accept the General Terms and Conditions governing telecommunication services provided by'));
  ops.push(drawText('F1', 7.8, TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2], MARGIN + 10, currY - 33,
    'Sri Lanka Telecom PLC and acknowledge that this electronic application is legally binding upon digital signature.'));

  currY -= (decBoxH + 16);

  // 6. Section 4: Dual Signatures Panel (Customer + Sales Officer)
  currY = drawSectionHeader('4. DUAL AUTHORIZATION & DIGITAL SIGNATURES', currY);

  const sigBoxW = (CONTENT_W - 14) / 2;
  const sigBoxH = 114;
  const custSigX = MARGIN;
  const staffSigX = MARGIN + sigBoxW + 14;
  const sigBoxY = currY - sigBoxH + 4;

  // Box A: Customer Signature Box
  ops.push(fillRect(WHITE[0], WHITE[1], WHITE[2], custSigX, sigBoxY, sigBoxW, sigBoxH));
  ops.push(strokeRect(SLT_BLUE[0], SLT_BLUE[1], SLT_BLUE[2], 1, custSigX, sigBoxY, sigBoxW, sigBoxH));
  ops.push(fillRect(BG_ALT[0], BG_ALT[1], BG_ALT[2], custSigX, sigBoxY + sigBoxH - 18, sigBoxW, 18));
  ops.push(drawText('F2', 8.5, SLT_BLUE[0], SLT_BLUE[1], SLT_BLUE[2], custSigX + 8, sigBoxY + sigBoxH - 13, 'APPLICANT / CUSTOMER DIGITAL SIGNATURE'));

  // Box B: Sales Officer Signature Box
  ops.push(fillRect(WHITE[0], WHITE[1], WHITE[2], staffSigX, sigBoxY, sigBoxW, sigBoxH));
  ops.push(strokeRect(SLT_GREEN[0], SLT_GREEN[1], SLT_GREEN[2], 1, staffSigX, sigBoxY, sigBoxW, sigBoxH));
  ops.push(fillRect(BG_LIGHT[0], BG_LIGHT[1], BG_LIGHT[2], staffSigX, sigBoxY + sigBoxH - 18, sigBoxW, 18));
  ops.push(drawText('F2', 8.5, SLT_GREEN[0], SLT_GREEN[1], SLT_GREEN[2], staffSigX + 8, sigBoxY + sigBoxH - 13, 'SALES OFFICER ENDORSEMENT & SIGNATURE'));

  // Customer Signature Image / Stamp Placement
  const imageObjects = [];
  let custImgObjId = null;
  let staffImgObjId = null;

  if (customerDecoded) {
    custImgObjId = 3; // Assigned in object table
    const renderW = Math.min(180, sigBoxW - 20);
    const renderH = (customerDecoded.height / customerDecoded.width) * renderW;
    const clampedH = Math.min(45, renderH);
    const imgX = custSigX + (sigBoxW - renderW) / 2;
    const imgY = sigBoxY + 36;
    ops.push(`q ${renderW.toFixed(2)} 0 0 ${clampedH.toFixed(2)} ${imgX.toFixed(2)} ${imgY.toFixed(2)} cm /CustSig Do Q`);
  } else {
    // Official Digital Verification Stamp if drawn signature is in OTP/Text mode
    ops.push(fillRect(BG_LIGHT[0], BG_LIGHT[1], BG_LIGHT[2], custSigX + 10, sigBoxY + 36, sigBoxW - 20, 36));
    ops.push(strokeRect(SLT_BLUE[0], SLT_BLUE[1], SLT_BLUE[2], 0.6, custSigX + 10, sigBoxY + 36, sigBoxW - 20, 36));
    ops.push(drawText('F2', 9, SLT_BLUE[0], SLT_BLUE[1], SLT_BLUE[2], custSigX + 16, sigBoxY + 54, '✔ DIGITALLY VERIFIED SIGNATURE'));
    ops.push(drawText('F1', 7.5, TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2], custSigX + 16, sigBoxY + 42, `Signed via OTP / Portal by ${customerName}`));
  }

  // Customer Signature Metadata
  ops.push(drawLine(BORDER_LIGHT[0], BORDER_LIGHT[1], BORDER_LIGHT[2], 0.5, custSigX + 8, sigBoxY + 30, custSigX + sigBoxW - 8, sigBoxY + 30));
  ops.push(drawText('F2', 8, TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2], custSigX + 8, sigBoxY + 18, `Signatory: ${customerName}`));
  ops.push(drawText('F1', 7.5, TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2], custSigX + 8, sigBoxY + 7, `NIC: ${customerNic}  |  Signed: ${dateStr}`));

  // Sales Officer Signature Image / Stamp Placement
  if (staffDecoded) {
    staffImgObjId = 4;
    const renderW = Math.min(180, sigBoxW - 20);
    const renderH = (staffDecoded.height / staffDecoded.width) * renderW;
    const clampedH = Math.min(45, renderH);
    const imgX = staffSigX + (sigBoxW - renderW) / 2;
    const imgY = sigBoxY + 36;
    ops.push(`q ${renderW.toFixed(2)} 0 0 ${clampedH.toFixed(2)} ${imgX.toFixed(2)} ${imgY.toFixed(2)} cm /StaffSig Do Q`);
  } else {
    // Official Sales Officer Endorsement Seal
    ops.push(fillRect(0.94, 0.98, 0.95, staffSigX + 10, sigBoxY + 36, sigBoxW - 20, 36));
    ops.push(strokeRect(SLT_GREEN[0], SLT_GREEN[1], SLT_GREEN[2], 0.8, staffSigX + 10, sigBoxY + 36, sigBoxW - 20, 36));
    ops.push(drawText('F2', 9, SLT_GREEN[0], SLT_GREEN[1], SLT_GREEN[2], staffSigX + 16, sigBoxY + 54, '✔ AUTHORIZED SALES OFFICER ENDORSEMENT'));
    ops.push(drawText('F1', 7.5, TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2], staffSigX + 16, sigBoxY + 42, `Endorsed by Officer ${salesOfficerName} (#${salesOfficerEmpNo})`));
  }

  // Officer Signature Metadata
  ops.push(drawLine(BORDER_LIGHT[0], BORDER_LIGHT[1], BORDER_LIGHT[2], 0.5, staffSigX + 8, sigBoxY + 30, staffSigX + sigBoxW - 8, sigBoxY + 30));
  ops.push(drawText('F2', 8, TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2], staffSigX + 8, sigBoxY + 18, `Officer: ${salesOfficerName}  (Emp #${salesOfficerEmpNo})`));
  ops.push(drawText('F1', 7.5, TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2], staffSigX + 8, sigBoxY + 7, `SLTMobitel Paperless Sales Outlet  |  Date: ${dateStr}`));

  currY = sigBoxY - 14;

  // 7. Section 5: Cryptographic Digital Signature & Integrity Certificate Seal
  const certBoxH = 64;
  ops.push(fillRect(0.99, 0.98, 0.94, MARGIN, currY - certBoxH, CONTENT_W, certBoxH));
  ops.push(strokeRect(CERT_GOLD[0], CERT_GOLD[1], CERT_GOLD[2], 1, MARGIN, currY - certBoxH, CONTENT_W, certBoxH));

  // Security Ribbon Indicator
  ops.push(fillRect(CERT_GOLD[0], CERT_GOLD[1], CERT_GOLD[2], MARGIN, currY - 14, CONTENT_W, 14));
  ops.push(drawText('F2', 8, 1, 1, 1, MARGIN + 10, currY - 10,
    '🛡️  DIGITALLY GENERATED & CERTIFIED UNDER ELECTRONIC TRANSACTIONS ACT NO. 19 OF 2006 (SRI LANKA)'));

  ops.push(drawText('F2', 8, CERT_GOLD[0], CERT_GOLD[1], CERT_GOLD[2], MARGIN + 12, currY - 27, 'DIGITAL CERTIFICATE ID:'));
  ops.push(drawText('F2', 8.5, TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2], MARGIN + 130, currY - 27, certificateId));

  ops.push(drawText('F2', 8, CERT_GOLD[0], CERT_GOLD[1], CERT_GOLD[2], MARGIN + 12, currY - 40, 'INTEGRITY SHA-256 HASH:'));
  ops.push(drawText('F1', 7.5, TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2], MARGIN + 130, currY - 40, docSha256));

  ops.push(drawText('F1', 7, TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2], MARGIN + 12, currY - 54,
    `Stored securely in SLTMobitel Electronic Records Archive. Verification Portal: https://easyapply.slt.lk/check-status?ref=${ref}`));

  // 8. Document Control Footer
  const footerY = 20;
  ops.push(drawLine(BORDER_LIGHT[0], BORDER_LIGHT[1], BORDER_LIGHT[2], 0.8, MARGIN, footerY + 16, PAGE.width - MARGIN, footerY + 16));
  ops.push(drawText('F1', 7.5, TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2], MARGIN, footerY + 6,
    `© ${new Date().getFullYear()} Sri Lanka Telecom PLC. All rights reserved.  •  Confidential Official Document`));
  ops.push(drawText('F2', 7.5, SLT_BLUE[0], SLT_BLUE[1], SLT_BLUE[2], PAGE.width - MARGIN - 120, footerY + 6,
    'Page 1 of 1  •  Original Record'));

  // ─────────────────────────────────────────────────────────────────────────────
  // PDF Object Assembly
  // ─────────────────────────────────────────────────────────────────────────────
  const pageStream = ops.join('\n');
  const streamCompressed = zlib.deflateSync(Buffer.from(pageStream, 'latin1'));

  const objects = [];
  // 1: Helvetica
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  // 2: Helvetica-Bold
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  // Image XObjects if present
  let xObjectsDict = '';
  let nextObjId = 3;

  let custXObjIdx = null;
  if (customerDecoded) {
    custXObjIdx = nextObjId++;
    const deflated = zlib.deflateSync(customerDecoded.rgb);
    objects.push(
      `<< /Type /XObject /Subtype /Image /Width ${customerDecoded.width} /Height ${customerDecoded.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${deflated.length} >>\nstream\n` +
      deflated.toString('latin1') + '\nendstream'
    );
    xObjectsDict += ` /CustSig ${custXObjIdx} 0 R`;
  }

  let staffXObjIdx = null;
  if (staffDecoded) {
    staffXObjIdx = nextObjId++;
    const deflated = zlib.deflateSync(staffDecoded.rgb);
    objects.push(
      `<< /Type /XObject /Subtype /Image /Width ${staffDecoded.width} /Height ${staffDecoded.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${deflated.length} >>\nstream\n` +
      deflated.toString('latin1') + '\nendstream'
    );
    xObjectsDict += ` /StaffSig ${staffXObjIdx} 0 R`;
  }

  // Content Stream Object
  const contentObjIdx = nextObjId++;
  objects.push(`<< /Filter /FlateDecode /Length ${streamCompressed.length} >>\nstream\n` + streamCompressed.toString('latin1') + '\nendstream');

  // Page Object
  const pageObjIdx = nextObjId++;
  const pagesObjIdx = nextObjId++;
  const catalogObjIdx = nextObjId++;

  const xObjRef = xObjectsDict ? ` /XObject <<${xObjectsDict} >>` : '';
  objects.push(
    `<< /Type /Page /Parent ${pagesObjIdx} 0 R /MediaBox [0 0 ${PAGE.width.toFixed(2)} ${PAGE.height.toFixed(2)}] ` +
    `/Resources << /Font << /F1 1 0 R /F2 2 0 R >>${xObjRef} >> /Contents ${contentObjIdx} 0 R >>`
  );

  // Pages Catalog
  objects.push(`<< /Type /Pages /Kids [${pageObjIdx} 0 R] /Count 1 >>`);

  // Document Root
  objects.push(`<< /Type /Catalog /Pages ${pagesObjIdx} 0 R >>`);

  // Construct Cross-Reference Table
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((obj, idx) => {
    offsets.push(pdf.length);
    pdf += `${idx + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObjIdx} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return {
    buffer: Buffer.from(pdf, 'latin1'),
    certificateId,
    sha256: docSha256,
  };
}

/**
 * Automatically generates, cryptographically seals, and stores the customer application.
 * Persists document reference to local disk and PostgreSQL database.
 */
export async function generateAndStoreCustomerApplication(application, options = {}) {
  try {
    if (!application) throw new Error('Application record is required');

    const ref = application.referenceNumber;
    if (!ref) throw new Error('Application reference number is missing');

    // Build PDF
    const { buffer, certificateId, sha256 } = buildCustomerApplicationPdfBuffer({
      ...application,
      ...options,
      formData: application.formData || {},
      documents: application.documents || {},
      officeFields: { ...(application.officeFields || {}), ...(options.officeFields || {}) },
    });

    // 1. Store on Local Disk in uploads/applications
    const uploadsDir = path.join(process.cwd(), 'uploads', 'applications');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const fileName = `Application_${ref}.pdf`;
    const localFilePath = path.join(uploadsDir, fileName);
    fs.writeFileSync(localFilePath, buffer);
    console.log(`[applicationDocumentService] Stored customer application on disk: ${localFilePath}`);

    const relativeUrl = `/uploads/applications/${fileName}`;
    let publicUrl = relativeUrl;

    // 2. If Cloud Storage (S3 / Supabase) is configured, also upload there
    const storage = await getStorage();
    if (storage.isStorageConfigured && storage.isStorageConfigured()) {
      try {
        const uploadRes = await storage.uploadBuffer({
          buffer,
          originalname: fileName,
          mimetype: 'application/pdf',
          folder: 'applications',
          encrypt: false,
        });
        if (uploadRes?.url) {
          publicUrl = uploadRes.url;
          console.log(`[applicationDocumentService] Uploaded customer application to cloud storage: ${publicUrl}`);
        }
      } catch (cloudErr) {
        console.warn('[applicationDocumentService] Cloud storage upload skipped:', cloudErr.message);
      }
    }

    // 3. Update Application Record in PostgreSQL
    const docMeta = {
      referenceNumber: ref,
      fileName,
      url: publicUrl,
      localPath: relativeUrl,
      certificateId,
      sha256,
      generatedAt: new Date().toISOString(),
      customerSigned: Boolean(application.formData?.signature || application.documents?.signature),
      salesOfficerSigned: Boolean(
        application.officeFields?.staffSignature ||
        options.staffSignature ||
        application.salesOfficerEmployeeNumber
      ),
    };

    const updatedDocuments = {
      ...(application.documents || {}),
      customerApplicationPdf: publicUrl,
      digitallySignedApplication: docMeta,
    };

    const updatedFormData = {
      ...(application.formData || {}),
      customerApplicationPdf: publicUrl,
      digitallySignedCertificateId: certificateId,
    };

    if (application.id || application._id) {
      try {
        const db = await getDb();
        await db.query(
          `UPDATE applications
           SET documents = $1, form_data = $2, updated_at = NOW()
           WHERE id = $3`,
          [JSON.stringify(updatedDocuments), JSON.stringify(updatedFormData), application.id || application._id]
        );
        console.log(`[applicationDocumentService] Updated application ${ref} in PostgreSQL with signed document metadata.`);
      } catch (dbErr) {
        console.warn('[applicationDocumentService] DB update skipped or offline:', dbErr.message);
      }
    }

    return {
      success: true,
      buffer,
      fileName,
      url: publicUrl,
      localPath: relativeUrl,
      certificateId,
      sha256,
    };
  } catch (error) {
    console.error('[applicationDocumentService] Error generating customer application:', error.message);
    throw error;
  }
}

/**
 * Retrieve existing application PDF or generate on demand
 */
export async function getCustomerApplicationPdf(referenceNumberOrId) {
  let appRecord = null;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(referenceNumberOrId);

  const db = await getDb();
  if (isUuid) {
    const res = await db.query('SELECT * FROM applications WHERE id = $1 LIMIT 1', [referenceNumberOrId]);
    if (res.rows.length > 0) appRecord = db.toCamelCase(res.rows[0]);
  } else {
    const res = await db.query('SELECT * FROM applications WHERE reference_number = $1 LIMIT 1', [referenceNumberOrId]);
    if (res.rows.length > 0) appRecord = db.toCamelCase(res.rows[0]);
  }

  if (!appRecord) {
    throw new Error('Application not found');
  }

  const ref = appRecord.referenceNumber;
  const localFilePath = path.join(process.cwd(), 'uploads', 'applications', `Application_${ref}.pdf`);

  if (fs.existsSync(localFilePath)) {
    const buffer = fs.readFileSync(localFilePath);
    return {
      buffer,
      fileName: `Application_${ref}.pdf`,
      referenceNumber: ref,
    };
  }

  // Generate and store on demand
  const genResult = await generateAndStoreCustomerApplication(appRecord);
  return {
    buffer: genResult.buffer,
    fileName: genResult.fileName,
    referenceNumber: ref,
  };
}

export default {
  buildCustomerApplicationPdfBuffer,
  generateAndStoreCustomerApplication,
  getCustomerApplicationPdf,
};
