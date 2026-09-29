import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createRegistryServer } from '../src/registry/server.js';
import { runManaged } from '../src/runtime/managed-run.js';
import { initializeProject } from '../src/runtime/project.js';
import { SkillFluxRuntime } from '../src/runtime/runtime.js';
import type { Metrics } from '../src/shared.js';
import { seedSyntheticCatalog } from './registry-fixture.js';

const adminToken = 'managed-output-test-operator-token';

class TextSink extends Writable {
  private readonly chunks: Buffer[] = [];

  override _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(chunk, encoding));
    callback();
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'skillflux-managed-output-'));
  const server = await createRegistryServer({ dataDir: join(directory, 'registry'), adminToken, dev: false });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const registry = `http://127.0.0.1:${address.port}`;
  await seedSyntheticCatalog(registry, adminToken);
  const project = join(directory, 'project');
  await mkdir(project);
  await initializeProject({ projectRoot: project, registry, host: 'generic', cliPath: process.execPath, preauthorizeReviewedText: true });
  const runtime = await SkillFluxRuntime.open(project);
  const plan = await runtime.createPlan('code-review', { version: '1.0.0' });
  await runtime.installPlan(plan.id);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
    await rm(directory, { recursive: true, force: true });
  });
  return { registry, runtime };
}

async function metrics(registry: string): Promise<Metrics> {
  const response = await fetch(`${registry}/v1/admin/metrics`, { headers: { authorization: `Bearer ${adminToken}` } });
  assert.equal(response.status, 200);
  return response.json() as Promise<Metrics>;
}

test('failed managed child may stream partial text but receives no advertisement or impression', async t => {
  const { registry, runtime } = await fixture(t);
  const stdout = new TextSink();
  const stderr = new TextSink();
  const result = await runManaged(runtime, {
    command: process.execPath,
    args: ['-e', 'process.stdout.write("partial answer"); process.exit(7)'],
    skillId: 'code-review',
    stdout,
    stderr,
  });
  assert.equal(result.exitCode, 7);
  assert.equal(result.successfulOutput, false);
  assert.equal(result.advertisement, null);
  assert.equal(result.impressionRecorded, false);
  assert.equal(stdout.text(), 'partial answer');
  assert.doesNotMatch(stdout.text(), /广告|SkillFlux 提供/);
  assert.equal((await metrics(registry)).impressions, 0);
});

test('successful managed child with empty stdout does not request or render advertising', async t => {
  const { registry, runtime } = await fixture(t);
  const stdout = new TextSink();
  const stderr = new TextSink();
  const result = await runManaged(runtime, {
    command: process.execPath,
    args: ['-e', 'process.exit(0)'],
    skillId: 'code-review',
    stdout,
    stderr,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.successfulOutput, false);
  assert.equal(result.advertisement, null);
  assert.equal(result.impressionRecorded, false);
  assert.equal(stdout.text(), '');
  const observed = await metrics(registry);
  assert.equal(observed.decisions, 0);
  assert.equal(observed.impressions, 0);
});

test('medical managed output is returned successfully while advertising is suppressed without a house fallback', async t => {
  const { registry, runtime } = await fixture(t);
  const stdout = new TextSink();
  const stderr = new TextSink();
  const result = await runManaged(runtime, {
    command: process.execPath,
    args: ['-e', 'process.stdout.write("medical answer")'],
    skillId: 'code-review',
    category: 'medical',
    stdout,
    stderr,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.successfulOutput, true);
  assert.equal(result.advertisement, null);
  assert.equal(result.impressionRecorded, false);
  assert.equal(stdout.text(), 'medical answer');
  assert.doesNotMatch(stdout.text(), /广告|SkillFlux 提供/);
  assert.match(stderr.text(), /suppressed/i);
  const observed = await metrics(registry);
  assert.equal(observed.decisions, 0);
  assert.equal(observed.impressions, 0);
});
