import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TestContext } from 'node:test';
import type { Bundle, Host } from '../src/shared.js';
import { sha256 } from '../src/shared.js';
import type { CatalogIndex, CatalogIndexEntry } from '../src/catalog/model.js';
import { initializeProject } from '../src/runtime/project.js';
import { SkillFluxRuntime } from '../src/runtime/runtime.js';

/**
 * Local fixture emulating a GitHub catalog repository.
 * Serves raw.githubusercontent-style paths (`/<owner>/<repo>/<sha>/<path>`)
 * plus a GitHub-style commits API for head resolution. All content is synthetic
 * and marked as such; it represents protocol states, never real human testing.
 */
export async function fixtureCatalog(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'skillflux-catalog-fixture-'));
  const project = join(directory, 'project');
  await mkdir(project);
  const repo = 'fixture-owner/skillflux-catalog';
  const skills = new Map<string, { bundle: Bundle; status: string; qualification: string }>();
  let headCounter = 0;
  let offline = false;
  let failDownloads = false;
  const tamperFiles = new Map<string, string>();
  const requests: string[] = [];
  let head = newHead();
  let server: Server | null = null;

  function newHead(): string {
    headCounter += 1;
    return createHash('sha1').update(`fixture-commit-${headCounter}-${randomUUID()}`).digest('hex');
  }

  function add(version: string, options: { id?: string; minClient?: string; hosts?: Host[]; breaking?: boolean; deps?: { id: string; version: string }[]; status?: string; qualification?: string } = {}) {
    const id = options.id ?? 'code-review';
    const text = `---\nname: ${id}\ndescription: Synthetic test fixture\n---\n\n# Code review\n\nSynthetic test fixture version ${version}.\n`;
    const createdAt = new Date().toISOString();
    const bundle: Bundle = {
      manifest: {
        schema: 'skillflux/v1', id, version, name: 'Synthetic review fixture', description: 'Runtime protocol test fixture only',
        category: 'development', tags: [], hosts: options.hosts ?? ['generic'], publisher: 'Synthetic test fixture (not a person)', license: 'MIT', entry: 'SKILL.md',
        permissions: { network: [], shell: false, secrets: [] }, dependencies: options.deps ?? [],
        createdAt, release: { notes: `Synthetic release ${version}`, breaking: options.breaking ?? false, minClientVersion: options.minClient ?? '1.0.0', maintainedAt: createdAt, maintainedBy: 'Synthetic fixture' },
      },
      files: { 'SKILL.md': text },
    };
    const status = options.status ?? 'approved';
    const qualification = options.qualification ?? (status === 'approved' ? 'qualified' : 'needs-testing');
    skills.set(`${id}@${version}`, { bundle, status, qualification });
    head = newHead();
    return bundle;
  }

  function setStatus(id: string, version: string, status: string, qualification: string) {
    const entry = skills.get(`${id}@${version}`);
    if (!entry) throw new Error(`Fixture skill not found: ${id}@${version}`);
    entry.status = status;
    entry.qualification = qualification;
    head = newHead();
  }

  function revoke(id: string, version: string) {
    setStatus(id, version, 'revoked', 'revoked');
  }

  function entryFor(id: string, version: string): CatalogIndexEntry | null {
    const record = skills.get(`${id}@${version}`);
    if (!record) return null;
    const manifest = record.bundle.manifest;
    const files = Object.entries(record.bundle.files).map(([path, content]) => ({ path, sha256: sha256(content), size: Buffer.byteLength(content) }));
    const digest = sha256(JSON.stringify(manifest));
    return {
      skill: {
        id: manifest.id, version: manifest.version, name: manifest.name, description: manifest.description,
        category: manifest.category, tags: manifest.tags, hosts: manifest.hosts, publisher: manifest.publisher,
        license: manifest.license, status: record.status as CatalogIndexEntry['skill']['status'], digest,
        size: files.reduce((sum, file) => sum + file.size, 0), entry: manifest.entry,
        permissions: manifest.permissions, dependencies: manifest.dependencies, createdAt: manifest.createdAt,
        release: manifest.release, qualification: record.qualification as CatalogIndexEntry['skill']['qualification'],
        quality: {
          automated: { passed: true, checks: ['synthetic fixture'], checkedAt: manifest.createdAt },
          review: { reviewer: 'Synthetic fixture; not a real evaluation', reviewedAt: manifest.createdAt, notes: 'Protocol test state only' },
          evaluation: {
            evaluationId: `synthetic-${id}-${version}`, contentHash: digest, testedAt: manifest.createdAt,
            summary: 'Synthetic public proof for protocol tests; not actual human testing', hosts: manifest.hosts,
            purposePassed: true, boundaryPassed: true,
          },
        },
      },
      files,
    };
  }

  function buildIndex(): CatalogIndex {
    const entries = [...skills.keys()].sort().map(key => {
      const [id, version] = key.split('@');
      return entryFor(id!, version!);
    }).filter((entry): entry is CatalogIndexEntry => entry !== null);
    return { schema: 'skillflux-catalog-index/v1', generatedAt: new Date().toISOString(), skills: entries };
  }

  // Seed the fixture with a base version.
  add('1.0.0');

  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    requests.push(`${req.method} ${url.pathname}`);
    if (offline) { req.socket.destroy(); return; }
    const send = (value: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    const sendText = (value: string, status = 200) => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }); res.end(value); };
    if (url.pathname === `/api/repos/${repo}/commits/main`) return send({ sha: head });
    const raw = new RegExp(`^/${repo}/([0-9a-f]{40})/(.+)$`).exec(url.pathname);
    if (!raw) return send({ error: { code: 'not_found', message: `Fixture path miss: ${url.pathname}` } }, 404);
    const [, sha, path] = raw;
    if (sha !== head) return send({ error: { code: 'not_found', message: 'Fixture only serves its current head SHA' } }, 404);
    if (failDownloads) return send({ error: { code: 'source_unavailable', message: 'Fixture download failure injected' } }, 500);
    if (path === 'index.json') return send(buildIndex());
    const fileMatch = /^skills\/([^/]+)\/([^/]+)\/(.+)$/.exec(path!);
    if (!fileMatch) return send({ error: { code: 'not_found', message: 'Not a fixture skill path' } }, 404);
    const [, id, version, filePath] = fileMatch;
    const record = skills.get(`${id}@${version}`);
    if (!record) return send({ error: { code: 'not_found', message: `No fixture skill ${id}@${version}` } }, 404);
    const content = tamperFiles.get(`${id}@${version}/${filePath}`) ?? record.bundle.files[filePath!];
    if (content === undefined) return send({ error: { code: 'not_found', message: `No fixture file ${filePath}` } }, 404);
    return sendText(content);
  });
  await new Promise<void>(resolveListen => { server!.listen(0, '127.0.0.1', resolveListen); });
  const address = server!.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const origin = `http://127.0.0.1:${port}`;
  await initializeProject({
    projectRoot: project,
    repo,
    host: 'generic',
    cliPath: process.execPath,
    source: origin,
    preauthorizeReviewedText: false,
  });
  t.after(async () => {
    await new Promise<void>(resolveClose => server?.close(() => resolveClose()));
    await rm(directory, { recursive: true, force: true });
  });

  return {
    project,
    repo,
    origin,
    requests,
    add,
    revoke,
    setStatus,
    commit: () => head,
    setOffline: (value: boolean) => { offline = value; },
    setFailDownloads: (value: boolean) => { failDownloads = value; },
    tamper: (id: string, version: string, file: string, content: string) => { tamperFiles.set(`${id}@${version}/${file}`, content); },
    index: buildIndex,
    skills,
  };
}
