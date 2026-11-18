// Easy-Apply-Backend/tests/ocr.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { scanNicDocuments } from '../services/ocr/paddleOcrService.js';
import { extractNICFromText, cleanNIC, deriveGenderAndDOBFromNIC } from '../utils/nicParser.js';

test('Sri Lankan NIC parsing utilities', async (t) => {
  await t.test('cleanNIC normalizes characters and removes spaces', () => {
    assert.strictEqual(cleanNIC(' 1995-1234-5678 '), '199512345678');
    assert.strictEqual(cleanNIC('851234567 v'), '851234567V');
  });

  await t.test('deriveGenderAndDOBFromNIC decodes correct DOB and Gender', () => {
    const male = deriveGenderAndDOBFromNIC('199212345678');
    assert.strictEqual(male.gender, 'Male');
    assert.strictEqual(male.dob, '1992-05-02');

    const female = deriveGenderAndDOBFromNIC('199262345678');
    assert.strictEqual(female.gender, 'Female');
    assert.strictEqual(female.dob, '1992-05-02');
  });

  await t.test('extractNICFromText extracts valid NIC from noisy text', () => {
    const text = 'REPUBLIC OF SRI LANKA NATIONAL IDENTITY CARD 199512345678 HOLDER SIGNATURE';
    const result = extractNICFromText(text);
    assert.ok(result);
    assert.strictEqual(result.nic, '199512345678');
  });
});

test('PaddleOCR Deep Learning Engine on synthetic NIC card', async (t) => {
  await t.test('extracts NIC number and Name from synthetic front image', async () => {
    const frontSvg = Buffer.from(`
      <svg width="600" height="180" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        <text x="30" y="45" font-family="Arial" font-size="22" font-weight="bold" fill="black">SRI LANKA IDENTITY CARD</text>
        <text x="30" y="85" font-family="Arial" font-size="28" font-weight="bold" fill="black">199212345678</text>
        <text x="30" y="125" font-family="Arial" font-size="20" font-weight="bold" fill="black">Name: KAMAL PERERA</text>
      </svg>
    `);
    const frontPng = await sharp(frontSvg).png().toBuffer();

    const result = await scanNicDocuments({ nicFront: frontPng });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.engine, 'PADDLE_OCR_NODE_ONNX');
    assert.strictEqual(result.nicNumber, '199212345678');
    assert.strictEqual(result.fullName, 'KAMAL PERERA');
    assert.strictEqual(result.dob, '1992-05-02');
    assert.strictEqual(result.gender, 'Male');
    assert.strictEqual(result.suggestedTitle, 'Mr.');
    assert.ok(result.fetchedCount >= 4);
  });
});

test('NIC scan falls back to local PaddleOCR when Gemini is unavailable', async () => {
  const savedKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = ''; // empty (dotenv won't override) forces the Gemini engine to throw
  try {
    const svg = Buffer.from(`
      <svg width="600" height="180" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="white"/>
        <text x="30" y="85" font-family="Arial" font-size="28" font-weight="bold" fill="black">199212345678</text>
      </svg>`);
    const png = await sharp(svg).png().toBuffer();
    const { scanNic } = await import('../services/ocr/nicScanService.js');
    const result = await scanNic({ nicFront: png });
    assert.strictEqual(result.engine, 'PADDLE_OCR_NODE_ONNX');
    assert.ok(result.fallbackReason);
    assert.strictEqual(result.nicNumber, '199212345678');
  } finally {
    if (savedKey !== undefined) process.env.GEMINI_API_KEY = savedKey;
  }
});

test('Local OCR reads every field from a synthetic two-sided NIC', async () => {
  const card = (lines) => sharp(Buffer.from(`
    <svg width="900" height="320" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#fdf6d8"/>
      ${lines.map(([y, size, text]) => `<text x="30" y="${y}" font-family="Arial" font-size="${size}" font-weight="bold" fill="black">${text}</text>`).join('')}
    </svg>`)).png().toBuffer();

  const nicFront = await card([
    [50, 26, 'NATIONAL IDENTITY CARD'],
    [105, 36, 'No.: 199212345678'],
    [165, 28, 'Name: KAMAL PERERA'],
    [225, 26, 'Sex: Male'],
    [280, 26, 'Date of Birth: 1992/05/02'],
  ]);
  const nicBack = await card([
    [50, 26, 'Address:'],
    [110, 28, 'C12/3/4, LAKE FLATS,'],
    [160, 28, 'LAKEPURA, MORATUWA.'],
    [250, 24, 'Date of Issue: 2020/05/19'],
  ]);

  const result = await scanNicDocuments({ nicFront, nicBack });
  assert.strictEqual(result.nicNumber, '199212345678');
  assert.strictEqual(result.fullName, 'KAMAL PERERA');
  assert.strictEqual(result.dob, '1992-05-02');
  assert.strictEqual(result.gender, 'Male');
  assert.match(result.address, /LAKE FLATS/);
  assert.match(result.address, /MORATUWA/);
  assert.strictEqual(result.engine, 'PADDLE_OCR_NODE_ONNX');
});
