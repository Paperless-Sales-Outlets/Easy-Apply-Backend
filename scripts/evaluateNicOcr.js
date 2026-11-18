// Easy-Apply-Backend/scripts/evaluateNicOcr.js
// Measures NIC OCR accuracy on labelled samples, per engine and per field.
//
// Usage:  npm run ocr:eval -- <samples-dir> [--gemini]
//
// <samples-dir> holds, for each card:
//   <name>.front.jpg   <name>.back.jpg   <name>.json
// where the JSON is the expected result:
//   { "nicNumber": "...", "fullName": "...", "dob": "YYYY-MM-DD", "gender": "Male|Female", "address": "..." }
//
// Keep real NIC images and labels OUTSIDE version control (they are personal data).
// Use this to compare engine/model/parser changes before shipping them.

import fs from 'fs';
import path from 'path';
import { scanNicDocuments } from '../services/ocr/paddleOcrService.js';
import { scanSriLankanNIC } from '../services/ocr/geminiNicService.js';
import { normalizeGeminiResult } from '../services/ocr/nicScanService.js';

const FIELDS = ['nicNumber', 'fullName', 'dob', 'gender', 'address'];
const norm = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const dir = process.argv[2];
const withGemini = process.argv.includes('--gemini');
if (!dir || !fs.existsSync(dir)) {
  console.error('Usage: npm run ocr:eval -- <samples-dir> [--gemini]');
  process.exit(1);
}

const names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
if (!names.length) {
  console.error(`No <name>.json label files found in ${dir}`);
  process.exit(1);
}

const engines = {
  local: (nicFront, nicBack) => scanNicDocuments({ nicFront, nicBack }),
  ...(withGemini && { gemini: async (nicFront, nicBack) => normalizeGeminiResult(await scanSriLankanNIC({ nicFront, nicBack })) }),
};

const read = (name, side) => {
  const file = ['jpg', 'jpeg', 'png'].map((ext) => path.join(dir, `${name}.${side}.${ext}`)).find(fs.existsSync);
  return file ? fs.readFileSync(file) : undefined;
};

for (const [engine, run] of Object.entries(engines)) {
  const hits = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  let scanned = 0;
  for (const name of names) {
    const expected = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
    try {
      const got = await run(read(name, 'front'), read(name, 'back'));
      scanned += 1;
      const row = FIELDS.map((f) => {
        const ok = norm(got[f]) === norm(expected[f]);
        if (ok) hits[f] += 1;
        return `${f}:${ok ? 'ok' : 'MISS'}`;
      });
      console.log(`[${engine}] ${name}  ${row.join('  ')}`);
    } catch (err) {
      console.log(`[${engine}] ${name}  ERROR ${err.message}`);
    }
  }
  console.log(`\n${engine}: ${scanned}/${names.length} scanned`);
  for (const f of FIELDS) console.log(`  ${f.padEnd(10)} ${hits[f]}/${names.length}`);
  console.log('');
}
process.exit(0);
