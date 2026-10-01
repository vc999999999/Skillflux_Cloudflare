import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, readlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';
import { ELEMENT_NODE, parse, walkSync, type ElementNode } from 'ultrahtml';
import { createRegistryServer } from '../../mcp/src/registry/server';
import { makeLegacyFixture, publishSyntheticFixture, recordSyntheticEvaluation, syntheticRelease } from '../../mcp/tests/registry-fixture';
import { RegistryStore } from '../../mcp/src/registry/database';
import type { PublicKeyInfo, Submission } from '../../mcp/src/shared';
import { synchronizePublication } from '../scripts/sync-publication';
import { buildPublication } from '../scripts/publication-build';
import { inspectHtml } from '../scripts/seo-build';

const token = 'publication-isolated-integration-operator';
function fixture(id: string): Submission {
  return { id, version: '1.0.0', name: `Synthetic ${id}`, description: 'Isolated publication integration fixture', category: 'development', tags: ['test'], hosts: ['generic'], publisher: 'Integration tests', license: 'MIT', entry: 'SKILL.md', permissions: { network: [], shell: false, secrets: [] }, dependencies: [], files: { 'SKILL.md': `# ${id}\n\nUNIQUE_PRIVATE_PACKAGE_BODY_${id} follows the intended test task.`, 'references/example.md': 'Synthetic resource' }, release: syntheticRelease };
}
async function registry(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'skillflux-publication-test-'));
  const server = await createRegistryServer({ dataDir: join(directory, 'data'), adminToken: token });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
  return { base, directory };
}
async function review(base: string, id: string, action: 'approve' | 'revoke') {
  const response = await fetch(`${base}/v1/admin/skills/${id}/1.0.0/review`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reviewer: 'Synthetic actor', notes: action === 'revoke' ? 'Synthetic public revocation reason' : 'Synthetic isolated test approval' }) });
  assert.equal(response.status, 200, await response.text());
}

test('real signed paginated sync requires initial trust, pins keys, rejects tampering and mixed revisions, and preserves the last snapshot on failure', async t => {
  const first = await registry(t), second = await registry(t);
  for (let i = 0; i < 11; i++) await publishSyntheticFixture(first.base, token, fixture(`page-skill-${i}`));
  let upstream = first.base;
  let mode: 'normal' | 'tamper' | 'change-revision' = 'normal';
  let revisionChanged = false;
  const proxy = http.createServer((request, response) => {
    void (async () => {
      if (mode === 'change-revision' && request.url?.startsWith('/v1/publication?offset=10') && !revisionChanged) {
        revisionChanged = true;
        await publishSyntheticFixture(first.base, token, fixture('concurrent-publication'));
      }
      const result = await fetch(upstream + request.url);
      let body = await result.text();
      if (mode === 'tamper' && request.url?.startsWith('/v1/publication?')) {
        const envelope = JSON.parse(body); envelope.payload.items[0].skill.description = 'Tampered network bytes'; body = JSON.stringify(envelope);
      }
      response.statusCode = result.status; response.setHeader('Content-Type', 'application/json'); response.end(body);
    })().catch(error => { response.statusCode = 500; response.end(JSON.stringify({ error: String(error) })); });
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise<void>(resolve => proxy.close(() => resolve())); });
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  const output = join(first.directory, 'snapshot.json');
  await assert.rejects(synchronizePublication({ registry: proxyUrl, output }), /First sync needs/);
  const initial = await synchronizePublication({ registry: proxyUrl, output, acceptFirstKey: true });
  assert.equal(initial.pages.length, 2); assert.equal(initial.pages[0]!.payload.total, 11);
  const original = await readFile(output, 'utf8');
  mode = 'tamper'; await assert.rejects(synchronizePublication({ registry: proxyUrl, output }), /signature/);
  assert.equal(await readFile(output, 'utf8'), original);
  mode = 'change-revision'; await assert.rejects(synchronizePublication({ registry: proxyUrl, output }), /changed during sync/);
  assert.equal(await readFile(output, 'utf8'), original);
  mode = 'normal';
  const retried = await synchronizePublication({ registry: proxyUrl, output });
  assert.equal(retried.pages[0]!.payload.total, 12);
  const verified = await readFile(output, 'utf8');
  upstream = second.base;
  await assert.rejects(synchronizePublication({ registry: proxyUrl, output, acceptFirstKey: true }), /signing key changed/);
  assert.equal(await readFile(output, 'utf8'), verified);
  const explicitKey = await (await fetch(second.base + '/v1/keys')).json() as PublicKeyInfo;
  const explicit = await synchronizePublication({ registry: second.base, output: join(second.directory, 'first-snapshot.json'), trustedKey: explicitKey });
  assert.equal(explicit.pages[0]!.payload.total, 0);
});

