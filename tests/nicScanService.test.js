// Easy-Apply-Backend/tests/nicScanService.test.js
// Engine selection logic, tested with fake engines (no network, no model).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNicScanner, getEngineMode, normalizeGeminiResult } from '../services/ocr/nicScanService.js';

const GEMINI_OK = {
  nicNumber: '199212345678', fullName: 'KAMAL PERERA', address: 'No 1, Galle Road, Moratuwa',
  city: 'Moratuwa', district: 'Colombo', dob: '1992-05-02', gender: 'Male', engine: 'GEMINI_FLASH_VISION',
};
const LOCAL_OK = { success: true, engine: 'PADDLE_OCR_NODE_ONNX', nicNumber: '199212345678', fullName: 'KAMAL PERERA' };

/** A fake engine that records its calls. */
const fake = (impl) => {
  const fn = async (args) => { fn.calls += 1; return impl(args); };
  fn.calls = 0;
  return fn;
};
const IMG = 'data:image/png;base64,AAAA';

test('getEngineMode', async (t) => {
  await t.test('defaults to auto', () => assert.equal(getEngineMode({}), 'auto'));
  await t.test('accepts local / gemini case-insensitively', () => {
    assert.equal(getEngineMode({ NIC_OCR_ENGINE: ' LOCAL ' }), 'local');
    assert.equal(getEngineMode({ NIC_OCR_ENGINE: 'gemini' }), 'gemini');
  });
  await t.test('unknown value falls back to auto', () => assert.equal(getEngineMode({ NIC_OCR_ENGINE: 'tesseract' }), 'auto'));
});

test('normalizeGeminiResult', async (t) => {
  await t.test('complete result', () => {
    const r = normalizeGeminiResult(GEMINI_OK);
    assert.equal(r.success, true);
    assert.equal(r.extractionStatus, 'COMPLETE');
    assert.equal(r.fetchedCount, 5);
    assert.equal(r.suggestedTitle, 'Mr.');
    assert.equal(r.serviceArea, 'Moratuwa, Colombo');
  });
  await t.test('missing NIC is FAILED, missing address is PARTIAL', () => {
    assert.equal(normalizeGeminiResult({ ...GEMINI_OK, nicNumber: '' }).extractionStatus, 'FAILED');
    const partial = normalizeGeminiResult({ ...GEMINI_OK, address: '' });
    assert.equal(partial.extractionStatus, 'PARTIAL');
    assert.deepEqual(partial.missingFields, ['address']);
  });
});

test('createNicScanner', async (t) => {
  await t.test('rejects a request with no images', async () => {
    const scan = createNicScanner({ gemini: fake(() => GEMINI_OK), local: fake(() => LOCAL_OK), getMode: () => 'auto' });
    await assert.rejects(() => scan({}), /At least one NIC image/);
  });

  await t.test('auto: uses Gemini and skips the local model when Gemini succeeds', async () => {
    const gemini = fake(() => GEMINI_OK); const local = fake(() => LOCAL_OK);
    const r = await createNicScanner({ gemini, local, getMode: () => 'auto' })({ nicFront: IMG });
    assert.equal(r.engine, 'GEMINI_FLASH_VISION');
    assert.equal(local.calls, 0);
  });

  await t.test('auto: falls back to local when Gemini throws, and reports why', async () => {
    const gemini = fake(() => { throw new Error('quota exceeded'); }); const local = fake(() => LOCAL_OK);
    const r = await createNicScanner({ gemini, local, getMode: () => 'auto' })({ nicFront: IMG });
    assert.equal(r.engine, 'PADDLE_OCR_NODE_ONNX');
    assert.equal(r.fallbackReason, 'quota exceeded');
  });

  await t.test('auto: falls back to local when Gemini reads no NIC number', async () => {
    const gemini = fake(() => ({ ...GEMINI_OK, nicNumber: '' })); const local = fake(() => LOCAL_OK);
    const r = await createNicScanner({ gemini, local, getMode: () => 'auto' })({ nicFront: IMG });
    assert.equal(r.engine, 'PADDLE_OCR_NODE_ONNX');
    assert.match(r.fallbackReason, /could not read a NIC number/);
  });

  await t.test('auto: a back-only scan goes straight to local', async () => {
    const gemini = fake(() => GEMINI_OK); const local = fake(() => LOCAL_OK);
    await createNicScanner({ gemini, local, getMode: () => 'auto' })({ nicBack: IMG });
    assert.equal(gemini.calls, 0);
    assert.equal(local.calls, 1);
  });

  await t.test('local: never calls Gemini and passes expectedNIC through', async () => {
    const gemini = fake(() => GEMINI_OK);
    let seen;
    const local = fake((args) => { seen = args; return LOCAL_OK; });
    const r = await createNicScanner({ gemini, local, getMode: () => 'local' })({ nicFront: IMG, expectedNIC: '199212345678' });
    assert.equal(gemini.calls, 0);
    assert.equal(r.engine, 'PADDLE_OCR_NODE_ONNX');
    assert.equal(seen.expectedNIC, '199212345678');
  });

  await t.test('gemini: failure is reported without trying the local model', async () => {
    const gemini = fake(() => { throw new Error('boom'); }); const local = fake(() => LOCAL_OK);
    await assert.rejects(() => createNicScanner({ gemini, local, getMode: () => 'gemini' })({ nicFront: IMG }), /Gemini: boom/);
    assert.equal(local.calls, 0);
  });

  await t.test('auto: throws a clear error when both engines fail', async () => {
    const gemini = fake(() => { throw new Error('g'); }); const local = fake(() => { throw new Error('model missing'); });
    await assert.rejects(() => createNicScanner({ gemini, local, getMode: () => 'auto' })({ nicFront: IMG }), /all OCR engines: model missing/);
  });
});
