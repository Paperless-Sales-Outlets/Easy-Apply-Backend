import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { detectMultiInstance, warnIfMultiInstance, assertSingleInstance } from '../services/backup/instanceGuard.js';
import { acquireJobLock } from '../services/backup/lock.js';

// The backup feature needs a single backend instance (see ecosystem.config.cjs).

describe('single-instance detection', () => {
  const detect = (env, isWorker = false) => detectMultiInstance({ env, isWorker });

  test('plain node, PM2 fork mode and PM2 with one instance are fine', () => {
    assert.equal(detect({}).multi, false);
    assert.equal(detect({ exec_mode: 'fork_mode', NODE_APP_INSTANCE: '0' }).multi, false);
    assert.equal(detect({ exec_mode: 'cluster_mode', instances: '1', NODE_APP_INSTANCE: '0' }).multi, false);
  });

  test('PM2 cluster mode with several instances is detected', () => {
    for (const instances of ['2', '4', 'max']) {
      const result = detect({ exec_mode: 'cluster_mode', instances, NODE_APP_INSTANCE: '0' });
      assert.equal(result.multi, true, instances);
      assert.match(result.reason, /cluster mode/);
    }
  });

  test('a second PM2 instance (index above 0) and Node cluster workers are detected', () => {
    assert.equal(detect({ NODE_APP_INSTANCE: '1' }).multi, true);
    assert.equal(detect({}, true).multi, true);
  });
});

describe('what happens when several instances are running', () => {
  const saved = { mode: process.env.exec_mode, n: process.env.instances, i: process.env.NODE_APP_INSTANCE, allow: process.env.BACKUP_ALLOW_MULTI_INSTANCE };
  const restore = (key, value) => (value === undefined ? delete process.env[key] : (process.env[key] = value));
  after(() => {
    restore('exec_mode', saved.mode);
    restore('instances', saved.n);
    restore('NODE_APP_INSTANCE', saved.i);
    restore('BACKUP_ALLOW_MULTI_INSTANCE', saved.allow);
  });

  const goMulti = () => {
    process.env.exec_mode = 'cluster_mode';
    process.env.instances = '4';
    process.env.NODE_APP_INSTANCE = '0';
    delete process.env.BACKUP_ALLOW_MULTI_INSTANCE;
  };

  test('a clear warning is logged at startup', () => {
    goMulti();
    const lines = [];
    assert.equal(warnIfMultiInstance((line) => lines.push(line)), true);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /SINGLE backend instance/);
    assert.match(lines[0], /instances: 4/);
    assert.match(lines[0], /refused/);
  });

  test('no warning for a single instance', () => {
    delete process.env.exec_mode;
    delete process.env.instances;
    delete process.env.NODE_APP_INSTANCE;
    const lines = [];
    assert.equal(warnIfMultiInstance((line) => lines.push(line)), false);
    assert.deepEqual(lines, []);
  });

  test('operations are refused (503) before any lock or database work', async () => {
    goMulti();
    assert.throws(() => assertSingleInstance(), (e) => e.code === 'MULTI_INSTANCE' && e.statusCode === 503);
    await assert.rejects(acquireJobLock({ op: 'backup' }), (e) => e.code === 'MULTI_INSTANCE');
  });

  test('BACKUP_ALLOW_MULTI_INSTANCE=true is an explicit override, and still warns', () => {
    goMulti();
    process.env.BACKUP_ALLOW_MULTI_INSTANCE = 'true';
    assert.doesNotThrow(() => assertSingleInstance());
    const lines = [];
    warnIfMultiInstance((line) => lines.push(line));
    assert.match(lines[0], /at your own risk/);
  });
});
