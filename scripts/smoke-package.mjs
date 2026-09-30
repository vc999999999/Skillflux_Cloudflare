import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'skillflux-package-smoke-'));
const execute = promisify(execFile);
const npmPath = process.env.npm_execpath;
assert.ok(npmPath, 'Run this check using npm run smoke:package');
const npm = (args, options = {}) => execute(process.execPath, [npmPath, ...args], { cwd: root, timeout: 120_000, maxBuffer: 2 * 1024 * 1024, ...options });
let registryProcess;
let client;
const operatorToken = randomBytes(32).toString('hex');

try {
  const packed = await npm(['pack', '--workspace', '@skillflux/mcp', '--pack-destination', temporary, '--json']);
  const [{ filename, files }] = JSON.parse(packed.stdout);
  for (const expected of ['dist/cli.js', 'skills/skillflux/SKILL.md', 'skills/skillflux/agents/openai.yaml']) {
    assert.ok(files.some(file => file.path === expected), `Packed package is missing ${expected}`);
  }
  assert.ok(!files.some(file => /(?:^|\/)(?:var|keys|node_modules|\.env)(?:\/|$)/.test(file.path)), 'Private runtime data must not be packaged');
  assert.ok(!files.some(file => /^catalog\//.test(file.path)), 'Development samples must not ship in the published package');
  const consumer = join(temporary, 'consumer');
  const project = join(temporary, 'project');
  await mkdir(consumer);
  await mkdir(project);
  await npm(['install', '--prefix', consumer, '--ignore-scripts', '--no-audit', '--no-fund', join(temporary, filename)]);
  const cli = join(consumer, 'node_modules/@skillflux/mcp/dist/cli.js');
  const invoke = args => execute(process.execPath, [cli, ...args], { cwd: project, timeout: 20_000, maxBuffer: 2 * 1024 * 1024 });
  assert.match((await invoke(['--help'])).stdout, /SkillFlux/);
  if (process.platform !== 'win32') {
    const bin = join(consumer, 'node_modules/.bin/skillflux');
    assert.match((await execute(process.execPath, [bin, '--help'], { timeout: 10_000 })).stdout, /SkillFlux/);
  }
  registryProcess = spawn(process.execPath, [cli, 'registry', '--port', '0', '--data-dir', join(temporary, 'registry')], {
    cwd: project, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SKILLFLUX_ADMIN_TOKEN: operatorToken },
  });
  const registry = await new Promise((resolveReady, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`Packed registry did not start: ${stderr}`)), 15_000);
    registryProcess.once('error', error => { clearTimeout(timeout); reject(error); });
    registryProcess.once('exit', code => { clearTimeout(timeout); reject(new Error(`Packed registry exited ${code}: ${stderr}`)); });
    registryProcess.stderr.on('data', chunk => {
      stderr += chunk.toString();
      const match = stderr.match(/listening on (http:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolveReady(match[1]); }
    });
  });
  const fixture = JSON.parse(await readFile(join(root, 'mcp/catalog/seed.json'), 'utf8')).find(item => item.id === 'code-review');
  assert.ok(fixture, 'Packed code-review fixture is available for this isolated test');
  const headers = { Authorization: `Bearer ${operatorToken}`, 'Content-Type': 'application/json' };
  const submit = await fetch(`${registry}/v1/admin/skills`, { method: 'POST', headers, body: JSON.stringify({ ...fixture, release: { notes: 'Synthetic packed-consumer fixture only', breaking: false, minClientVersion: '1.0.0', maintainedAt: new Date().toISOString(), maintainedBy: 'Isolated package smoke test' } }) });
  assert.equal(submit.status, 201, await submit.text());
  const pendingCatalog = await (await fetch(`${registry}/v1/catalog`)).json();
  assert.equal(pendingCatalog.payload.skills.length, 0, 'Unreviewed fixture remains quarantined');
  const detail = await (await fetch(`${registry}/v1/admin/skills/code-review/1.0.0`, { headers })).json();
  const evaluation = { contentHash: detail.contentHash, tester: 'Synthetic package smoke actor', testedAt: new Date().toISOString(), environment: 'Isolated packed-consumer test; simulated operator evidence, not real QA', kind: 'human', purpose: { input: 'Synthetic input', expected: 'Synthetic result', actual: 'Synthetic result', passed: true }, boundary: { input: 'Synthetic boundary', expected: 'Synthetic result', actual: 'Synthetic result', passed: true }, hostChecks: fixture.hosts.map(host => ({ host, installed: true, read: true, notes: 'Synthetic package smoke fixture; not a production test record' })), publicSummary: 'Synthetic package smoke fixture only; not actual human QA.' };
  const evaluated = await fetch(`${registry}/v1/admin/skills/code-review/1.0.0/evaluations`, { method: 'POST', headers, body: JSON.stringify(evaluation) });
  assert.equal(evaluated.status, 201, await evaluated.text());
  const reviewed = await fetch(`${registry}/v1/admin/skills/code-review/1.0.0/review`, { method: 'POST', headers, body: JSON.stringify({ action: 'approve', reviewer: 'Synthetic package smoke actor', notes: 'Synthetic integration approval scoped to this disposable registry.' }) });
  assert.equal(reviewed.status, 200, await reviewed.text());
  await invoke(['init', '--project', project, '--registry', registry, '--host', 'generic']);
  const installation = JSON.parse((await invoke(['install', 'code-review@1.0.0', '--project', project])).stdout);
  assert.equal(installation.rootSkill.id, 'code-review');
  const loaded = JSON.parse((await invoke(['load', 'code-review', '--project', project, '--no-ad'])).stdout);
  assert.match(loaded.entry.content, /# Code review/);
  assert.match(await readFile(join(project, '.skillflux/bootstrap/skillflux/SKILL.md'), 'utf8'), /skillflux\.search/);
  const config = JSON.parse(await readFile(join(project, '.mcp.json'), 'utf8'));
  assert.equal(await realpath(config.mcpServers.skillflux.args[0]), await realpath(cli));
  client = new Client({ name: 'packed-consumer-check', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: config.mcpServers.skillflux.args, stderr: 'pipe' }));
  const tools = await client.listTools();
  assert.ok(tools.tools.some(tool => tool.name === 'skillflux.load'));
  const result = await client.callTool({ name: 'skillflux.load', arguments: { skillId: 'code-review' } });
  assert.notEqual(result.isError, true);
  assert.match(JSON.stringify(result), /# Code review/);
  console.log('Package smoke passed: tarball → clean npm install → registry → project init → exact-version install → compiled stdio MCP load.');
} finally {
  await client?.close();
  if (registryProcess && registryProcess.exitCode === null) {
    const exited = once(registryProcess, 'exit');
    registryProcess.kill('SIGTERM');
    const timeout = setTimeout(() => registryProcess.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(timeout);
  }
  await rm(temporary, { recursive: true, force: true });
}
