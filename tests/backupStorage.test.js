import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { LocalStorageAdapter } from '../services/backup/storage/LocalStorageAdapter.js';
import { S3StorageAdapter } from '../services/backup/storage/S3StorageAdapter.js';
import { createStorageAdapter } from '../services/backup/storage/index.js';
import { getConfig } from '../services/backup/config.js';

const readAll = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
};

describe('Local storage adapter', () => {
  let root;
  let source;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-store-'));
    source = path.join(root, 'source.bin');
    fs.writeFileSync(source, 'backup-bytes');
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  test('stores, reads back, reports existence and deletes', async () => {
    const adapter = new LocalStorageAdapter({ rootDir: path.join(root, 'store') });
    await adapter.ensureReady();

    const location = await adapter.put(source, '2026/one.sltbak');
    assert.ok(location.endsWith('one.sltbak'));
    assert.equal(await adapter.exists('2026/one.sltbak'), true);
    assert.equal(fs.existsSync(`${location}.partial`), false, 'no temp file left behind');

    const dest = path.join(root, 'copy.bin');
    await adapter.getToFile('2026/one.sltbak', dest);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'backup-bytes');

    const { stream, size } = await adapter.getReadStream('2026/one.sltbak');
    assert.equal(size, 12);
    assert.equal((await readAll(stream)).toString(), 'backup-bytes');

    const usage = await adapter.usage();
    assert.equal(usage.usedBytes, 12);

    await adapter.delete('2026/one.sltbak');
    assert.equal(await adapter.exists('2026/one.sltbak'), false);
    await adapter.delete('2026/one.sltbak'); // deleting twice must not throw
  });

  test('refuses keys that escape the storage folder', async () => {
    const adapter = new LocalStorageAdapter({ rootDir: path.join(root, 'store2') });
    for (const bad of ['../evil', '/etc/passwd', 'a/../../b', 'a\\b', '']) {
      await assert.rejects(adapter.put(source, bad), /Invalid storage key/, bad);
    }
  });
});

describe('S3 storage adapter', () => {
  const makeClient = () => {
    const calls = [];
    const objects = new Map();
    return {
      calls,
      objects,
      async send(command) {
        const name = command.constructor.name;
        const input = command.input;
        calls.push({ name, input });
        if (name === 'PutObjectCommand') {
          objects.set(input.Key, await readAll(input.Body));
          return {};
        }
        if (name === 'GetObjectCommand') {
          if (!objects.has(input.Key)) throw new Error('NoSuchKey');
          const body = objects.get(input.Key);
          return { Body: Readable.from([body]), ContentLength: body.length };
        }
        if (name === 'HeadObjectCommand') {
          if (!objects.has(input.Key)) throw new Error('NotFound');
          return {};
        }
        if (name === 'DeleteObjectCommand') {
          objects.delete(input.Key);
          return {};
        }
        if (name === 'ListObjectsV2Command') {
          return {
            Contents: [...objects].filter(([k]) => k.startsWith(input.Prefix)).map(([Key, v]) => ({ Key, Size: v.length })),
            IsTruncated: false,
          };
        }
        return {};
      },
    };
  };

  let dir;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-s3-'));
    fs.writeFileSync(path.join(dir, 'f.bin'), 'encrypted-backup');
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('puts, gets, checks, lists usage and deletes under the configured prefix', async () => {
    const client = makeClient();
    const adapter = new S3StorageAdapter({ bucket: 'slt-backups', prefix: 'prod', client });
    await adapter.ensureReady();

    const location = await adapter.put(path.join(dir, 'f.bin'), '2026/x.sltbak');
    assert.equal(location, 's3://slt-backups/prod/2026/x.sltbak');
    const put = client.calls.find((c) => c.name === 'PutObjectCommand');
    assert.equal(put.input.Bucket, 'slt-backups');
    assert.equal(put.input.ContentLength, 16);

    assert.equal(await adapter.exists('2026/x.sltbak'), true);
    assert.equal(await adapter.exists('2026/missing.sltbak'), false);

    const dest = path.join(dir, 'got.bin');
    await adapter.getToFile('2026/x.sltbak', dest);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'encrypted-backup');

    assert.deepEqual(await adapter.usage(), { usedBytes: 16, availableBytes: null, totalBytes: null });

    await adapter.delete('2026/x.sltbak');
    assert.equal(client.objects.size, 0);
  });

  test('describe() never includes credentials', () => {
    const adapter = new S3StorageAdapter({
      endpoint: 'https://minio.internal:9000',
      bucket: 'b',
      accessKeyId: 'AKIA-SECRET-ID',
      secretAccessKey: 'super-secret-key',
      client: makeClient(),
    });
    const text = adapter.describe();
    assert.ok(text.includes('minio.internal:9000'));
    assert.ok(!text.includes('SECRET') && !text.includes('secret'));
  });

  test('ensureReady explains a missing bucket', async () => {
    const adapter = new S3StorageAdapter({ bucket: '', client: makeClient() });
    await assert.rejects(adapter.ensureReady(), (e) => e.code === 'STORAGE_NOT_READY');
  });
});

describe('Storage selection (BACKUP_STORAGE)', () => {
  const saved = { storage: process.env.BACKUP_STORAGE, path: process.env.BACKUP_LOCAL_PATH };
  after(() => {
    for (const [key, value] of [['BACKUP_STORAGE', saved.storage], ['BACKUP_LOCAL_PATH', saved.path]]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('defaults to local', () => {
    delete process.env.BACKUP_STORAGE;
    assert.equal(createStorageAdapter(getConfig()).name, 'local');
  });

  test('switches to s3 by environment variable alone', () => {
    process.env.BACKUP_STORAGE = 's3';
    process.env.BACKUP_S3_BUCKET = 'bucket';
    assert.equal(createStorageAdapter(getConfig()).name, 's3');
    delete process.env.BACKUP_S3_BUCKET;
  });

  test('rejects an unknown value', () => {
    process.env.BACKUP_STORAGE = 'ftp';
    assert.throws(() => createStorageAdapter(getConfig()), (e) => e.code === 'STORAGE_NOT_CONFIGURED');
  });
});
