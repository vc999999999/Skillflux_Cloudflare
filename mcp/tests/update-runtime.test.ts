import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { Writable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { bundleDigest } from '../src/shared.js';
import { runManaged } from '../src/runtime/managed-run.js';
import { installedRuntime } from './runtime-fixture.js';
import { initializeProject } from '../src/runtime/project.js';
import { SkillFluxRuntime } from '../src/runtime/runtime.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const loader = fileURLToPath(import.meta.resolve('tsx'));

test('update checks never install, expose compatibility and reuse 24-hour cache only for ordinary versions', async t => {
  const f = await installedRuntime(t);
  f.add('1.1.0');
  f.add('2.0.0', { minClient: '99.0.0', breaking: true });
  const before = await readFile(f.runtime.paths.lock, 'utf8');
  const start = f.requests.length;
  const result = await f.runtime.checkUpdates();
  assert.equal(result.items[0].latestVersion, '2.0.0');
  assert.equal(result.items[0].latestCompatibleVersion, '1.1.0');
  assert.equal(result.items[0].compatibility, 'incompatible');
  assert.equal(result.items[0].status, 'update-available');
  assert.equal(result.items[0].breaking, true);
  assert.equal(result.items[0].source, 'registry');
  assert.match(result.items[0].notes!, /2.0.0/);
  assert.equal(await readFile(f.runtime.paths.lock, 'utf8'), before);
  assert.equal(f.requests.slice(start).some(path => path.includes('/bundles/')), false);
  const versionRequests = f.requests.filter(path => path.endsWith('/versions')).length;
  const securityRequests = f.requests.filter(path => path.endsWith('/revocations')).length;
  const loaded = await f.runtime.load('code-review', [], false);
  assert.equal(loaded.update?.source, 'cache');
  assert.equal(f.requests.filter(path => path.endsWith('/versions')).length, versionRequests);
  assert.equal(f.requests.filter(path => path.endsWith('/revocations')).length, securityRequests + 1);
  await f.runtime.checkUpdates();
  assert.equal(f.requests.filter(path => path.endsWith('/versions')).length, versionRequests + 1);
});

test('offline check and explicit load preserve exact versions and never claim latest', async t => {
  const f = await installedRuntime(t);
  await f.runtime.checkUpdates();
  f.offline(true);
  const report = await f.runtime.checkUpdates();
  assert.equal(report.items[0].status, 'unknown');
  assert.equal(report.items[0].source, 'stale-cache');
  assert.equal(report.items[0].revocationStatus, 'unknown');
  assert.ok(report.items[0].checkedAt);
  const loaded = await f.runtime.load('code-review', [], false);
  assert.equal(loaded.skill.version, '1.0.0');
  assert.equal(loaded.update?.status, 'unknown');
  assert.match(loaded.warnings.join(' '), /Offline/);
});

test('updates require exact plans, reject install-preauthorization bypass, and pin blocks replacement', async t => {
  const f = await installedRuntime(t);
  f.add('1.1.0');
  assert.equal((await f.runtime.createPlan('code-review')).rootSkillVersion, '1.0.0');
  await f.runtime.update('code-review', 'mcp');
  assert.equal((await f.runtime.list()).skills[0].version, '1.0.0');
  const update = await f.runtime.createPlan('code-review', { version: '1.1.0' });
  assert.equal(update.intent, 'update');
  assert.deepEqual(update.changes?.map(change => [change.from, change.to]), [['1.0.0', '1.1.0']]);
  await assert.rejects(f.runtime.installPlan(update.id, 'mcp'), /explicitly execute/);
  await f.runtime.setPinned('code-review', true);
  await assert.rejects(f.runtime.installUpdatePlan(update.id), /lock changed/);
  await assert.rejects(f.runtime.createPlan('code-review', { version: '1.1.0' }), /pinned/);
  assert.equal((await f.runtime.checkUpdates()).items[0].pinned, true);
  await f.runtime.setPinned('code-review', false);
  const fresh = await f.runtime.createPlan('code-review', { version: '1.1.0' });
  await f.runtime.installUpdatePlan(fresh.id, 'mcp');
  assert.equal((await f.runtime.list()).skills[0].version, '1.1.0');
  await f.runtime.rollback('code-review');
  assert.equal((await f.runtime.list()).skills[0].version, '1.0.0');
});

test('local edits and download failures preserve current state; incompatible and revoked targets cannot execute', async t => {
  const f = await installedRuntime(t);
  f.add('1.1.0');
  const incompatible = f.add('2.0.0', { minClient: '99.0.0' });
  await assert.rejects(f.runtime.createPlan('code-review', { version: '2.0.0' }), /requires SkillFlux/);
  const plan = await f.runtime.createPlan('code-review', { version: '1.1.0' });
  const before = await readFile(f.runtime.paths.lock, 'utf8');
  f.failBundles(true);
  await assert.rejects(f.runtime.installUpdatePlan(plan.id), /unavailable/);
  assert.equal(await readFile(f.runtime.paths.lock, 'utf8'), before);
  f.failBundles(false);
  const path = join(f.runtime.paths.skills, 'code-review', '1.0.0', 'SKILL.md');
  const original = await readFile(path, 'utf8');
  await writeFile(path, original + '\nLocal user edit');
  await assert.rejects(f.runtime.installUpdatePlan(plan.id), /modified/);
  assert.equal(await readFile(f.runtime.paths.lock, 'utf8'), before);
  await writeFile(path, original);
  const manifestPath = join(f.runtime.paths.skills, 'code-review', '1.0.0', 'manifest.json');
  const originalManifest = await readFile(manifestPath, 'utf8');
  await writeFile(manifestPath, JSON.stringify({ ...JSON.parse(originalManifest), name: 'Local metadata edit' }));
  await assert.rejects(f.runtime.installUpdatePlan(plan.id), /manifest.json was modified/);
  assert.equal(await readFile(f.runtime.paths.lock, 'utf8'), before);
  await writeFile(manifestPath, originalManifest);
  const newer = f.bundles.get('code-review@1.1.0')!;
  f.revoked.push({ id: 'code-review', version: '1.1.0', digest: bundleDigest(newer), reason: 'Synthetic revocation test', revokedAt: new Date().toISOString() });
  await assert.rejects(f.runtime.installUpdatePlan(plan.id), /revoked/);
  assert.equal(await readFile(f.runtime.paths.lock, 'utf8'), before);
  assert.equal((await readdir(f.runtime.paths.staging)).length, 0);
  assert.ok(incompatible);
});

test('revoked installed version is reported and revoked rollback history is rejected', async t => {
  const f = await installedRuntime(t);
  f.add('1.1.0');
  await f.runtime.installUpdatePlan((await f.runtime.createPlan('code-review', { version: '1.1.0' })).id);
  const older = f.bundles.get('code-review@1.0.0')!;
  f.revoked.push({ id: 'code-review', version: '1.0.0', digest: bundleDigest(older), reason: 'Synthetic revocation test', revokedAt: new Date().toISOString() });
  await assert.rejects(f.runtime.rollback('code-review'), /revoked/);
  const newer = f.bundles.get('code-review@1.1.0')!;
  f.revoked.push({ id: 'code-review', version: '1.1.0', digest: bundleDigest(newer), reason: 'Synthetic revocation test', revokedAt: new Date().toISOString() });
  assert.equal((await f.runtime.checkUpdates()).items[0].status, 'revoked');
  await assert.rejects(f.runtime.load('code-review', [], false), /revoked/);
});

test('ad failure skips advertising without fabricated fallback; unknown context never calls the ad API', async t => {
  const f = await installedRuntime(t);
  let stdout = '';
  const sink = new Writable({ write(chunk, _encoding, callback) { stdout += chunk.toString(); callback(); } });
  const errors = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const result = await runManaged(f.runtime, { command: process.execPath, args: ['-e', 'process.stdout.write("Answer")'], skillId: 'code-review', stdout: sink, stderr: errors, adContext: 'normal' });
  assert.equal(result.advertisement, null);
  assert.equal(stdout, 'Answer');
  assert.equal(result.impressionRecorded, false);
  const requestCount = f.requests.length;
  await assert.rejects(f.runtime.selectAdvertisement('development', 'code-review'), /suppressed/);
  await assert.rejects(f.runtime.selectAdvertisement('medical', 'code-review', 'normal'), /suppressed/);
  assert.equal(f.requests.length, requestCount);
});

test('CLI requires an exact target and explicit confirmation; check-updates and unconfirmed update preserve lock', async t => {
  const f = await installedRuntime(t);
  f.add('1.1.0', { breaking: true });
  const command = (...args: string[]) => exec(process.execPath, ['--import', loader, cli, ...args, '--project', f.project], { timeout: 20_000 });
  const before = await readFile(f.runtime.paths.lock, 'utf8');
  assert.equal(JSON.parse((await command('check-updates')).stdout).items[0].latestCompatibleVersion, '1.1.0');
  await command('update', 'code-review', '--yes');
  assert.equal(await readFile(f.runtime.paths.lock, 'utf8'), before);
  const planned = await command('update', 'code-review@1.1.0');
  const plan = JSON.parse(planned.stdout).plan;
  assert.match(planned.stderr, /BREAKING/);
  assert.equal(await readFile(f.runtime.paths.lock, 'utf8'), before);
  await command('update', '--plan', plan.id, '--yes');
  assert.equal((await f.runtime.list()).skills[0].version, '1.1.0');
  await command('pin', 'code-review');
  assert.equal((await f.runtime.list()).skills[0].pinned, true);
  await command('unpin', 'code-review');
  assert.equal((await f.runtime.list()).skills[0].pinned, false);
});

test('real MCP check is read-only and update accepts only the reviewed exact planId', async t => {
  const f = await installedRuntime(t);
  f.add('1.1.0');
  const client = new Client({ name: 'synthetic-update-protocol-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', loader, cli, 'serve', '--project', f.project], stderr: 'pipe' });
  await client.connect(transport);
  t.after(() => client.close());
  const available = await client.listTools();
  assert.equal(available.tools.find(tool => tool.name === 'skillflux.check_updates')?.annotations?.readOnlyHint, true);
  const checked = await client.callTool({ name: 'skillflux.check_updates', arguments: {} });
  assert.notEqual(checked.isError, true);
  const refused = await client.callTool({ name: 'skillflux.update', arguments: { skillId: 'code-review' } });
  assert.equal(refused.isError, true);
  assert.equal((await f.runtime.list()).skills[0].version, '1.0.0');
  const planned = await client.callTool({ name: 'skillflux.plan', arguments: { skillId: 'code-review', version: '1.1.0' } });
  assert.notEqual(planned.isError, true);
  const id = planned.structuredContent!.id;
  const bypass = await client.callTool({ name: 'skillflux.install', arguments: { planId: id } });
  assert.equal(bypass.isError, true);
  const updated = await client.callTool({ name: 'skillflux.update', arguments: { planId: id } });
  assert.notEqual(updated.isError, true);
  assert.equal((await f.runtime.list()).skills[0].version, '1.1.0');
});

