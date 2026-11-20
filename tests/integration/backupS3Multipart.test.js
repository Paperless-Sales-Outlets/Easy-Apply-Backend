import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { S3StorageAdapter, plannedPartSize, MULTIPART_THRESHOLD } from '../../services/backup/storage/S3StorageAdapter.js';
import { sha256File } from '../../services/backup/crypto.js';

const MIB = 1024 * 1024;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-mp-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const makeFile = (name, bytes) => {
  const file = path.join(dir, name);
  const fd = fs.openSync(file, 'w');
  const chunk = crypto.randomBytes(MIB);
  for (let written = 0; written < bytes; written += MIB) fs.writeSync(fd, chunk, 0, Math.min(MIB, bytes - written));
  fs.closeSync(fd);
  return file;
};

// A fake S3 client that records the calls the adapter makes.
const recordingClient = ({ failPart = null, failTimes = 0 } = {}) => {
  const calls = [];
  const uploaded = new Map();
  let failures = 0;
  return {
    calls,
    uploaded,
    async send(command) {
      const name = command.constructor.name;
      const input = command.input;
      calls.push({ name, input: { ...input, Body: input.Body ? `<${input.Body.length ?? '?'} bytes>` : undefined } });
      if (name === 'CreateMultipartUploadCommand') return { UploadId: 'upload-1' };
      if (name === 'UploadPartCommand') {
        if (failPart === input.PartNumber && failures < failTimes) {
          failures += 1;
          throw new Error('network blip');
        }
        uploaded.set(input.PartNumber, Buffer.from(input.Body));
        return { ETag: `"etag-${input.PartNumber}"` };
      }
      return {};
    },
  };
};

describe('S3 multipart upload', () => {
  test('part size grows so even a huge backup stays under 10,000 parts', () => {
    assert.equal(plannedPartSize(100 * MIB), 16 * MIB);
    const sixtyGB = 60 * 1024 * MIB;
    assert.ok(Math.ceil(sixtyGB / plannedPartSize(sixtyGB)) <= 10000);
    const fiveTB = 5 * 1024 * 1024 * MIB;
    assert.ok(Math.ceil(fiveTB / plannedPartSize(fiveTB)) <= 10000);
    assert.equal(MULTIPART_THRESHOLD, 64 * MIB);
  });

  test('a small file is a single PutObject', async () => {
    const client = recordingClient();
    const adapter = new S3StorageAdapter({ bucket: 'b', client });
    await adapter.put(makeFile('small.bin', 3 * MIB), '2026/small.sltbak');
    assert.deepEqual(client.calls.map((c) => c.name), ['PutObjectCommand']);
  });

  test('a large file is uploaded in order, part by part, and completed', async () => {
    const client = recordingClient();
    const adapter = new S3StorageAdapter({ bucket: 'b', prefix: 'p', client, multipartThreshold: 8 * MIB, partSize: 5 * MIB });
    const file = makeFile('large.bin', 12 * MIB);
    const location = await adapter.put(file, '2026/large.sltbak');

    assert.equal(location, 's3://b/p/2026/large.sltbak');
    assert.deepEqual(client.calls.map((c) => c.name), [
      'CreateMultipartUploadCommand',
      'UploadPartCommand',
      'UploadPartCommand',
      'UploadPartCommand',
      'CompleteMultipartUploadCommand',
    ]);
    assert.deepEqual([...client.uploaded.keys()], [1, 2, 3]);
    assert.deepEqual([...client.uploaded.values()].map((b) => b.length), [5 * MIB, 5 * MIB, 2 * MIB]);
    assert.ok(Buffer.concat([...client.uploaded.values()]).equals(fs.readFileSync(file)), 'parts reassemble to the original file');
    const complete = client.calls.at(-1).input;
    assert.deepEqual(complete.MultipartUpload.Parts, [
      { ETag: '"etag-1"', PartNumber: 1 },
      { ETag: '"etag-2"', PartNumber: 2 },
      { ETag: '"etag-3"', PartNumber: 3 },
    ]);
  });

  test('a failed part is retried', async () => {
    const client = recordingClient({ failPart: 2, failTimes: 2 });
    const adapter = new S3StorageAdapter({ bucket: 'b', client, multipartThreshold: 8 * MIB, partSize: 5 * MIB });
    await adapter.put(makeFile('retry.bin', 12 * MIB), '2026/retry.sltbak');
    assert.equal(client.calls.filter((c) => c.name === 'UploadPartCommand' && c.input.PartNumber === 2).length, 3);
    assert.equal(client.calls.at(-1).name, 'CompleteMultipartUploadCommand');
  });

  test('a part that keeps failing aborts the upload so no orphaned parts are left', async () => {
    const client = recordingClient({ failPart: 2, failTimes: 99 });
    const adapter = new S3StorageAdapter({ bucket: 'b', client, multipartThreshold: 8 * MIB, partSize: 5 * MIB });
    await assert.rejects(adapter.put(makeFile('abort.bin', 12 * MIB), '2026/abort.sltbak'), /network blip/);
    const names = client.calls.map((c) => c.name);
    assert.equal(names.at(-1), 'AbortMultipartUploadCommand');
    assert.ok(!names.includes('CompleteMultipartUploadCommand'));
    assert.equal(client.calls.at(-1).input.UploadId, 'upload-1');
  });
});

