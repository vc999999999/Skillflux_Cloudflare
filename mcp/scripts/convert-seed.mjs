// Converts mcp/catalog/seed.json (Submission[]) into a skillflux-catalog directory layout:
//   <output>/skills/<id>/<version>/{skillflux.json, skillflux.review.json, content files}
// and generates index.json via the same catalog builder used in production.
//
// Seed entries carry no review evidence, so the generated review sidecars are marked
// kind: 'simulation' with needs-testing status — matching the rule that development
// seeds never qualify for real publication. Adjust sidecars by hand for real releases.
//
// Usage: node scripts/convert-seed.mjs <output-directory> [--index]
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(readFileSync(join(root, 'catalog', 'seed.json'), 'utf8'));
const output = resolve(process.argv[2] ?? 'skillflux-catalog');
const withIndex = process.argv.includes('--index');

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  throw new Error('Unsupported value in canonical JSON');
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

await rm(output, { recursive: true, force: true });
let count = 0;
for (const submission of seed) {
  const dir = join(output, 'skills', submission.category, submission.id, submission.version);
  await mkdir(dir, { recursive: true });
  const { files: _files, ...manifestFields } = submission;
  const manifest = { schema: 'skillflux/v1', ...manifestFields, createdAt: submission.release?.maintainedAt ?? new Date().toISOString() };
  // contentHash covers declarative manifest + content files (no quality fields involved).
  const contentHash = sha256(canonical({ manifest, files: submission.files }));
  const review = {
    status: 'needs-testing',
    reviewer: 'seed-conversion',
    reviewedAt: new Date().toISOString(),
    notes: 'Development seed entry converted from mcp/catalog/seed.json. kind:simulation evidence cannot qualify for publication.',
    evaluation: {
      contentHash,
      tester: 'seed-conversion',
      testedAt: new Date().toISOString(),
      environment: 'local fixture',
      kind: 'simulation',
      purpose: { input: 'placeholder', expected: 'placeholder', actual: 'placeholder', passed: false },
      boundary: { input: 'placeholder', expected: 'placeholder', actual: 'placeholder', passed: false },
      hostChecks: submission.hosts.map(host => ({ host, installed: false, read: false, notes: 'not tested' })),
      publicSummary: 'Development seed; no real evaluation.',
    },
  };
  await writeFile(join(dir, 'skillflux.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(dir, 'skillflux.review.json'), `${JSON.stringify(review, null, 2)}\n`);
  for (const [path, content] of Object.entries(submission.files)) {
    const target = join(dir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  count += 1;
}
console.log(`Converted ${count} seed skills into ${output}`);

if (withIndex) {
  const { buildCatalogIndex } = await import(join(root, 'dist', 'catalog', 'build.js'));
  const result = await buildCatalogIndex(output);
  console.log(`index.json written to ${result.output} (${result.index.skills.length} entries, ${result.warnings.length} warnings)`);
}
