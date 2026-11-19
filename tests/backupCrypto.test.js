import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encryptFile, decryptFile, sha256File, getBackupKey } from '../services/backup/crypto.js';
import { redact, BackupError } from '../services/backup/errors.js';
import { tablesFromToc } from '../services/backup/backupService.js';
import { issueDownloadToken, consumeDownloadToken, clearDownloadTokensForTests } from '../services/backup/downloadTokens.js';

describe('Backup encryption, checksums and helpers', () => {
  let dir;
  let savedKey;

  before(() => {
    savedKey = process.env.BACKUP_ENCRYPTION_KEY;
    process.env.BACKUP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-crypto-'));
  });

  after(() => {
    if (savedKey === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
    else process.env.BACKUP_ENCRYPTION_KEY = savedKey;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('encrypts and decrypts a file back to the original bytes', async () => {
    const plain = path.join(dir, 'plain.bin');
    const enc = path.join(dir, 'plain.sltbak');
    const out = path.join(dir, 'out.bin');
    const data = crypto.randomBytes(3 * 1024 * 1024 + 17); // spans several stream chunks
    fs.writeFileSync(plain, data);

    const { size, sha256 } = await encryptFile(plain, enc);
    assert.equal(size, fs.statSync(enc).size);
    assert.equal(sha256, await sha256File(enc), 'returned checksum describes the encrypted file');
    assert.notDeepEqual(fs.readFileSync(enc).subarray(17, 100), data.subarray(0, 83), 'ciphertext differs from plaintext');
    assert.equal(fs.readFileSync(enc).subarray(0, 4).toString(), 'SLTB');

    await decryptFile(enc, out);
    assert.ok(fs.readFileSync(out).equals(data));
  });

  test('refuses a wrong key', async () => {
    const plain = path.join(dir, 'a.bin');
    const enc = path.join(dir, 'a.sltbak');
    fs.writeFileSync(plain, 'customer data');
    await encryptFile(plain, enc);
    await assert.rejects(
      decryptFile(enc, path.join(dir, 'a.out'), crypto.randomBytes(32)),
      (error) => error instanceof BackupError && error.code === 'DECRYPT_FAILED'
    );
    assert.equal(fs.existsSync(path.join(dir, 'a.out')), false, 'no partial plaintext is left behind');
  });

  test('detects a tampered file', async () => {
    const plain = path.join(dir, 'b.bin');
    const enc = path.join(dir, 'b.sltbak');
    fs.writeFileSync(plain, crypto.randomBytes(5000));
    await encryptFile(plain, enc);
    const bytes = fs.readFileSync(enc);
    bytes[100] ^= 0xff;
    fs.writeFileSync(enc, bytes);
    await assert.rejects(decryptFile(enc, path.join(dir, 'b.out')), (e) => e.code === 'DECRYPT_FAILED');
  });

  test('requires BACKUP_ENCRYPTION_KEY and never falls back to another secret', () => {
    const current = process.env.BACKUP_ENCRYPTION_KEY;
    try {
      delete process.env.BACKUP_ENCRYPTION_KEY;
      assert.throws(() => getBackupKey(), (e) => e.code === 'ENCRYPTION_NOT_CONFIGURED');
      process.env.BACKUP_ENCRYPTION_KEY = 'too-short';
      assert.throws(() => getBackupKey(), (e) => e.code === 'ENCRYPTION_KEY_INVALID');
      process.env.BACKUP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
      assert.equal(getBackupKey().length, 32);
    } finally {
      process.env.BACKUP_ENCRYPTION_KEY = current;
    }
  });

  test('redact removes credentials and secret values from text', () => {
    const key = process.env.BACKUP_ENCRYPTION_KEY;
    const text = `failed postgresql://admin:Sup3rSecret@db.example.com:5432/app and key ${key}`;
    const clean = redact(text);
    assert.ok(!clean.includes('Sup3rSecret'));
    assert.ok(!clean.includes(key));
    assert.ok(clean.includes('postgresql://***@db.example.com'));
  });

  test('tablesFromToc lists the tables of a pg_restore --list output', () => {
    const toc = [
      '; Archive created at 2026-11-19',
      '215; 1259 16400 TABLE public users postgres',
      '4912; 0 16400 TABLE DATA public users postgres',
      '218; 1259 16410 TABLE public applications postgres',
    ].join('\n');
    assert.deepEqual(tablesFromToc(toc), ['users', 'applications']);
  });

  describe('download links', () => {
    test('are single use', () => {
      clearDownloadTokensForTests();
      const { token } = issueDownloadToken({ userId: 'u1', backupId: 'b1' });
      assert.equal(consumeDownloadToken(token, { userId: 'u1' }).backupId, 'b1');
      assert.throws(() => consumeDownloadToken(token, { userId: 'u1' }), (e) => e.code === 'LINK_EXPIRED');
    });

    test('only work for the user they were issued to (and are burned by a wrong attempt)', () => {
      clearDownloadTokensForTests();
      const { token } = issueDownloadToken({ userId: 'u1', backupId: 'b1' });
      assert.throws(() => consumeDownloadToken(token, { userId: 'u2' }), (e) => e.code === 'LINK_FORBIDDEN');
      assert.throws(() => consumeDownloadToken(token, { userId: 'u1' }), (e) => e.code === 'LINK_EXPIRED');
    });

    test('expire', () => {
      clearDownloadTokensForTests();
      const saved = process.env.BACKUP_DOWNLOAD_TTL_SEC;
      process.env.BACKUP_DOWNLOAD_TTL_SEC = '1';
      const { token } = issueDownloadToken({ userId: 'u1', backupId: 'b1' });
      const realNow = Date.now;
      Date.now = () => realNow() + 5000;
      try {
        assert.throws(() => consumeDownloadToken(token, { userId: 'u1' }), (e) => e.code === 'LINK_EXPIRED');
      } finally {
        Date.now = realNow;
        if (saved === undefined) delete process.env.BACKUP_DOWNLOAD_TTL_SEC;
        else process.env.BACKUP_DOWNLOAD_TTL_SEC = saved;
      }
    });
  });
});
