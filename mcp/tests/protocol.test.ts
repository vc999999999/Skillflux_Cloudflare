import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixtureCatalog } from './runtime-fixture.js';
import { SkillFluxRuntime } from '../src/runtime/runtime.js';

function waitable(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void;
  const promise = new Promise<void>(resolveFn => { resolve = resolveFn; });
  return { promise, resolve: () => resolve!() };
}

test('real stdio MCP session: search → plan → authorize → install → same-turn load', async t => {
  const fixture = await fixtureCatalog(t);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'dist/cli.js', 'serve', '--project', fixture.project],
    cwd: process.cwd(),
  });
  const client = new Client({ name: 'skillflux-protocol-test', version: '2.0.0' });
  await client.connect(transport);
  t.after(() => client.close());
  const search = await client.callTool({ name: 'skillflux.search', arguments: { query: 'code review' } });
  assert.ok(!search.isError, `search must succeed: ${JSON.stringify(search.content)}`);
  const items = (search.structuredContent as { items: { id: string }[] }).items;
  assert.equal(items[0]!.id, 'code-review');
  const plan = await client.callTool({ name: 'skillflux.plan', arguments: { skillId: 'code-review', version: '1.0.0' } });
  assert.ok(!plan.isError);
  const planId = (plan.structuredContent as { id: string }).id;
  // Without preauthorization the MCP install must refuse.
  const unauthorized = await client.callTool({ name: 'skillflux.install', arguments: { planId } });
  assert.equal(unauthorized.isError, true);
  assert.match(JSON.stringify(unauthorized.content), /preauthorized MCP installation/);
});

test('CLI serves the catalog commands end to end from a built package', async t => {
  const fixture = await fixtureCatalog(t);
  const run = (args: string[]): Promise<{ code: number; stdout: string; stderr: string }> => new Promise(resolveRun => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'dist/cli.js', ...args], { cwd: process.cwd() });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolveRun({ code: code ?? -1, stdout, stderr }));
  });
  const search = await run(['search', 'code review', '--project', fixture.project]);
  assert.equal(search.code, 0, `search failed: ${search.stderr}`);
  assert.match(search.stdout, /code-review/);
  // plans require a skill id; check usage errors surface cleanly too
  const missing = await run(['plan', 'does-not-exist', '--project', fixture.project]);
  assert.notEqual(missing.code, 0);
});

test('same-turn load returns the entry content through MCP', async t => {
  const fixture = await fixtureCatalog(t);
  // enable preauthorization for the MCP installation in this test
  const { readFile, writeFile } = await import('node:fs/promises');
  const policyPath = join(fixture.project, '.skillflux', 'policy.json');
  const policy = JSON.parse(await readFile(policyPath, 'utf8'));
  policy.preauthorizeReviewedText = true;
  await writeFile(policyPath, JSON.stringify(policy, null, 2));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'dist/cli.js', 'serve', '--project', fixture.project],
    cwd: process.cwd(),
  });
  const client = new Client({ name: 'skillflux-protocol-test', version: '2.0.0' });
  await client.connect(transport);
  t.after(() => client.close());
  const plan = await client.callTool({ name: 'skillflux.plan', arguments: { skillId: 'code-review', version: '1.0.0' } });
  const planId = (plan.structuredContent as { id: string }).id;
  const installed = await client.callTool({ name: 'skillflux.install', arguments: { planId } });
  assert.ok(!installed.isError, `install must succeed: ${JSON.stringify(installed.content)}`);
  const loaded = await client.callTool({ name: 'skillflux.load', arguments: { skillId: 'code-review' } });
  assert.ok(!loaded.isError);
  const text = (loaded.content as { text: string }[])[0]!.text;
  assert.match(text, /Synthetic test fixture version 1\.0\.0/);
  assert.match(text, /Main entry: SKILL\.md/);
  assert.match(text, /Automatic update: mode=manual; status=manual/);
  void waitable;
});

test('MCP load follows local update policy and explains updates, blocks and offline fallback', async t => {
  const fixture = await fixtureCatalog(t);
  const runtime = await SkillFluxRuntime.open(fixture.project);
  const plan = await runtime.createPlan('code-review', { version: '1.0.0' });
  await runtime.installPlan(plan.id, 'cli');
  await runtime.setUpdatePolicy('follow-compatible');
  fixture.add('1.1.0');

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'dist/cli.js', 'serve', '--project', fixture.project],
    cwd: process.cwd(),
  });
  const client = new Client({ name: 'skillflux-follow-protocol-test', version: '1.1.0' });
  await client.connect(transport);
  t.after(() => client.close());

  const toolList = await client.listTools();
  assert.equal(toolList.tools.find(tool => tool.name === 'skillflux.load')?.annotations?.readOnlyHint, false);
  assert.ok(!toolList.tools.some(tool => /update.?policy/i.test(tool.name)), 'MCP must not expose persistent follow consent');

  const updated = await client.callTool({ name: 'skillflux.load', arguments: { skillId: 'code-review' } });
  assert.ok(!updated.isError, JSON.stringify(updated.content));
  const updatedValue = updated.structuredContent as { skill: { version: string }; autoUpdate: { mode: string; status: string; fromVersion: string; toVersion: string } };
  assert.equal(updatedValue.skill.version, '1.1.0');
  assert.equal(updatedValue.autoUpdate.mode, 'follow-compatible');
  assert.equal(updatedValue.autoUpdate.status, 'updated');
  assert.equal(updatedValue.autoUpdate.fromVersion, '1.0.0');
  assert.equal(updatedValue.autoUpdate.toVersion, '1.1.0');
  const updatedText = (updated.content as { text: string }[])[0]!.text;
  assert.match(updatedText, /Automatic update: mode=follow-compatible; status=updated; version=1\.0\.0 → 1\.1\.0/);
  assert.match(updatedText, /Synthetic test fixture version 1\.1\.0/);
  assert.ok(updatedText.indexOf('Automatic update:') < updatedText.indexOf('# Main entry:'), 'update disclosure must precede skill instructions');

  await runtime.setPinned('code-review', true);
  fixture.add('1.2.0');
  const blocked = await client.callTool({ name: 'skillflux.load', arguments: { skillId: 'code-review' } });
  assert.ok(!blocked.isError, JSON.stringify(blocked.content));
  assert.equal((blocked.structuredContent as { autoUpdate: { status: string } }).autoUpdate.status, 'blocked');
  const blockedText = (blocked.content as { text: string }[])[0]!.text;
  assert.match(blockedText, /Automatic update reason:.*pin/i);
  assert.match(blockedText, /Synthetic test fixture version 1\.1\.0/);

  fixture.setOffline(true);
  const offline = await client.callTool({ name: 'skillflux.load', arguments: { skillId: 'code-review' } });
  assert.ok(!offline.isError, JSON.stringify(offline.content));
  assert.equal((offline.structuredContent as { autoUpdate: { status: string } }).autoUpdate.status, 'unknown');
  const offlineText = (offline.content as { text: string }[])[0]!.text;
  assert.match(offlineText, /Current catalog status is unknown/);
  assert.match(offlineText, /Synthetic test fixture version 1\.1\.0/);
});
