import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, type TestContext } from 'node:test';
import { bundleDigest, canonical, sha256, signPayload, type Bundle, type QualificationProof, type Signed, type Submission } from '../src/shared.js';
import { RegistryStore } from '../src/registry/database.js';
import { createRegistryServer } from '../src/registry/server.js';
import { loadOrCreateRegistryKeys } from '../src/registry/crypto.js';
import { initializeProject } from '../src/runtime/project.js';
import { SkillFluxRuntime } from '../src/runtime/runtime.js';
import { QUALIFICATION_FILE } from '../src/runtime/qualification.js';
import { verifyBundleEnvelope } from '../src/runtime/validation.js';
import { makeLegacyFixture, recordSyntheticEvaluation } from './registry-fixture.js';

const token = 'synthetic-legacy-runtime-fixture-token';

async function legacyFixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'skillflux-legacy-proof-'));
  const dataDir = join(directory, 'registry');
  const store = await RegistryStore.open(dataDir);
  const seeds = JSON.parse(await readFile(new URL('../catalog/seed.json', import.meta.url), 'utf8')) as Submission[];
  const submission = structuredClone(seeds.find(item => item.id === 'code-review')!);
  delete submission.release;
  const original = makeLegacyFixture(store, submission);
  const originalBytes = canonical(store.getSkill(original.id, original.version)!.bundle);
  const next = { ...structuredClone(submission), version: '1.1.0' };
  next.files['SKILL.md'] += '\nSynthetic second legacy version.\n';
  const other = makeLegacyFixture(store, next);
  const server = await createRegistryServer({ dataDir, dev: false, adminToken: token });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const registry = `http://127.0.0.1:${address.port}`;
  const project = join(directory, 'project');
  await mkdir(project);
  await initializeProject({ projectRoot: project, registry, host: 'generic', cliPath: process.execPath, preauthorizeReviewedText: true });
  const runtime = await SkillFluxRuntime.open(project);
  t.after(async () => { if (server.listening) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } store.close(); await rm(directory, { recursive: true, force: true }); });
  const review = async (version: string, action: 'approve' | 'revoke') => {
    const response = await fetch(`${registry}/v1/admin/skills/code-review/${version}/review`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ action, reviewer: 'Synthetic test actor', notes: 'Synthetic test fixture; not a real manual evaluation.' }) });
    assert.equal(response.status, 200, await response.clone().text());
  };
  const qualify = async (version: string) => { await recordSyntheticEvaluation(registry, token, 'code-review', version); await review(version, 'approve'); };
  return { runtime, registry, server, store, dataDir, original, originalBytes, other, review, qualify };
}

test('historical approved package needs supplementary evidence, then same version and digest install through a signed external proof', async t => {
  const f = await legacyFixture(t);
  await assert.rejects(f.runtime.createPlan('code-review', { version: '1.0.0' }), /not found/i);
  const before = await f.runtime.client.getQualification(f.original.digest);
  assert.equal(before.payload.qualification, 'needs-testing');
  await recordSyntheticEvaluation(f.registry, token, 'code-review', '1.0.0');
  await assert.rejects(f.runtime.createPlan('code-review', { version: '1.0.0' }), /not found/i);
  await f.review('1.0.0', 'approve');
  assert.equal(f.store.getSkill('code-review', '1.0.0')!.summary.digest, f.original.digest);
  assert.equal(canonical(f.store.getSkill('code-review', '1.0.0')!.bundle), f.originalBytes);
  assert.equal(f.store.getSkill('code-review', '1.0.0')!.bundle.manifest.quality.evaluation, undefined);
  await f.runtime.installPlan((await f.runtime.createPlan('code-review', { version: '1.0.0' })).id);
  const loaded = await f.runtime.load('code-review', [], false);
  assert.equal(loaded.skill.digest, f.original.digest);
  assert.equal(loaded.manifest.quality.evaluation, undefined);
  const metadata = join(f.runtime.paths.skills, 'code-review', '1.0.0', QUALIFICATION_FILE);
  const originalProof = await readFile(metadata, 'utf8');
  const edited = JSON.parse(originalProof) as Signed<QualificationProof>;
  edited.payload.evaluation!.summary = 'Tampered claim';
  await writeFile(metadata, JSON.stringify(edited));
  await assert.rejects(f.runtime.load('code-review', [], false), /signature/i);
  await assert.rejects(f.runtime.installPlan((await f.runtime.createPlan('code-review', { version: '1.0.0' })).id), /signature/i);
  await writeFile(metadata, originalProof);
  await f.qualify('1.1.0');
  const crossVersion = await f.runtime.client.getQualification(f.other.digest);
  await writeFile(metadata, JSON.stringify(crossVersion));
  await assert.rejects(f.runtime.load('code-review', [], false), /exact skill version|bound/i);
  await writeFile(metadata, originalProof);
  await f.review('1.0.0', 'revoke');
  await assert.rejects(f.runtime.load('code-review', [], false), /revoked/i);
});