// Against a REAL S3-compatible server (MinIO, rclone serve s3, ...), when configured:
//   BACKUP_TEST_S3_ENDPOINT, BACKUP_TEST_S3_BUCKET, BACKUP_TEST_S3_ACCESS_KEY, BACKUP_TEST_S3_SECRET_KEY
const realServer = process.env.BACKUP_TEST_S3_ENDPOINT
  ? false
  : 'set BACKUP_TEST_S3_ENDPOINT / _BUCKET / _ACCESS_KEY / _SECRET_KEY to test against a real S3-compatible server';

describe('S3 adapter against a real S3-compatible server', { skip: realServer }, () => {
  const make = (extra = {}) =>
    new S3StorageAdapter({
      endpoint: process.env.BACKUP_TEST_S3_ENDPOINT,
      bucket: process.env.BACKUP_TEST_S3_BUCKET,
      accessKeyId: process.env.BACKUP_TEST_S3_ACCESS_KEY,
      secretAccessKey: process.env.BACKUP_TEST_S3_SECRET_KEY,
      prefix: `mp-${crypto.randomBytes(4).toString('hex')}`,
      region: 'us-east-1',
      ...extra,
    });

  test('ensureReady, put, exists, read back, stream, usage and delete', async () => {
    const adapter = make();
    await adapter.ensureReady();
    const file = makeFile('real-small.bin', 2 * MIB);
    await adapter.put(file, '2026/real-small.sltbak');
    assert.equal(await adapter.exists('2026/real-small.sltbak'), true);
    const back = path.join(dir, 'real-small.back');
    await adapter.getToFile('2026/real-small.sltbak', back);
    assert.equal(await sha256File(back), await sha256File(file));
    const { stream, size } = await adapter.getReadStream('2026/real-small.sltbak');
    assert.equal(size, 2 * MIB);
    stream.destroy();
    assert.equal((await adapter.usage()).usedBytes, 2 * MIB);
    await adapter.delete('2026/real-small.sltbak');
    assert.equal(await adapter.exists('2026/real-small.sltbak'), false);
    await adapter.delete('2026/real-small.sltbak'); // idempotent
  });

  test('multipart upload (forced small parts) round-trips byte for byte', async () => {
    const adapter = make({ multipartThreshold: 8 * MIB, partSize: 5 * MIB });
    const sent = [];
    const original = adapter.client.send.bind(adapter.client);
    adapter.client.send = (command) => {
      sent.push(command.constructor.name);
      return original(command);
    };
    const file = makeFile('real-multi.bin', 23 * MIB);
    await adapter.put(file, '2026/real-multi.sltbak');
    assert.equal(sent.filter((n) => n === 'UploadPartCommand').length, 5); // 5+5+5+5+3 MiB
    assert.ok(sent.includes('CompleteMultipartUploadCommand'));
    const back = path.join(dir, 'real-multi.back');
    await adapter.getToFile('2026/real-multi.sltbak', back);
    assert.equal(await sha256File(back), await sha256File(file));
    await adapter.delete('2026/real-multi.sltbak');
  });

  test('the default threshold (64 MiB) switches to multipart for a 70 MiB file', async () => {
    const adapter = make();
    const sent = [];
    const original = adapter.client.send.bind(adapter.client);
    adapter.client.send = (command) => {
      sent.push(command.constructor.name);
      return original(command);
    };
    const file = makeFile('real-70.bin', 70 * MIB);
    await adapter.put(file, '2026/real-70.sltbak');
    assert.ok(sent.includes('CreateMultipartUploadCommand'));
    const back = path.join(dir, 'real-70.back');
    await adapter.getToFile('2026/real-70.sltbak', back);
    assert.equal(await sha256File(back), await sha256File(file));
    await adapter.delete('2026/real-70.sltbak');
  });
});
