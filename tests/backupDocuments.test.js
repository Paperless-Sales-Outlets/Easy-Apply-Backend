import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  documentBackupSettings, assertDocumentBackupReady, downloadBuckets, restoreBuckets,
} from '../services/backup/documentStorage.js';

// The optional "include the customer-document storage bucket" part of a backup,
// against an in-memory S3 (no network). Real-server coverage is in
// tests/integration/backupE2E.test.js.

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-docs-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

/** Minimal in-memory S3: buckets of objects, list pagination (2 per page), get, put, delete, head. */
const fakeS3 = (buckets) => {
  const store = new Map(Object.entries(buckets).map(([name, objs]) => [name, new Map(Object.entries(objs))]));
  const calls = [];
  return {
    store,
    calls,
    async send(command) {
      const name = command.constructor.name;
      const i = command.input;
      calls.push(`${name}:${i.Bucket}${i.Key ? `/${i.Key}` : ''}`);
      const bucket = store.get(i.Bucket);
      if (name === 'HeadBucketCommand') {
        if (!bucket) throw new Error('NoSuchBucket');
        return {};
      }
      if (!bucket) throw new Error('NoSuchBucket');
      if (name === 'ListObjectsV2Command') {
        const keys = [...bucket.keys()].sort();
        const start = i.ContinuationToken ? Number(i.ContinuationToken) : 0;
        const page = keys.slice(start, start + 2);
        const more = start + 2 < keys.length;
        return {
          Contents: page.map((Key) => ({ Key, Size: bucket.get(Key).body.length })),
          IsTruncated: more,
          NextContinuationToken: more ? String(start + 2) : undefined,
        };
      }
      if (name === 'GetObjectCommand') {
        const obj = bucket.get(i.Key);
        if (!obj) throw new Error('NoSuchKey');
        return { Body: Readable.from([obj.body]), ContentType: obj.type, Metadata: obj.meta };
      }
      if (name === 'PutObjectCommand') {
        bucket.set(i.Key, { body: Buffer.from(i.Body), type: i.ContentType, meta: i.Metadata });
        return {};
      }
      if (name === 'DeleteObjectCommand') {
        bucket.delete(i.Key);
        return {};
      }
      throw new Error(`unexpected ${name}`);
    },
  };
};

const obj = (text, type = 'image/png', meta) => ({ body: Buffer.from(text), type, meta });

describe('settings', () => {
  test('are OFF by default', () => {
    const s = documentBackupSettings({});
    assert.equal(s.enabled, false);
    assert.deepEqual(s.buckets, ['kyc-documents']);
    assert.equal(s.configured, false);
  });

  test('only the exact value "true" turns it on', () => {
    for (const value of ['', 'false', '1', 'yes', 'TRUEISH']) {
      assert.equal(documentBackupSettings({ BACKUP_INCLUDE_SUPABASE_STORAGE: value }).enabled, false, value);
    }
    assert.equal(documentBackupSettings({ BACKUP_INCLUDE_SUPABASE_STORAGE: 'true' }).enabled, true);
    assert.equal(documentBackupSettings({ BACKUP_INCLUDE_SUPABASE_STORAGE: ' TRUE ' }).enabled, true);
  });

  test('buckets come from BACKUP_SUPABASE_BUCKETS, else STORAGE_BUCKET', () => {
    assert.deepEqual(documentBackupSettings({ STORAGE_BUCKET: 'docs' }).buckets, ['docs']);
    assert.deepEqual(documentBackupSettings({ STORAGE_BUCKET: 'docs', BACKUP_SUPABASE_BUCKETS: ' a , b ,,c ' }).buckets, ['a', 'b', 'c']);
    assert.equal(documentBackupSettings({ STORAGE_ACCESS_KEY: 'k', STORAGE_SECRET_KEY: 's' }).configured, true);
  });
});

describe('readiness check', () => {
  test('explains missing credentials and unreachable buckets', async () => {
    await assert.rejects(assertDocumentBackupReady(fakeS3({}), { enabled: true, configured: false, buckets: ['x'] }), (e) => e.code === 'DOCUMENTS_NOT_CONFIGURED');
    await assert.rejects(
      assertDocumentBackupReady(fakeS3({ other: {} }), { enabled: true, configured: true, buckets: ['kyc-documents'] }),
      (e) => e.code === 'DOCUMENTS_UNREACHABLE' && /kyc-documents/.test(e.message)
    );
    await assertDocumentBackupReady(fakeS3({ docs: {} }), { enabled: true, configured: true, buckets: ['docs'] });
  });
});

