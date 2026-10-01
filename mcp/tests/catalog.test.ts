import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const FIXTURE = {
  id: 'fixture-skill',
  version: '1.0.0',
  name: 'Fixture skill',
  description: 'Synthetic catalog build fixture; not a real evaluation.',
  category: 'development',
  tags: ['fixture'],
  hosts: ['generic'],
  publisher: 'Synthetic fixture',
  license: 'MIT',
  entry: 'SKILL.md',
  permissions: { network: [], shell: false, secrets: [] },
  dependencies: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  release: { notes: 'Synthetic fixture release', breaking: false, minClientVersion: '1.0.0', maintainedAt: '2026-10-01T00:00:00.000Z', maintainedBy: 'Synthetic fixture' },
};

function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  throw new Error('bad value');
}

async function makeCatalog(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'skillflux-catalog-test-'));
  const dir = join(root, 'skills', FIXTURE.id, '1.0.0');
  await mkdir(dir, { recursive: true });
  const files: Record<string, string> = { 'SKILL.md': '# Fixture\n\nSynthetic content.\n' };
  const manifest = { schema: 'skillflux/v1', ...FIXTURE };
  const contentHash = createHash('sha256').update(canonical({ manifest, files })).digest('hex');
  const review = {
    status: 'approved',
    reviewer: 'Synthetic fixture',
    reviewedAt: '2026-10-01T00:00:00.000Z',
    notes: 'Synthetic protocol state; not real human testing.',
    evaluation: {
      contentHash,
      tester: 'Synthetic fixture',
      testedAt: '2026-10-01T00:00:00.000Z',
      environment: 'local fixture',
      kind: 'human',
      purpose: { input: 'i', expected: 'e', actual: 'a', passed: true },
      boundary: { input: 'i', expected: 'e', actual: 'a', passed: true },
      hostChecks: [{ host: 'generic', installed: true, read: true, notes: 'synthetic' }],
      publicSummary: 'Synthetic summary; not actual human testing.',
    },
  };
  await writeFile(join(dir, 'skillflux.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(dir, 'skillflux.review.json'), `${JSON.stringify(review, null, 2)}\n`);
  await writeFile(join(dir, 'SKILL.md'), files['SKILL.md']!);
  return root;
}

test('catalog build produces a valid index and --check passes on a clean tree', async () => {
  const { buildCatalogIndex, checkCatalogIndex } = await import('../src/catalog/build.js');
  const root = await makeCatalog();
  try {
    const result = await buildCatalogIndex(root);
    assert.equal(result.index.schema, 'skillflux-catalog-index/v1');
    assert.equal(result.index.skills.length, 1);
    const entry = result.index.skills[0]!;
    assert.equal(entry.skill.id, FIXTURE.id);
    assert.equal(entry.skill.qualification, 'qualified');
    assert.equal(entry.files[0]!.path, 'SKILL.md');
    assert.match(entry.files[0]!.sha256, /^[a-f0-9]{64}$/);
    const check = await checkCatalogIndex(root);
    assert.equal(check.ok, true, 'clean tree must pass --check');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('catalog check detects a tampered index and tampered content', async () => {
  const { buildCatalogIndex, checkCatalogIndex } = await import('../src/catalog/build.js');
  const root = await makeCatalog();
  try {
    await buildCatalogIndex(root);
    // Tamper the index name.
    const indexPath = join(root, 'index.json');
    const index = JSON.parse(await readFile(indexPath, 'utf8'));
    index.skills[0].skill.name = 'Tampered';
    await writeFile(indexPath, JSON.stringify(index, null, 2));
    const tamperedIndex = await checkCatalogIndex(root);
    assert.equal(tamperedIndex.ok, false, 'tampered index must fail --check');
    // Restore by rebuilding, then tamper content (hash mismatch surfaces through the review binding).
    await buildCatalogIndex(root);
    await appendFile(join(root, 'skills', FIXTURE.id, '1.0.0', 'SKILL.md'), 'tamper\n');
    const tamperedContent = await checkCatalogIndex(root).catch(error => ({ ok: false, reason: error.message }));
    assert.equal(tamperedContent.ok, false, 'tampered content must fail --check');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('catalog build rejects unsafe permissions and unbound review evidence', async () => {
  const { buildCatalogIndex, checkCatalogIndex } = await import('../src/catalog/build.js');
  const root = await makeCatalog();
  try {
    // shell permission must fail the scan
    const manifestPath = join(root, 'skills', FIXTURE.id, '1.0.0', 'skillflux.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.permissions.shell = true;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    await assert.rejects(() => buildCatalogIndex(root), /contentHash does not match|AUTOMATED_SCAN_FAILED|shell permission/);
    // Restore the binding by recomputing the review contentHash; now the permission scan must fail.
    const files: Record<string, string> = { 'SKILL.md': await readFile(join(root, 'skills', FIXTURE.id, '1.0.0', 'SKILL.md'), 'utf8') };
    const contentHash = createHash('sha256').update(canonical({ manifest, files })).digest('hex');
    const reviewPath = join(root, 'skills', FIXTURE.id, '1.0.0', 'skillflux.review.json');
    const review = JSON.parse(await readFile(reviewPath, 'utf8'));
    review.evaluation.contentHash = contentHash;
    await writeFile(reviewPath, JSON.stringify(review, null, 2));
    await assert.rejects(() => buildCatalogIndex(root), /failed automated checks: shell permission/);
    const check = await checkCatalogIndex(root).catch(error => ({ ok: false, reason: error.message }));
    assert.equal(check.ok, false, 'unsafe catalog must fail --check');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