test('offline legacy loading uses only previously verified proof and discloses proof freshness; missing proof is rejected', async t => {
  const f = await legacyFixture(t);
  await f.qualify('1.0.0');
  await f.runtime.installPlan((await f.runtime.createPlan('code-review', { version: '1.0.0' })).id);
  await f.runtime.load('code-review', [], false);
  f.server.closeAllConnections();
  await new Promise<void>(resolve => f.server.close(() => resolve()));
  const loaded = await f.runtime.load('code-review', [], false);
  assert.equal(loaded.skill.digest, f.original.digest);
  assert.match(loaded.warnings.join(' '), /Offline qualification.*current cloud qualification is unknown/);
  await rm(join(f.runtime.paths.skills, 'code-review', '1.0.0', QUALIFICATION_FILE));
  await assert.rejects(f.runtime.load('code-review', [], false), /qualification metadata is missing/i);
  await assert.rejects(f.runtime.createPlan('code-review', { version: '1.0.0' }), /failed|unavailable/i);
});

test('qualification proof metadata cannot be supplied as a signed package file', async t => {
  const f = await legacyFixture(t);
  const keys = await loadOrCreateRegistryKeys(f.dataDir);
  const bundle: Bundle = structuredClone(f.store.getSkill('code-review', '1.0.0')!.bundle);
  bundle.files[QUALIFICATION_FILE] = '{}';
  bundle.manifest.files.push({ path: QUALIFICATION_FILE, sha256: sha256('{}'), size: 2 });
  assert.throws(() => verifyBundleEnvelope(signPayload(bundle, keys.privateKey, keys.keyId), keys, { digest: bundleDigest(bundle), integrityOnly: true }), /reserved bundle path/i);
});

test('a signed loss of qualification replaces the old cached grant and blocks a later offline load', async t => {
  const f = await legacyFixture(t);
  await f.qualify('1.0.0');
  await f.runtime.installPlan((await f.runtime.createPlan('code-review', { version: '1.0.0' })).id);
  // Isolated database fixture simulates the authority withdrawing a content assessment.
  f.store.database.prepare('UPDATE evaluations SET final_digest = NULL WHERE skill_id = ? AND version = ?').run('code-review', '1.0.0');
  await assert.rejects(f.runtime.load('code-review', [], false), /current passing qualification/i);
  const path = join(f.runtime.paths.skills, 'code-review', '1.0.0', QUALIFICATION_FILE);
  assert.equal((JSON.parse(await readFile(path, 'utf8')) as Signed<QualificationProof>).payload.qualification, 'needs-testing');
  f.store.database.prepare('UPDATE evaluations SET final_digest = ? WHERE skill_id = ? AND version = ?').run(f.original.digest, 'code-review', '1.0.0');
  assert.equal((await f.runtime.load('code-review', [], false)).skill.digest, f.original.digest, 'A legitimate new signed grant may restore the same package');
  f.store.database.prepare('UPDATE evaluations SET final_digest = NULL WHERE skill_id = ? AND version = ?').run('code-review', '1.0.0');
  await assert.rejects(f.runtime.load('code-review', [], false), /current passing qualification/i);
  f.server.closeAllConnections();
  await new Promise<void>(resolve => f.server.close(() => resolve()));
  await assert.rejects(f.runtime.load('code-review', [], false), /current passing qualification/i);
});

test('rollback of a legacy package rechecks both local proof integrity and current cloud qualification', async t => {
  const f = await legacyFixture(t);
  await f.qualify('1.0.0');
  await f.qualify('1.1.0');
  await f.runtime.installPlan((await f.runtime.createPlan('code-review', { version: '1.0.0' })).id);
  await f.runtime.installUpdatePlan((await f.runtime.createPlan('code-review', { version: '1.1.0' })).id);
  const path = join(f.runtime.paths.skills, 'code-review', '1.0.0', QUALIFICATION_FILE);
  const original = await readFile(path, 'utf8');
  const tampered = JSON.parse(original) as Signed<QualificationProof>;
  tampered.payload.evaluation!.summary = 'Modified local proof';
  await writeFile(path, JSON.stringify(tampered));
  await assert.rejects(f.runtime.rollback('code-review'), /signature/i);
  assert.equal((await f.runtime.list()).skills[0].version, '1.1.0');
  await writeFile(path, original);
  f.store.database.prepare('UPDATE evaluations SET final_digest = NULL WHERE skill_id = ? AND version = ?').run('code-review', '1.0.0');
  await assert.rejects(f.runtime.rollback('code-review'), /current passing qualification/i);
  assert.equal((await f.runtime.list()).skills[0].version, '1.1.0');
  f.store.database.prepare('UPDATE evaluations SET final_digest = ? WHERE skill_id = ? AND version = ?').run(f.original.digest, 'code-review', '1.0.0');
  await f.runtime.rollback('code-review');
  assert.equal((await f.runtime.list()).skills[0].digest, f.original.digest);
});