describe('downloading the bucket into a backup', () => {
  test('copies every object (across list pages) byte for byte, with type and metadata', async () => {
    const client = fakeS3({
      docs: {
        'documents/1-front.png': obj('front-bytes', 'image/png', { 'x-encrypted': 'true' }),
        'documents/2-back.png': obj('back-bytes'),
        'documents/සිංහල:odd key?.pdf': obj('%PDF unicode', 'application/pdf'),
        'signatures/3.png': obj('sig'),
        'zzz/last.bin': obj('x'.repeat(5000), 'application/octet-stream'),
      },
    });
    const dest = path.join(root, 'dl1');
    const summary = await downloadBuckets(client, ['docs'], dest);

    assert.deepEqual(summary, { buckets: [{ bucket: 'docs', count: 5, bytes: 11 + 10 + 12 + 3 + 5000 }] });
    const index = JSON.parse(fs.readFileSync(path.join(dest, 'index.json'), 'utf8'));
    assert.equal(index.buckets[0].objects.length, 5);
    for (const entry of index.buckets[0].objects) {
      const original = client.store.get('docs').get(entry.key);
      assert.ok(fs.readFileSync(path.join(dest, entry.file)).equals(original.body), entry.key);
      assert.equal(entry.contentType, original.type);
    }
    const front = index.buckets[0].objects.find((o) => o.key === 'documents/1-front.png');
    assert.deepEqual(front.metadata, { 'x-encrypted': 'true' });
    // files are named by index, so odd key characters never reach the filesystem
    assert.ok(index.buckets[0].objects.every((o) => /^\d+-\d+\.bin$/.test(o.file)));
  });

  test('handles several buckets and an empty bucket', async () => {
    const client = fakeS3({ a: { 'k.txt': obj('1', 'text/plain') }, b: {} });
    const summary = await downloadBuckets(client, ['a', 'b'], path.join(root, 'dl2'));
    assert.deepEqual(summary.buckets, [{ bucket: 'a', count: 1, bytes: 1 }, { bucket: 'b', count: 0, bytes: 0 }]);
  });

  test('never writes to the bucket', async () => {
    const client = fakeS3({ docs: { 'a.png': obj('a') } });
    await downloadBuckets(client, ['docs'], path.join(root, 'dl3'));
    assert.ok(!client.calls.some((c) => c.startsWith('PutObject') || c.startsWith('DeleteObject')));
  });
});

describe('restoring the bucket', () => {
  const seed = async (live) => {
    const backupClient = fakeS3({ docs: { 'one.png': obj('ONE'), 'two.png': obj('TWO', 'image/jpeg', { 'x-encrypted': 'true' }) } });
    const dir = path.join(root, `rs-${crypto.randomBytes(3).toString('hex')}`);
    await downloadBuckets(backupClient, ['docs'], dir);
    return { dir, live: fakeS3({ docs: live }) };
  };

  test('puts the backed-up objects back, overwriting changed ones and re-creating missing ones', async () => {
    const { dir, live } = await seed({ 'one.png': obj('CHANGED'), 'unrelated.png': obj('keep me') });
    const result = await restoreBuckets(live, dir);
    assert.deepEqual(result, { uploaded: 2, deleted: 0 });
    const docs = live.store.get('docs');
    assert.equal(docs.get('one.png').body.toString(), 'ONE');
    assert.equal(docs.get('two.png').body.toString(), 'TWO');
    assert.equal(docs.get('two.png').type, 'image/jpeg');
    assert.deepEqual(docs.get('two.png').meta, { 'x-encrypted': 'true' });
  });

  test('NEVER deletes files that are not in the backup by default', async () => {
    const { dir, live } = await seed({ 'unrelated.png': obj('keep me'), 'new-after-backup.png': obj('customer upload') });
    const result = await restoreBuckets(live, dir);
    assert.equal(result.deleted, 0);
    assert.ok(!live.calls.some((c) => c.startsWith('DeleteObject')));
    assert.equal(live.store.get('docs').get('unrelated.png').body.toString(), 'keep me');
    assert.equal(live.store.get('docs').get('new-after-backup.png').body.toString(), 'customer upload');
  });

  test('deletes extra files only when explicitly asked, and only those not in the backup', async () => {
    const { dir, live } = await seed({ 'one.png': obj('CHANGED'), 'extra-1.png': obj('x'), 'extra-2.png': obj('y'), 'extra-3.png': obj('z') });
    const result = await restoreBuckets(live, dir, { deleteExtra: true });
    assert.deepEqual(result, { uploaded: 2, deleted: 3 });
    assert.deepEqual([...live.store.get('docs').keys()].sort(), ['one.png', 'two.png']);
    assert.equal(live.store.get('docs').get('one.png').body.toString(), 'ONE');
  });
});
