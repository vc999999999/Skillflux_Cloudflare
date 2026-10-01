import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'skillflux-package-smoke-'));
const execute = promisify(execFile);
const npmPath = process.env.npm_execpath;
assert.ok(npmPath, 'Run this check using npm run smoke:package');
const npm = (args, options = {}) => execute(process.execPath, [npmPath, ...args], { cwd: root, timeout: 120_000, maxBuffer: 2 * 1024 * 1024, ...options });
let server;
let client;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

try {
  const packed = await npm(['pack', '--workspace', '@skillflux/mcp', '--pack-destination', temporary, '--json']);
  const [{ filename, files }] = JSON.parse(packed.stdout);
  for (const expected of ['dist/cli.js', 'dist/catalog/build.js', 'skills/skillflux/SKILL.md', 'skills/skillflux/agents/openai.yaml']) {
    assert.ok(files.some(file => file.path === expected), `Packed package is missing ${expected}`);
  }
  assert.ok(!files.some(file => /(?:^|\/)(?:var|keys|node_modules|\.env)(?:\/|$)/.test(file.path)), 'Private runtime data must not be packaged');
  assert.ok(!files.some(file => /^catalog\//.test(file.path)), 'Development samples must not ship in the published package');

  const consumer = join(temporary, 'consumer');
  const project = join(temporary, 'project');
  const catalogRoot = join(temporary, 'catalog-repo');
  await mkdir(consumer);
  await mkdir(project);
  await mkdir(join(catalogRoot, 'skills', 'code-review', '1.0.0'), { recursive: true });

  // Build a synthetic local catalog: one approved, qualified code-review version.
  const skillText = '---\nname: code-review\ndescription: Synthetic package smoke fixture\n---\n\n# Code review\n\nSynthetic package smoke fixture body; not real QA material.\n';
  const createdAt = new Date().toISOString();
  const manifest = {
    schema: 'skillflux/v1', id: 'code-review', version: '1.0.0', name: 'Code review',
    description: 'Synthetic package smoke fixture', category: 'development', tags: ['test'],
    hosts: ['generic', 'codex', 'claude', 'cursor'], publisher: 'Package smoke fixture (not a person)', license: 'MIT', entry: 'SKILL.md',
    permissions: { network: [], shell: false, secrets: [] }, dependencies: [], createdAt,
    release: { notes: 'Synthetic package smoke release', breaking: false, minClientVersion: '1.0.0', maintainedAt: createdAt, maintainedBy: 'Package smoke fixture' },
  };
  const fileRecords = [{ path: 'SKILL.md', sha256: sha256(skillText), size: Buffer.byteLength(skillText) }];
  const digest = sha256(JSON.stringify(manifest));
  const review = {
    status: 'approved', reviewer: 'Package smoke fixture', reviewedAt: createdAt,
    notes: 'Synthetic isolated package smoke; not a production review.',
    evaluation: {
      contentHash: digest, tester: 'Package smoke fixture', testedAt: createdAt,
      environment: 'Isolated local test', kind: 'human',
      purpose: { input: 'Synthetic input', expected: 'Synthetic result', actual: 'Synthetic result', passed: true },
      boundary: { input: 'Synthetic boundary', expected: 'Synthetic result', actual: 'Synthetic result', passed: true },
      hostChecks: manifest.hosts.map(host => ({ host, installed: true, read: true, notes: 'Synthetic; not a real host test' })),
      publicSummary: 'Synthetic package smoke fixture only; not actual human QA.',
    },
  };
  const versionDir = join(catalogRoot, 'skills', 'code-review', '1.0.0');
  await writeFile(join(versionDir, 'skillflux.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(versionDir, 'skillflux.review.json'), `${JSON.stringify(review, null, 2)}\n`);
  await writeFile(join(versionDir, 'SKILL.md'), skillText);
  const index = {
    schema: 'skillflux-catalog-index/v1', generatedAt: createdAt,
    skills: [{
      skill: {
        ...manifest, status: 'approved', digest, size: Buffer.byteLength(skillText),
        qualification: 'qualified',
        quality: {
          automated: { passed: true, checks: ['synthetic fixture'], checkedAt: createdAt },
          review: { reviewer: review.reviewer, reviewedAt: review.reviewedAt, notes: review.notes },
          evaluation: { evaluationId: 'synthetic-smoke', contentHash: digest, testedAt: createdAt, summary: review.evaluation.publicSummary, hosts: manifest.hosts, purposePassed: true, boundaryPassed: true },
        },
      },
      files: fileRecords,
    }],
  };

  // Serve the catalog GitHub-style: /api head resolution + raw paths pinned to a commit SHA.
  const commitSha = createHash('sha1').update(`smoke-${randomUUID()}`).digest('hex');
  const repo = 'fixture-owner/skillflux-catalog';
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const send = (value, status = 200) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
    const sendText = (value, status = 200) => { response.statusCode = status; response.setHeader('Content-Type', 'text/plain; charset=utf-8'); response.end(value); };
    if (url.pathname === `/api/repos/${repo}/commits/main`) return send({ sha: commitSha });
    const raw = new RegExp(`^/${repo}/([0-9a-f]{40})/(.+)$`).exec(url.pathname);
    if (!raw) return send({ error: { code: 'not_found', message: 'not found' } }, 404);
    const [, sha, path] = raw;
    if (sha !== commitSha) return send({ error: { code: 'not_found', message: 'commit not served' } }, 404);
    if (path === 'index.json') return send(index);
    if (path === 'skills/development/code-review/1.0.0/SKILL.md') return sendText(skillText);
    return send({ error: { code: 'not_found', message: 'not found' } }, 404);
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const origin = `http://127.0.0.1:${server.address().port}`;

  await npm(['install', '--prefix', consumer, '--ignore-scripts', '--no-audit', '--no-fund', join(temporary, filename)]);
  const cli = join(consumer, 'node_modules/@skillflux/mcp/dist/cli.js');
  const invoke = args => execute(process.execPath, [cli, ...args], { cwd: project, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  assert.match((await invoke(['--help'])).stdout, /SkillFlux/);
  if (process.platform !== 'win32') {
    const bin = join(consumer, 'node_modules/.bin/skillflux');
    assert.match((await execute(process.execPath, [bin, '--help'], { timeout: 10_000 })).stdout, /SkillFlux/);
  }
  await invoke(['init', '--project', project, '--repo', repo, '--source', origin, '--host', 'generic']);
  const search = JSON.parse((await invoke(['search', 'code review', '--project', project])).stdout);
  assert.equal(search.items[0].id, 'code-review');
  const installation = JSON.parse((await invoke(['install', 'code-review@1.0.0', '--project', project])).stdout);
  assert.equal(installation.rootSkill.id, 'code-review');
  const loaded = JSON.parse((await invoke(['load', 'code-review', '--project', project])).stdout);
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
  console.log('Package smoke passed: tarball → clean npm install → local GitHub-style catalog → init --repo → search → exact-version install → compiled stdio MCP load.');
} finally {
  await client?.close();
  if (server) {
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
  await rm(temporary, { recursive: true, force: true });
}