test('pinned dependency prevents a root upgrade and dependency conflicts are reported before installation', async t => {
  const f = await installedRuntime(t);
  f.add('1.0.0', { id: 'base' });
  f.add('2.0.0', { id: 'base' });
  f.add('1.0.0', { id: 'other', deps: [{ id: 'base', version: '1.0.0' }] });
  await f.runtime.installPlan((await f.runtime.createPlan('other')).id);
  f.add('1.1.0', { deps: [{ id: 'base', version: '2.0.0' }] });
  await f.runtime.setPinned('base', true);
  await assert.rejects(f.runtime.createPlan('code-review', { version: '1.1.0' }), /pinned/);
  assert.equal((await f.runtime.checkUpdates('code-review')).items[0].compatibility, 'incompatible');
  await f.runtime.setPinned('base', false);
  await assert.rejects(f.runtime.createPlan('code-review', { version: '1.1.0' }), /requires base/);
  assert.equal((await f.runtime.list()).skills.find(skill => skill.id === 'base')?.version, '1.0.0');
});

test('a long-lived MCP runtime respects later local advertising opt-out and revoked installation preauthorization', async t => {
  const f = await installedRuntime(t);
  const other = await SkillFluxRuntime.open(f.project);
  await other.setAdvertising(false);
  const before = f.requests.length;
  await assert.rejects(f.runtime.selectAdvertisement('development', 'code-review', 'normal'), /disabled/i);
  assert.equal(f.requests.length, before);
  const plan = await f.runtime.createPlan('code-review', { version: '1.0.0' });
  await initializeProject({ projectRoot: f.project, registry: f.registry, host: 'generic', cliPath: process.execPath, preauthorizeReviewedText: false });
  await assert.rejects(f.runtime.installPlan(plan.id, 'mcp'), /preauthorized|preauthorization/i);
  await f.runtime.setAdvertising(true);
  assert.equal(JSON.parse(await readFile(f.runtime.paths.policy, 'utf8')).preauthorizeReviewedText, false, 'An advertising preference must not restore stale installation permissions');
});