test('real static builds publish same-name skills through approval, historic retest and revocation; failed build preserves the live release', { timeout: 180_000 }, async t => {
  const { base, directory } = await registry(t);
  const current = join(directory, 'served-current');
  const sharedName = 'Synthetic code reviewer';
  await publishSyntheticFixture(base, token, { ...fixture('published-example'), name: sharedName });
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
  const first = await buildPublication({ registry: base, output: current, acceptFirstKey: true });
  assert.equal(first.changed, true); assert.equal(first.versions, 1);
  for (const prefix of ['', 'en/']) {
    const setup = await readFile(join(first.dist, `${prefix}install/index.html`), 'utf8');
    const nodes: ElementNode[] = [];
    walkSync(parse(setup), node => { if (node.type === ELEMENT_NODE) nodes.push(node); });
    assert.equal(nodes.find(node => 'data-setup-registry' in node.attributes)?.attributes['data-setup-registry'], base);
    const initCopy = nodes.find(node => 'data-init-copy' in node.attributes);
    assert.ok(initCopy?.attributes['data-copy-text']?.includes(base), 'Setup must initialize the registry from this signed publication');
    assert.ok(!initCopy?.attributes['data-copy-text']?.includes('http://127.0.0.1:8787'), 'Setup must not silently initialize the default development registry');
  }
  const originalPointer = await readlink(current);
  const originalSnapshot = await readFile(first.snapshot, 'utf8');
  const publishedHtml = await readFile(join(first.dist, 'skills/published-example/index.html'), 'utf8');
  assert.ok(publishedHtml.includes('UNIQUE_PRIVATE_PACKAGE_BODY_published-example'));
  const machineText = await readFile(join(first.dist, 'skills-index.json'), 'utf8');
  assert.ok(machineText.includes('published-example'));
  const machine = JSON.parse(machineText); assert.ok(JSON.stringify(machine).includes('qualified'));
  const unchanged = await buildPublication({ registry: base, output: current });
  assert.equal(unchanged.changed, false); assert.equal(await readlink(current), originalPointer);
  const store = await RegistryStore.open(join(directory, 'data'));
  try {
    const historical = { ...fixture('legacy-example'), name: sharedName }; delete historical.release;
    makeLegacyFixture(store, historical);
    await recordSyntheticEvaluation(base, token, historical.id, historical.version);
    await review(base, historical.id, 'approve');
  } finally { store.close(); }
  const previousSite = process.env.SITE_URL;
  process.env.SITE_URL = 'not-a-valid-url';
  try { await assert.rejects(buildPublication({ registry: base, output: current }), /Command failed|invalid|Invalid/); }
  finally { if (previousSite === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = previousSite; }
  assert.equal(await readlink(current), originalPointer);
  assert.equal(await readFile(first.snapshot, 'utf8'), originalSnapshot);
  assert.equal(await readFile(join(first.dist, 'skills/published-example/index.html'), 'utf8'), publishedHtml);
  const retested = await buildPublication({ registry: base, output: current });
  assert.equal(retested.versions, 2);
  await assertDistinctSkillTitles(retested.dist);
  assert.ok((await readFile(join(retested.dist, 'skills/legacy-example/index.html'), 'utf8')).includes('UNIQUE_PRIVATE_PACKAGE_BODY_legacy-example'));
  await review(base, 'published-example', 'revoke');
  const revoked = await buildPublication({ registry: base, output: current });
  assert.equal(revoked.versions, 1);
  await assertDistinctSkillTitles(revoked.dist);
  const unavailable = await readFile(join(revoked.dist, 'skills/published-example/index.html'), 'utf8');
  assert.ok(!unavailable.includes('UNIQUE_PRIVATE_PACKAGE_BODY_published-example'));
  assert.match(unavailable, /撤销|revoked/);
  const versionHtml = await readFile(join(revoked.dist, 'skills/published-example/versions/1.0.0/index.html'), 'utf8');
  assert.ok(!versionHtml.includes('UNIQUE_PRIVATE_PACKAGE_BODY_published-example'));
  const revokedIndex = await readFile(join(revoked.dist, 'skills-index.json'), 'utf8');
  assert.ok(revokedIndex.includes('revoked'));
  for (const path of ['index.json', 'skills-index.json', 'llms.txt', 'llms-full.txt']) assert.ok(!(await readFile(join(revoked.dist, path), 'utf8')).includes('UNIQUE_PRIVATE_PACKAGE_BODY_published-example'), `${path} must remove revoked package content`);
  assert.notEqual(await readlink(current), originalPointer);
  assert.equal(JSON.parse(await readFile(revoked.snapshot, 'utf8')).pages[0].payload.items.length, 1);
  assert.equal((await fetch(base + '/v1/skills/published-example')).status, 410);
});

test('static registry pagination publishes real bilingual page two with canonical metadata and no-JavaScript links', { timeout: 180_000 }, async t => {
  const { base, directory } = await registry(t);
  // The fixture uses the same signed publication/evaluation path as a real release,
  // entirely against an isolated local server and a temporary output directory.
  for (let index = 0; index < 13; index++) await publishSyntheticFixture(base, token, fixture(`pagination-${String(index).padStart(2, '0')}`));
  const published = await buildPublication({ registry: base, output: join(directory, 'paginated-current'), acceptFirstKey: true });
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
});
