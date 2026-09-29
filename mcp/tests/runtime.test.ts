import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createRegistryServer } from '../src/registry/server.js';
import { initializeProject } from '../src/runtime/project.js';
import { SkillFluxRuntime } from '../src/runtime/runtime.js';
import { seedSyntheticCatalog } from './registry-fixture.js';

async function runtimeFixture(t: TestContext, options: { initialize?: boolean; host?: 'generic' | 'codex' | 'claude' | 'cursor' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'skillflux-runtime-'));
  const token = 'synthetic-runtime-test-operator-token';
  const server = await createRegistryServer({ dataDir: join(directory, 'registry'), dev: false, adminToken: token });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const registry = `http://127.0.0.1:${address.port}`;
  await seedSyntheticCatalog(registry, token);
  const project = join(directory, 'project');
  await mkdir(project);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
    await rm(directory, { recursive: true, force: true });
  });
  if (options.initialize !== false) {
    await initializeProject({
      projectRoot: project,
      registry,
      host: options.host ?? 'generic',
      cliPath: process.execPath,
      preauthorizeReviewedText: true,
    });
  }
  return { directory, registry, project };
}

test('init pins TOFU, preserves unrelated MCP configuration and installs an explicit-only bootstrap', async t => {
  const { project, registry } = await runtimeFixture(t, { initialize: false });
  await writeFile(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { existing: { command: 'existing-tool' } }, custom: { keep: true } }));
  const first = await initializeProject({ projectRoot: project, registry, host: 'generic', cliPath: process.execPath, preauthorizeReviewedText: true });
  assert.match(first.trustNotice, /^TOFU:/);
  const config = JSON.parse(await readFile(join(project, '.mcp.json'), 'utf8'));
  assert.equal(config.mcpServers.existing.command, 'existing-tool');
  assert.deepEqual(config.custom, { keep: true });
  assert.equal(config.mcpServers.skillflux.command, process.execPath);
  assert.equal(Object.hasOwn(config.mcpServers.skillflux, '_skillfluxManaged'), false);
  const bootstrap = await readFile(first.bootstrapSkillPath, 'utf8');
  assert.match(bootstrap, /skillflux-bootstrap:v1/);
  const second = await initializeProject({ projectRoot: project, registry, host: 'cursor', cliPath: process.execPath, preauthorizeReviewedText: true });
  assert.match(await readFile(second.bootstrapSkillPath, 'utf8'), /disable-model-invocation: true/);
  assert.equal(second.trust.publicKey, first.trust.publicKey);
  assert.equal(second.trust.pinnedAt, first.trust.pinnedAt);
});

test('sealed plans reject edits and every load detects local package changes', async t => {
  const { project } = await runtimeFixture(t);
  const runtime = await SkillFluxRuntime.open(project);
  const alteredPlan = await runtime.createPlan('code-review');
  const planPath = join(project, '.skillflux', 'plans', `${alteredPlan.id}.json`);
  const altered = JSON.parse(await readFile(planPath, 'utf8'));
  altered.rootSkillVersion = '9.9.9';
  await writeFile(planPath, JSON.stringify(altered));
  await assert.rejects(runtime.installPlan(alteredPlan.id), /modified/i);

  const plan = await runtime.createPlan('code-review');
  await runtime.installPlan(plan.id);
  const loaded = await runtime.load('code-review', [], false);
  assert.match(loaded.entry.content, /# Code review/);
  const entryPath = join(project, '.skillflux', 'skills', 'code-review', '1.0.0', 'SKILL.md');
  await writeFile(entryPath, `${loaded.entry.content}\nuser edit\n`);
  await assert.rejects(runtime.load('code-review', [], false), /modified|hash/i);
  await assert.rejects(runtime.remove('code-review'), /edited|changed|refusing/i);
});

test('privacy reset invalidates old plans and the same runtime can create a valid new plan', async t => {
  const { project } = await runtimeFixture(t);
  const runtime = await SkillFluxRuntime.open(project);
  const oldPlan = await runtime.createPlan('code-review');
  const before = await runtime.privacyState();
  assert.equal(before.installationIdLeavesDevice, false);
  assert.doesNotMatch(before.installationId, /[0-9a-f]{8}-[0-9a-f-]{20,}/i);
  await runtime.resetPrivacy();
  await assert.rejects(runtime.installPlan(oldPlan.id), /missing|plan/i);
  const freshPlan = await runtime.createPlan('code-review');
  const reopened = await SkillFluxRuntime.open(project);
  const installed = await reopened.installPlan(freshPlan.id);
  assert.equal(installed.rootSkill.id, 'code-review');
});

test('runtime refuses a symlink substituted for a protected state directory', async t => {
  const { directory, project } = await runtimeFixture(t);
  const staging = join(project, '.skillflux', 'staging');
  const outside = join(directory, 'outside-staging');
  await mkdir(outside);
  await rm(staging, { recursive: true });
  await symlink(outside, staging, 'dir');
  await assert.rejects(SkillFluxRuntime.open(project), /symbolic link/i);
});

test('runtime rejects symbolic links at its transaction journal and process mutex', async t => {
  const { directory, project } = await runtimeFixture(t);
  const external = join(directory, 'external-state.json');
  const original = JSON.stringify({ pid: 999999999, schema: 'unrelated-user-state' });
  await writeFile(external, original);
  for (const filename of ['runtime.lock', 'journal.json']) {
    const target = join(project, '.skillflux', filename);
    await symlink(external, target);
    await assert.rejects(SkillFluxRuntime.open(project), /symbolic link/i);
    assert.equal(await readFile(external, 'utf8'), original);
    await rm(target);
  }
});
