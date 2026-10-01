import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import test, { type TestContext } from 'node:test';
import { ELEMENT_NODE, parse, walkSync, type ElementNode } from 'ultrahtml';
import type { CatalogIndex, CatalogIndexEntry } from '../../mcp/src/catalog/model';
import { canonical, sha256, type Host } from '../../mcp/src/shared';
import { synchronizePublication } from '../scripts/sync-publication';
import { buildPublication } from '../scripts/publication-build';
import { inspectHtml } from '../scripts/seo-build';

/**
 * Local GitHub catalog fixture: serves the GitHub commits API and
 * raw.githubusercontent-style paths with commit-SHA pinning. All content is
 * synthetic and marked as such; it represents protocol states only.
 */
async function catalogServer(t: TestContext, entries: () => CatalogIndexEntry[]): Promise<{ base: string; directory: string; recommit: () => string; commit: () => string }> {
  const directory = await mkdtemp(join(tmpdir(), 'skillflux-publication-test-'));
  let commit = newSha();
  const server: Server = http.createServer((request, response) => {
    const url = new URL(request.url!, 'http://127.0.0.1');
    const send = (value: unknown, status = 200) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
    const sendText = (value: string, status = 200) => { response.statusCode = status; response.setHeader('Content-Type', 'text/plain; charset=utf-8'); response.end(value); };
    if (url.pathname === '/api/repos/fixture-owner/skillflux-catalog/commits/main') return send({ sha: commit });
    const raw = /^\/fixture-owner\/skillflux-catalog\/([0-9a-f]{40})\/(.+)$/.exec(url.pathname);
    if (!raw) return send({ error: { code: 'not_found', message: 'Fixture path miss' } }, 404);
    const [, sha, path] = raw;
    if (sha !== commit) return send({ error: { code: 'not_found', message: 'Fixture only serves its current commit' } }, 404);
    if (path === 'index.json') {
      const index: CatalogIndex = { schema: 'skillflux-catalog-index/v1', generatedAt: new Date().toISOString(), skills: entries() };
      return send(index);
    }
    const fileMatch = /^skills\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/.exec(path!);
    if (!fileMatch) return send({ error: { code: 'not_found', message: 'Not a fixture skill path' } }, 404);
    const [, _category, id, version, filePath] = fileMatch;
    const entry = entries().find(item => item.skill.id === id && item.skill.version === version) as FixtureEntry | undefined;
    const content = entry?.bundleFiles?.[filePath!];
    if (content === undefined) return send({ error: { code: 'not_found', message: 'No fixture file' } }, 404);
    return sendText(content);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
  return {
    base,
    directory,
    commit: () => commit,
    recommit: () => { commit = newSha(); return commit; },
  };
}

function newSha(): string {
  return createHash('sha1').update(`fixture-${randomUUID()}`).digest('hex');
}

type FixtureEntry = CatalogIndexEntry & { bundleFiles: Record<string, string> };
// deno-lint-ignore no-explicit-any


function entry(id: string, options: { name?: string; status?: string; qualification?: string; body?: string } = {}): FixtureEntry {
  const text = `---\nname: ${id}\ndescription: Synthetic fixture\n---\n\n# ${id}\n\nUNIQUE_PRIVATE_PACKAGE_BODY_${id} follows the intended test task.`;
  const files: Record<string, string> = { 'SKILL.md': text, 'references/example.md': 'Synthetic resource' };
  const createdAt = new Date().toISOString();
  const status = (options.status ?? 'approved') as CatalogIndexEntry['skill']['status'];
  const qualification = (options.qualification ?? (status === 'approved' ? 'qualified' : 'needs-testing')) as CatalogIndexEntry['skill']['qualification'];
  const manifest = {
    schema: 'skillflux/v1' as const, id, version: '1.0.0', name: options.name ?? `Synthetic ${id}`,
    description: 'Isolated publication integration fixture', category: 'development', tags: ['test'],
    hosts: ['generic'] as Host[], publisher: 'Integration tests', license: 'MIT', entry: 'SKILL.md',
    permissions: { network: [], shell: false, secrets: [] }, dependencies: [], createdAt,
    release: { notes: 'Synthetic release notes', breaking: false, minClientVersion: '1.0.0', maintainedAt: createdAt, maintainedBy: 'Integration tests' },
  };
  const fileRecords = Object.entries(files).map(([path, content]) => ({ path, sha256: sha256(content), size: Buffer.byteLength(content) }));
  const digest = sha256(canonical({ manifest, files }));
  return {
    skill: {
      ...manifest, status, digest, size: fileRecords.reduce((sum, file) => sum + file.size, 0),
      qualification, quality: {
        automated: { passed: true, checks: ['synthetic fixture'], checkedAt: createdAt },
        review: { reviewer: 'Synthetic actor', reviewedAt: createdAt, notes: 'Synthetic isolated test approval' },
        evaluation: { evaluationId: `synthetic-${id}`, contentHash: digest, testedAt: createdAt, summary: 'Synthetic public summary; not actual human testing', hosts: ['generic'], purposePassed: true, boundaryPassed: true },
      },
    },
    files: fileRecords,
    bundleFiles: files,
  };
}

test('catalog sync downloads at the pinned commit, verifies hashes and preserves the last snapshot on failure', async t => {
  let entries: FixtureEntry[] = [entry('sync-skill')];
  const fixture = await catalogServer(t, () => entries);
  const output = join(fixture.directory, 'snapshot.json');
  const first = await synchronizePublication({ repo: 'fixture-owner/skillflux-catalog', output, source: fixture.base });
  assert.equal(first.items.length, 1);
  assert.equal(first.commitSha, fixture.commit());
  const original = await readFile(output, 'utf8');

  await assert.rejects(synchronizePublication({ repo: 'different-owner/skillflux-catalog', output, source: fixture.base }), /pinned to fixture-owner\/skillflux-catalog/);
  assert.equal(await readFile(output, 'utf8'), original);

  // Tampering a file body must fail the hash check and preserve the existing snapshot.
  const tampered = entries[0]!;
  entries = [{ ...tampered, bundleFiles: { ...tampered.bundleFiles, 'SKILL.md': '---\nname: t\n---\ntampered body' } }];
  fixture.recommit();
  await assert.rejects(synchronizePublication({ repo: 'fixture-owner/skillflux-catalog', output, source: fixture.base }), /does not match the catalog hash/);
  assert.equal(await readFile(output, 'utf8'), original);

  // Restoring the body makes the next sync succeed with a new commit.
  entries = [tampered];
  fixture.recommit();
  const retried = await synchronizePublication({ repo: 'fixture-owner/skillflux-catalog', output, source: fixture.base });
  assert.equal(retried.commitSha, fixture.commit());
});

test('real static builds publish same-name skills; failed build preserves the live release', { timeout: 180_000 }, async t => {
  let entries: FixtureEntry[] = [entry('published-example', { name: 'Synthetic code reviewer' })];
  const fixture = await catalogServer(t, () => entries);
  const current = join(fixture.directory, 'served-current');
  const sharedName = 'Synthetic code reviewer';
  async function assertDistinctSkillTitles(dist: string): Promise<void> {
    for (const prefix of ['', 'en/']) {
      const titles: string[] = [];
      for (const id of ['published-example', 'legacy-example']) {
        for (const version of [undefined, '1.0.0']) {
          const file = `${prefix}skills/${id}/${version ? `versions/${version}/` : ''}index.html`;
          const page = inspectHtml(file, await readFile(join(dist, file), 'utf8'));
          assert.ok(page.title.includes(sharedName), `${file} must preserve the readable skill name`);
          assert.ok(page.title.includes(id), `${file} must distinguish the stable skill ID`);
          if (version) assert.ok(page.title.includes(version), `${file} must identify the exact release`);
          titles.push(page.title);
        }
      }
      assert.equal(new Set(titles).size, titles.length, `${prefix || 'zh/'} same-name skills and their versions need distinct titles`);
    }
  }
  const first = await buildPublication({ repo: 'fixture-owner/skillflux-catalog', output: current, source: fixture.base });
  assert.equal(first.changed, true); assert.equal(first.versions, 1);
  for (const prefix of ['', 'en/']) {
    const setup = await readFile(join(first.dist, `${prefix}install/index.html`), 'utf8');
    const nodes: ElementNode[] = [];
    walkSync(parse(setup), node => { if (node.type === ELEMENT_NODE) nodes.push(node); });
    assert.equal(nodes.find(node => 'data-catalog-repo' in node.attributes)?.attributes['data-catalog-repo'], 'fixture-owner/skillflux-catalog');
    const initCopy = nodes.find(node => 'data-init-copy' in node.attributes);
    assert.ok(initCopy?.attributes['data-copy-text']?.includes('--repo fixture-owner/skillflux-catalog'), 'Setup must initialize from this catalog repository');
  }
  const originalPointer = await readlink(current);
  const publishedHtml = await readFile(join(first.dist, 'skills/published-example/index.html'), 'utf8');
  assert.ok(publishedHtml.includes('UNIQUE_PRIVATE_PACKAGE_BODY_published-example'));
  const machineText = await readFile(join(first.dist, 'skills-index.json'), 'utf8');
  assert.ok(machineText.includes('published-example'));
  const machine = JSON.parse(machineText); assert.ok(JSON.stringify(machine).includes('qualified'));
  // Same commit and no force → no rebuild.
  const unchanged = await buildPublication({ repo: 'fixture-owner/skillflux-catalog', output: current, source: fixture.base });
  assert.equal(unchanged.changed, false); assert.equal(await readlink(current), originalPointer);
  // New commit with an additional skill → rebuild with two versions.
  entries = [entry('published-example', { name: sharedName }), entry('legacy-example', { name: sharedName })];
  fixture.recommit();
  const retested = await buildPublication({ repo: 'fixture-owner/skillflux-catalog', output: current, source: fixture.base });
  assert.equal(retested.versions, 2);
  await assertDistinctSkillTitles(retested.dist);
  assert.ok((await readFile(join(retested.dist, 'skills/legacy-example/index.html'), 'utf8')).includes('UNIQUE_PRIVATE_PACKAGE_BODY_legacy-example'));
  // A failing build (broken SITE_URL) must preserve the live release.
  const beforePointer = await readlink(current);
  const beforeSnapshot = await readFile(retested.snapshot, 'utf8');
  const beforeHtml = await readFile(join(retested.dist, 'skills/published-example/index.html'), 'utf8');
  const previousSite = process.env.SITE_URL;
  process.env.SITE_URL = 'not-a-valid-url';
  fixture.recommit();
  try { await assert.rejects(buildPublication({ repo: 'fixture-owner/skillflux-catalog', output: current, source: fixture.base }), /Command failed|invalid|Invalid/); }
  finally { if (previousSite === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = previousSite; }
  assert.equal(await readlink(current), beforePointer);
  assert.equal(await readFile(retested.snapshot, 'utf8'), beforeSnapshot);
  assert.equal(await readFile(join(retested.dist, 'skills/published-example/index.html'), 'utf8'), beforeHtml);
  // Revoking removes the package content from the rebuilt release.
  entries = [entry('published-example', { name: sharedName, status: 'revoked', qualification: 'revoked' }), entry('legacy-example', { name: sharedName })];
  fixture.recommit();
  const revoked = await buildPublication({ repo: 'fixture-owner/skillflux-catalog', output: current, source: fixture.base });
  assert.equal(revoked.versions, 1);
  // Revoked entries publish a status-only page: no installable content, but the
  // revocation itself stays visible on the skill detail page.
  const revokedPage = await readFile(join(revoked.dist, 'skills/published-example/index.html'), 'utf8');
  assert.ok(!revokedPage.includes('UNIQUE_PRIVATE_PACKAGE_BODY_published-example'), 'revoked page must not contain package content');
  assert.match(revokedPage, /撤销|revoked/i);
  for (const path of ['index.json', 'skills-index.json', 'llms.txt', 'llms-full.txt']) assert.ok(!(await readFile(join(revoked.dist, path), 'utf8')).includes('UNIQUE_PRIVATE_PACKAGE_BODY_published-example'), `${path} must remove revoked package content`);
  assert.notEqual(await readlink(current), originalPointer);
});

test('a non-catalog publication snapshot is rejected without changing the served release', async t => {
  const fixture = await catalogServer(t, () => []);
  const current = join(fixture.directory, 'served-current');
  const prior = join(fixture.directory, 'prior-release');
  await mkdir(prior);
  const invalidSnapshot = JSON.stringify({ schema: 'unsupported-publication', items: [] });
  await writeFile(join(prior, 'registry-publication.json'), invalidSnapshot);
  await symlink('prior-release', current);
  await assert.rejects(buildPublication({ repo: 'fixture-owner/skillflux-catalog', output: current, source: fixture.base }), /Invalid SkillFlux publication snapshot/);
  assert.equal(await readlink(current), 'prior-release');
  assert.equal(await readFile(join(prior, 'registry-publication.json'), 'utf8'), invalidSnapshot);
});

test('static registry pagination publishes real bilingual page two with canonical metadata and no-JavaScript links', { timeout: 180_000 }, async t => {
  const entries: FixtureEntry[] = Array.from({ length: 13 }, (_, index) => entry(`pagination-${String(index).padStart(2, '0')}`));
  const fixture = await catalogServer(t, () => entries);
  const published = await buildPublication({ repo: 'fixture-owner/skillflux-catalog', output: join(fixture.directory, 'paginated-current'), source: fixture.base });
  assert.equal(published.versions, 13);
  const sitemap = await readFile(join(published.dist, 'sitemap-static.xml'), 'utf8');
  for (const prefix of ['', 'en/']) {
    const firstFile = `${prefix}registry/index.html`;
    const secondFile = `${prefix}registry/page/2/index.html`;
    const firstHtml = await readFile(join(published.dist, firstFile), 'utf8');
    const secondHtml = await readFile(join(published.dist, secondFile), 'utf8');
    const first = inspectHtml(firstFile, firstHtml);
    const second = inspectHtml(secondFile, secondHtml);
    assert.equal(first.indexable, true);
    assert.equal(second.indexable, true);
    assert.equal(new URL(first.canonical).pathname, `/${prefix}registry/`);
    assert.equal(new URL(second.canonical).pathname, `/${prefix}registry/page/2/`);
    assert.notEqual(first.title, second.title);
    assert.notEqual(first.description, second.description);
    assert.ok(sitemap.includes(second.canonical));

    const nodes = (html: string) => {
      const result: ElementNode[] = [];
      walkSync(parse(html), node => { if (node.type === ELEMENT_NODE) result.push(node); });
      return result;
    };
    const firstNodes = nodes(firstHtml), secondNodes = nodes(secondHtml);
    const visibleIds = (items: ElementNode[]) => items.filter(node => node.name === 'article' && 'data-skill-id' in node.attributes && !('hidden' in node.attributes)).map(node => node.attributes['data-skill-id']);
    const firstIds = visibleIds(firstNodes), secondIds = visibleIds(secondNodes);
    assert.equal(firstIds.length, 12);
    assert.equal(secondIds.length, 1);
    assert.equal(new Set([...firstIds, ...secondIds]).size, 13);
    const next = firstNodes.find(node => 'data-skill-next' in node.attributes)!;
    const previous = secondNodes.find(node => 'data-skill-prev' in node.attributes)!;
    assert.equal(next.name, 'a');
    assert.equal(next.attributes.href, `/${prefix}registry/page/2/`);
    assert.ok(!('hidden' in next.attributes));
    assert.equal(previous.name, 'a');
    assert.equal(previous.attributes.href, `/${prefix}registry/`);
    assert.ok(!('hidden' in previous.attributes));
    assert.ok(secondHtml.includes('<noscript>'));
    await assert.rejects(readFile(join(published.dist, `${prefix}registry/page/3/index.html`)), { code: 'ENOENT' });
  }
  void mkdir;
  void writeFile;
});
