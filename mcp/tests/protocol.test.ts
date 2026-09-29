import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, rmdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test, type TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRegistryServer } from '../src/registry/server.js';
import { initializeProject } from '../src/runtime/project.js';
import { SkillFluxRuntime } from '../src/runtime/runtime.js';
import type { Campaign, Submission } from '../src/shared.js';
import { publishSyntheticFixture, seedSyntheticCatalog } from './registry-fixture.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const loader = fileURLToPath(import.meta.resolve('tsx'));
const seedPath = fileURLToPath(new URL('../catalog/seed.json', import.meta.url));
const adminToken = 'protocol-test-administrator-token-not-for-production';

async function fixture(t: TestContext, preauthorizeReviewedText = true) {
  const directory = await mkdtemp(join(tmpdir(), 'skillflux-protocol-'));
  const server = await createRegistryServer({
    dataDir: join(directory, 'registry'), adminToken, dev: false,
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const registry = `http://127.0.0.1:${address.port}`;
  await seedSyntheticCatalog(registry, adminToken);
  const project = join(directory, 'project');
  await mkdir(project);
  t.after(async () => {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  await initializeProject({ projectRoot: project, registry, host: 'generic', cliPath: cli, preauthorizeReviewedText });
  return { directory, registry, project, server };
}

function toolPayload<T>(result: Awaited<ReturnType<Client['callTool']>>): T {
  assert.notEqual(result.isError, true, JSON.stringify(result));
  if (result.structuredContent) return result.structuredContent as T;
  const blocks = result.content as Array<{ type: string; text?: string }>;
  const text = blocks.find(block => block.type === 'text')?.text;
  assert.ok(text, 'A successful tool must return structured content or JSON text');
  return JSON.parse(text) as T;
}

async function connect(project: string, t: TestContext) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', loader, cli, 'serve', '--project', project],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'skillflux-protocol-verification', version: '1.0.0' });
  await client.connect(transport);
  t.after(async () => client.close());
  return client;
}

test('real stdio MCP resolves, installs and loads registry instructions in the same session', { timeout: 30_000 }, async t => {
  const { project } = await fixture(t);
  const client = await connect(project, t);
  const { tools } = await client.listTools();
  for (const name of ['search', 'plan', 'install', 'load', 'list', 'update', 'rollback', 'remove', 'privacy']) {
    assert.ok(tools.some(tool => tool.name === `skillflux.${name}`), `Missing tool: ${name}`);
  }
  const result = toolPayload<{ items: Array<{ id: string }> }>(await client.callTool({
    name: 'skillflux.search', arguments: { query: 'landing page' },
  }));
  assert.ok(result.items.some(skill => skill.id === 'landing-page-design'));
  const plan = toolPayload<{ id: string }>(await client.callTool({
    name: 'skillflux.plan', arguments: { skillId: 'landing-page-design', version: '1.0.0' },
  }));
  assert.ok(plan.id);
  const installation = await client.callTool({ name: 'skillflux.install', arguments: { planId: plan.id } });
  assert.notEqual(installation.isError, true, JSON.stringify(installation));
  const loaded = toolPayload<{ entry: { content: string }; resources: Record<string, string> }>(await client.callTool({
    name: 'skillflux.load', arguments: { skillId: 'landing-page-design', resources: ['references/review.md'] },
  }));
  assert.match(loaded.entry.content, /# Landing page design/);
  assert.match(loaded.resources['references/review.md'], /# Visual review/);
  const local = await readFile(join(project, '.skillflux/skills/landing-page-design/1.0.0/SKILL.md'), 'utf8');
  assert.equal(local, loaded.entry.content);
  const privacy = toolPayload<{ anonymous: boolean; accountRequired: boolean }>(await client.callTool({
    name: 'skillflux.privacy', arguments: {},
  }));
  assert.equal(privacy.anonymous, true);
  assert.equal(privacy.accountRequired, false);
});

test('MCP installation respects project-local preauthorization instead of an AI consent boolean', { timeout: 30_000 }, async t => {
  const { project } = await fixture(t, false);
  const client = await connect(project, t);
  const plan = toolPayload<{ id: string }>(await client.callTool({
    name: 'skillflux.plan', arguments: { skillId: 'code-review' },
  }));
  const result = await client.callTool({ name: 'skillflux.install', arguments: { planId: plan.id } });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /preauthoriz|LOCAL_PREAUTHORIZATION_REQUIRED/i);
  const runtime = await SkillFluxRuntime.open(project);
  assert.equal((await runtime.list()).skills.length, 0);
});

test('managed CLI preserves JSON data without counting delivery as an impression; text mode confirms after output', { timeout: 30_000 }, async t => {
  const { project, registry } = await fixture(t);
  const runtime = await SkillFluxRuntime.open(project);
  const plan = await runtime.createPlan('code-review');
  await runtime.installPlan(plan.id);
  const response = await fetch(`${registry}/v1/admin/campaigns`, {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Protocol test campaign', sponsor: 'Protocol Test', text: '试试 Protocol Test，让代码审查更高效。',
      url: 'https://example.com/protocol-test', categories: ['development'], active: true,
      budgetCents: 1000, cpcCents: 10, dailyCap: 100,
      startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 3600_000).toISOString(),
    }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const { campaign } = await response.json() as { campaign: Campaign };
  assert.ok(campaign.id);
  const command = 'const fs=require("node:fs"); const context=fs.readFileSync(process.env.SKILLFLUX_CONTEXT_FILE,"utf8"); process.stdout.write(JSON.stringify({ok:true,receivedSkill:context.includes("# Code review")}));';
  const result = await exec(process.execPath, ['--import', loader, cli, 'run', '--project', project, '--skill', 'code-review', '--ad-context', 'normal', '--json', '--', process.execPath, '-e', command], {
    timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
  });
  const envelope = JSON.parse(result.stdout);
  assert.ok(envelope && typeof envelope === 'object');
  assert.deepEqual(JSON.parse(envelope.output), { ok: true, receivedSkill: true });
  assert.match(result.stdout, /广告/);
  assert.match(result.stdout, /Protocol Test/);
  const metrics = await fetch(`${registry}/v1/admin/metrics`, { headers: { authorization: `Bearer ${adminToken}` } }).then(response => response.json());
  assert.equal(metrics.impressions, 0, 'Machine-readable JSON delivery is not a confirmed display');
  assert.equal(metrics.clicks, 0);
  assert.equal(metrics.spentCents, 0);
  const rendered = await exec(process.execPath, ['--import', loader, cli, 'run', '--project', project, '--skill', 'code-review', '--ad-context', 'normal', '--', process.execPath, '-e', command], { timeout: 20_000 });
  assert.match(rendered.stdout, /^\{"ok":true,"receivedSkill":true\}/);
  assert.match(rendered.stdout, /广告：.*Protocol Test/);
  const after = await fetch(`${registry}/v1/admin/metrics`, { headers: { authorization: `Bearer ${adminToken}` } }).then(response => response.json());
  assert.equal(after.impressions, 1);
  assert.equal(after.spentCents, 0);
});

async function admin(registry: string, path: string, body: unknown) {
  const response = await fetch(`${registry}/v1/admin/${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.ok(response.ok, await response.clone().text());
  return response.json();
}

test('updates, rollback and revocations operate on real published versions and offline loads disclose cached status', { timeout: 30_000 }, async t => {
  const { project, registry, server } = await fixture(t);
  const runtime = await SkillFluxRuntime.open(project);
  const initial = await runtime.createPlan('code-review', { version: '1.0.0' });
  await runtime.installPlan(initial.id);
  const seeds = JSON.parse(await readFile(seedPath, 'utf8')) as Submission[];
  const next = structuredClone(seeds.find(skill => skill.id === 'code-review')!);
  next.version = '1.1.0';
  next.files['SKILL.md'] += '\nCheck the regression scenario documented by the caller.\n';
  await publishSyntheticFixture(registry, adminToken, next);
  await runtime.installUpdatePlan((await runtime.createPlan('code-review', { version: '1.1.0' })).id);
  assert.equal((await runtime.load('code-review', [], false)).skill.version, '1.1.0');
  await runtime.rollback('code-review');
  assert.equal((await runtime.load('code-review', [], false)).skill.version, '1.0.0');
  await runtime.installUpdatePlan((await runtime.createPlan('code-review', { version: '1.1.0' })).id);
  await admin(registry, 'skills/code-review/1.1.0/review', { action: 'revoke', reviewer: 'integration-test', notes: 'Verify local revocation enforcement.' });
  await assert.rejects(runtime.load('code-review', [], false), /revoked/i);
  await runtime.rollback('code-review');
  assert.equal((await runtime.load('code-review', [], false)).skill.version, '1.0.0');
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  const offline = await runtime.load('code-review', [], false);
  assert.equal(offline.skill.version, '1.0.0');
  assert.ok(offline.warnings.some(warning => /offline|cached/i.test(warning)));
  await assert.rejects(runtime.createPlan('landing-page-design'), /failed|unavailable/i);
});

test('privacy reset completes without lock deadlock and subsequent plans remain interoperable across processes', { timeout: 10_000 }, async t => {
  const { project } = await fixture(t);
  const runtime = await SkillFluxRuntime.open(project);
  const installationPath = join(project, '.skillflux/installation.json');
  const previous = JSON.parse(await readFile(installationPath, 'utf8'));
  await runtime.setAdvertising(false);
  const reset = await runtime.resetPrivacy();
  const current = JSON.parse(await readFile(installationPath, 'utf8'));
  assert.notEqual(current.installationId, previous.installationId);
  assert.equal(reset.adsEnabled, false);
  const plan = await runtime.createPlan('code-review');
  const reopened = await SkillFluxRuntime.open(project);
  await reopened.installPlan(plan.id);
  assert.equal((await reopened.list()).skills[0].id, 'code-review');
});

test('locally edited skills are preserved and symlinked runtime directories are rejected', { timeout: 10_000 }, async t => {
  const { directory, project } = await fixture(t);
  const runtime = await SkillFluxRuntime.open(project);
  const plan = await runtime.createPlan('code-review');
  await runtime.installPlan(plan.id);
  const path = join(project, '.skillflux/skills/code-review/1.0.0/SKILL.md');
  const edited = `${await readFile(path, 'utf8')}\nMy local notes must be preserved.\n`;
  await writeFile(path, edited);
  await assert.rejects(runtime.load('code-review', [], false), /hash|modified|changed|size/i);
  await assert.rejects(runtime.remove('code-review'), /changed|preserv|edited/i);
  assert.equal(await readFile(path, 'utf8'), edited);
  const outside = join(directory, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'marker.txt'), 'Do not modify this directory.');
  const staging = join(project, '.skillflux/staging');
  await rmdir(staging);
  await symlink(outside, staging, 'dir');
  await assert.rejects(SkillFluxRuntime.open(project), /symbolic|symlink/i);
  assert.equal(await readFile(join(outside, 'marker.txt'), 'utf8'), 'Do not modify this directory.');
});
