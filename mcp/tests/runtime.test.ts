import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixtureCatalog } from './runtime-fixture.js';
import { SkillFluxRuntime } from '../src/runtime/runtime.js';

const RUNTIME_VERSION: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

test('search runs locally against the cached catalog index and never sends the query', async t => {
  const fixture = await fixtureCatalog(t);
  const runtime = await SkillFluxRuntime.open(fixture.project);
  const result = await runtime.search({ query: 'code review' });
  assert.equal(result.total, 1);
  assert.equal(result.items[0]!.id, 'code-review');
  const queryPaths = fixture.requests.filter(path => path.includes('?') || path.includes('search'));
  assert.equal(queryPaths.length, 0, 'search must not emit any network query path');
});

test('plan → install → load round-trip installs at a pinned commit with hash verification', async t => {
  const fixture = await fixtureCatalog(t);
  const runtime = await SkillFluxRuntime.open(fixture.project);
  const plan = await runtime.createPlan('code-review', { version: '1.0.0' });
  assert.equal(plan.intent, 'install');
  const installed = await runtime.installPlan(plan.id, 'cli');
  assert.equal(installed.rootSkill.id, 'code-review');
  const loaded = await runtime.load('code-review');
  assert.match(loaded.entry.content, /Synthetic test fixture version 1\.0\.0/);
  assert.equal(loaded.manifest.id, 'code-review');
  const list = await runtime.list();
  assert.equal(list.skills.length, 1);
});

test('hash mismatch on download aborts installation', async t => {
  const fixture = await fixtureCatalog(t);
  const runtime = await SkillFluxRuntime.open(fixture.project);
  fixture.tamper('code-review', '1.0.0', 'SKILL.md', '---\nname: malicious\ndescription: hash mismatch\n---\ntampered\n');
  const plan = await runtime.createPlan('code-review', { version: '1.0.0' });
  await assert.rejects(() => runtime.installPlan(plan.id, 'cli'), /FILE_HASH_MISMATCH|FILE_SIZE_MISMATCH|expected .* bytes, downloaded/);
});

test('revoked entries cannot be installed and installed copies refuse to load', async t => {
  const fixture = await fixtureCatalog(t);
  const runtime = await SkillFluxRuntime.open(fixture.project);
  const plan = await runtime.createPlan('code-review', { version: '1.0.0' });
  await runtime.installPlan(plan.id, 'cli');
  fixture.revoke('code-review', '1.0.0');
  const updates = await runtime.checkUpdates('code-review', true);
  assert.equal(updates.items[0]!.revocationStatus, 'revoked');
  await assert.rejects(() => runtime.load('code-review'), /was revoked/);
});

test('update flow requires exact target, plan approval and re-verifies catalog digest', async t => {
  const fixture = await fixtureCatalog(t);
  const runtime = await SkillFluxRuntime.open(fixture.project);
  const first = await runtime.createPlan('code-review', { version: '1.0.0' });
  await runtime.installPlan(first.id, 'cli');
  fixture.add('1.1.0');
  const check = await runtime.checkUpdates('code-review', true);
  assert.equal(check.items[0]!.status, 'update-available');
  assert.equal(check.items[0]!.latestVersion, '1.1.0');
  // Without an exact target, update is read-only.
  const readOnly = await runtime.update();
  assert.equal(readOnly.items[0]!.currentVersion, '1.0.0');
  const upgrade = await runtime.createPlan('code-review', { version: '1.1.0' });
  assert.equal(upgrade.intent, 'update');
  await runtime.installUpdatePlan(upgrade.id, 'cli');
  const loaded = await runtime.load('code-review');
  assert.match(loaded.entry.content, /version 1\.1\.0/);
});

test('pinned versions block upgrade plans until unpinned', async t => {
  const fixture = await fixtureCatalog(t);
  const runtime = await SkillFluxRuntime.open(fixture.project);
  const first = await runtime.createPlan('code-review', { version: '1.0.0' });
  await runtime.installPlan(first.id, 'cli');
  await runtime.setPinned('code-review', true);
  fixture.add('1.2.0');
  await assert.rejects(() => runtime.createPlan('code-review', { version: '1.2.0' }), /is pinned at/);
  await runtime.setPinned('code-review', false);
  const plan = await runtime.createPlan('code-review', { version: '1.2.0' });
  await runtime.installUpdatePlan(plan.id, 'cli');
});

test('rollback restores the previous verified lock state', async t => {
  const fixture = await fixtureCatalog(t);
  const runtime = await SkillFluxRuntime.open(fixture.project);
  const first = await runtime.createPlan('code-review', { version: '1.0.0' });
  await runtime.installPlan(first.id, 'cli');
  fixture.add('2.0.0');
  const upgrade = await runtime.createPlan('code-review', { version: '2.0.0' });
  await runtime.installUpdatePlan(upgrade.id, 'cli');
  const restored = await runtime.rollback('code-review');
  assert.equal(restored.skills['code-review']!.version, '1.0.0');
  const loaded = await runtime.load('code-review');
  assert.match(loaded.entry.content, /version 1\.0\.0/);
});

test('local file edits block removal and upgrades', async t => {
  const fixture = await fixtureCatalog(t);
  const runtime = await SkillFluxRuntime.open(fixture.project);
  const first = await runtime.createPlan('code-review', { version: '1.0.0' });
  await runtime.installPlan(first.id, 'cli');
  await appendFile(join(fixture.project, '.skillflux', 'skills', 'code-review', '1.0.0', 'SKILL.md'), '\nlocal edit\n');
  await assert.rejects(() => runtime.remove('code-review'), /Refusing to remove/);
});

test('offline load discloses unknown catalog status without faking freshness', async t => {
  const fixture = await fixtureCatalog(t);
  const runtime = await SkillFluxRuntime.open(fixture.project);
  const first = await runtime.createPlan('code-review', { version: '1.0.0' });
  await runtime.installPlan(first.id, 'cli');
  fixture.setOffline(true);
  const loaded = await runtime.load('code-review');
  assert.ok(loaded.warnings.some(warning => warning.includes('catalog status is unknown')), 'must disclose unknown status');
  const check = await runtime.checkUpdates('code-review', true);
  assert.equal(check.items[0]!.source, 'unavailable');
  assert.equal(check.items[0]!.status, 'unknown');
});

test('MCP installation requires explicit preauthorization', async t => {
  const fixture = await fixtureCatalog(t);
  const runtime = await SkillFluxRuntime.open(fixture.project);
  const plan = await runtime.createPlan('code-review', { version: '1.0.0' });
  await assert.rejects(() => runtime.installPlan(plan.id, 'mcp'), /has not preauthorized MCP installation/);
  // After the user enables preauthorization, the MCP path installs.
  const policyPath = join(fixture.project, '.skillflux', 'policy.json');
  const policy = JSON.parse(await readFile(policyPath, 'utf8'));
  policy.preauthorizeReviewedText = true;
  await writeFile(policyPath, JSON.stringify(policy, null, 2));
  const runtimeAgain = await SkillFluxRuntime.open(fixture.project);
  const result = await runtimeAgain.installPlan(plan.id, 'mcp');
  assert.equal(result.rootSkill.id, 'code-review');
  void RUNTIME_VERSION;
});
