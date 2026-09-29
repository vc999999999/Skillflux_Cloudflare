import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { createRegistryServer } from '../src/registry/server.js';
import type { PublicKeyInfo, Submission } from '../src/shared.js';
import { publishSyntheticFixture, syntheticRelease } from './registry-fixture.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const loader = fileURLToPath(import.meta.resolve('tsx'));
const token = 'cli-backup-test-operator-token';
const submission: Submission = { id: 'cli-backup-skill', version: '1.0.0', name: 'cli-backup-skill', description: 'Synthetic fixture', category: 'development', tags: [], hosts: ['codex', 'claude'], publisher: 'Synthetic test', license: 'MIT', entry: 'SKILL.md', permissions: { network: [], shell: false, secrets: [] }, dependencies: [], files: { 'SKILL.md': '# Synthetic fixture\nFollow the requested task.' }, release: syntheticRelease };

test('CLI backup, check and restore preserve a serving registry without overwriting destinations', { timeout: 120_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'skillflux-cli-backup-'));
  const dataDir = join(directory, 'data');
  const server = await createRegistryServer({ dataDir, adminToken: token });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  const skill = await publishSyntheticFixture(base, token, submission);
  const key = await (await fetch(`${base}/v1/keys`)).json() as PublicKeyInfo;
  const run = (...args: string[]) => exec(process.execPath, ['--import', loader, cli, 'backup', ...args], { timeout: 60_000, maxBuffer: 1024 * 1024 });

  const backupDir = join(directory, 'backup');
  const created = JSON.parse((await run('--data-dir', dataDir, '--dest', backupDir)).stdout);
  assert.equal(created.valid, true);
  assert.equal(created.keyId, key.keyId);
  await assert.rejects(run('--data-dir', dataDir, '--dest', backupDir), /EEXIST/);

  const checked = JSON.parse((await run('--check', '--backup', backupDir, '--data-dir', dataDir)).stdout);
  assert.equal(checked.valid, true);
  assert.equal(checked.directory, backupDir);
  await assert.rejects(run('--check', '--backup', backupDir, '--key-id', 'ed25519:wrong-identity'), /expected registry key/);

  const restoredDir = join(directory, 'restored');
  const restored = JSON.parse((await run('--restore', '--backup', backupDir, '--dest', restoredDir)).stdout);
  assert.equal(restored.valid, true);
  await assert.rejects(run('--restore', '--backup', backupDir, '--dest', restoredDir), /EEXIST/);

  const restoredServer = await createRegistryServer({ dataDir: restoredDir, adminToken: token });
  await new Promise<void>(resolve => restoredServer.listen(0, '127.0.0.1', resolve));
  const restoredBase = `http://127.0.0.1:${(restoredServer.address() as AddressInfo).port}`;
  try {
    assert.deepEqual(await (await fetch(`${restoredBase}/v1/keys`)).json(), key);
    const detail = await fetch(`${restoredBase}/v1/skills/${skill.id}`);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).skill.digest, skill.digest);
  } finally {
    restoredServer.closeAllConnections();
    await new Promise<void>(resolve => restoredServer.close(() => resolve()));
  }
});
