import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';
import { RegistryStore } from '../src/registry/database.js';
import { createRegistryServer } from '../src/registry/server.js';
import { backupRegistry, checkRegistryBackup, restoreRegistryBackup } from '../src/registry/maintenance.js';
import { scanSubmission } from '../src/registry/scan.js';
import { bundleDigest, contentHash, sha256, verifyPayload } from '../src/shared.js';
import type { AdDecision, Campaign, CampaignInput, PublicKeyInfo, Signed, Submission } from '../src/shared.js';
import { makeLegacyFixture, publishSyntheticFixture, recordSyntheticEvaluation, syntheticEvaluation, syntheticRelease } from './registry-fixture.js';

const token = 'isolated-ops-test-operator-token';
const submission = (id: string, version = '1.0.0'): Submission => ({ id, version, name: id, description: 'Synthetic fixture', category: 'development', tags: [], hosts: ['codex', 'claude'], publisher: 'Synthetic test', license: 'MIT', entry: 'SKILL.md', permissions: { network: [], shell: false, secrets: [] }, dependencies: [], files: { 'SKILL.md': '# Synthetic fixture\nFollow the requested task.', 'references/example.md': 'Synthetic resource body' }, release: syntheticRelease });
async function setup(t: TestContext, dev = false) {
  const dataDir = await mkdtemp(join(tmpdir(), 'skillflux-ops-'));
  const server = await createRegistryServer({ dataDir, adminToken: token, dev, ...(dev ? { seedPath: fileURLToPath(new URL('../catalog/seed.json', import.meta.url)) } : {}) });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const store = await RegistryStore.open(dataDir);
  t.after(async () => { store.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(dataDir, { recursive: true, force: true }); });
  const api = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', admin = true) => fetch(base + path, { method, headers: { ...(admin ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { base, store, api, dataDir };
}
function campaignInput(now = Date.now()): CampaignInput { return { name: '=HYPERLINK("malicious")', sponsor: 'Synthetic sponsor', text: 'Synthetic advertising creative', url: 'https://sponsor.example/original', categories: ['development'], active: true, budgetCents: 1000, cpcCents: 25, dailyCap: 100, startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 3600_000).toISOString() }; }
function storeDecision(store: RegistryStore, campaign: Campaign, requestId: string, at = new Date().toISOString()) {
  const decision: AdDecision = { decisionId: requestId, campaignId: campaign.id, creativeId: campaign.id, disclosure: '广告', text: campaign.text, url: 'https://registry.example/r/token', expiresAt: new Date(Date.parse(at) + 600_000).toISOString(), token: requestId, house: false };
  return store.storeDecision({ decision, signed: { payload: decision }, requestId, requestHash: sha256(requestId), targetUrl: campaign.url, campaign, createdAt: at });
}

test('development seeds and historical approvals cannot appear as tested publications', async t => {
  const { api, store } = await setup(t, true);
  assert.equal(store.listSkills().length, 9);
  assert.ok(store.listSkills().every(record => record.summary.status === 'pending'));
  const record = store.listSkills()[0]!;
  store.database.prepare("UPDATE skills SET status = 'approved' WHERE id = ? AND version = ?").run(record.summary.id, record.summary.version);
  assert.equal(store.listApproved().length, 0);
  assert.equal((await api(`/v1/skills/${record.summary.id}`)).status, 404);
  assert.equal((await api(`/v1/bundles/${record.summary.digest}`)).status, 404);
  assert.equal((await api(`/v1/skills/${record.summary.id}/resources?path=SKILL.md`)).status, 404);
  const versions = await (await api(`/v1/skills/${record.summary.id}/versions`)).json();
  assert.equal(versions.items[0].qualification, 'needs-testing');
  assert.equal(versions.items[0].content, undefined);
  assert.equal((await api(`/v1/skills/${store.listSkills()[1]!.summary.id}/versions`)).status, 404);
});

test('human release gate binds content, checks all hosts, rejects simulations and hides private evidence', async t => {
  const { api, store, base } = await setup(t);
  const skill = submission('human-gate');
  assert.equal((await api('/v1/admin/skills', { ...skill, release: undefined })).status, 422);
  assert.equal((await api('/v1/admin/skills', skill)).status, 201);
  const current = store.getSkill(skill.id, skill.version)!;
  const review = () => api(`/v1/admin/skills/${skill.id}/${skill.version}/review`, { action: 'approve', reviewer: 'private-reviewer@example.test', notes: 'PRIVATE APPROVAL NOTES' });
  assert.equal((await review()).status, 409);
  const evaluation = syntheticEvaluation(contentHash(current.bundle), skill.hosts);
  const add = (body: unknown) => api(`/v1/admin/skills/${skill.id}/${skill.version}/evaluations`, body);
  assert.equal((await add({ ...evaluation, contentHash: '0'.repeat(64) })).status, 409);
  assert.equal((await add({ ...evaluation, kind: 'simulation' })).status, 201);
  assert.equal((await review()).status, 409);
  assert.equal((await add({ ...evaluation, hostChecks: evaluation.hostChecks.slice(0, 1) })).status, 201);
  assert.equal((await review()).status, 409);
  assert.equal((await add({ ...evaluation, boundary: { ...evaluation.boundary, passed: false } })).status, 201);
  assert.equal((await review()).status, 409);
  assert.equal((await add({ ...evaluation, environment: 'PRIVATE environment path /Users/person', purpose: { ...evaluation.purpose, actual: 'PRIVATE RAW OUTPUT' }, publicSummary: 'Public sanitized test summary' })).status, 201);
  assert.equal((await review()).status, 200);
  const approved = store.getSkill(skill.id, skill.version)!;
  assert.notEqual(current.summary.digest, approved.summary.digest);
  assert.equal(contentHash(current.bundle), contentHash(approved.bundle));
  assert.equal(bundleDigest(approved.bundle), approved.summary.digest);
  assert.ok(store.evaluations(skill.id, skill.version).some(item => item.finalDigest === approved.summary.digest));
  const publishedText = await (await api('/v1/publication')).text();
  assert.ok(publishedText.includes('Public sanitized test summary'));
  assert.ok(!publishedText.includes('PRIVATE'));
  assert.ok(!publishedText.includes('private-reviewer'));
  assert.equal((await add(evaluation)).status, 409);
  const resource = await (await api(`/v1/skills/${skill.id}/resources?path=references%2Fexample.md`)).json();
  assert.equal(resource.content, skill.files['references/example.md']);
  assert.equal(resource.sha256, sha256(resource.content));
  assert.equal((await api(`/v1/skills/${skill.id}/resources?path=..%2Fsecret`)).status, 404);
  const unreviewed = submission('pending-private');
  await api('/v1/admin/skills', unreviewed);
  for (const path of [`/v1/skills/${unreviewed.id}`, `/v1/skills/${unreviewed.id}/versions`, `/v1/skills/${unreviewed.id}/resources?path=SKILL.md`]) assert.equal((await fetch(base + path)).status, 404);
});

test('a historical approved package regains qualification through separately signed evidence without changing a single package byte', async t => {
  const { api, store, base } = await setup(t);
  const skill = submission('legacy-retest'); delete skill.release;
  const legacy = makeLegacyFixture(store, skill);
  const original = store.database.prepare('SELECT bundle_json, digest, size, created_at FROM skills WHERE id=? AND version=?').get(skill.id, skill.version);
  const key = await (await api('/v1/keys')).json() as PublicKeyInfo;
  const before = verifyPayload(await (await api(`/v1/qualifications/${legacy.digest}`)).json(), key) as any;
  assert.equal(before.qualification, 'needs-testing'); assert.equal(before.evaluation, undefined);
  assert.equal((await api(`/v1/bundles/${legacy.digest}`)).status, 404);
  await recordSyntheticEvaluation(base, token, skill.id, skill.version);
  assert.equal((verifyPayload(await (await api(`/v1/qualifications/${legacy.digest}`)).json(), key) as any).qualification, 'needs-testing');
  const approved = await api(`/v1/admin/skills/${skill.id}/${skill.version}/review`, { action: 'approve', reviewer: 'PRIVATE new evaluator', notes: 'PRIVATE extra notes' });
  assert.equal(approved.status, 200);
  assert.deepEqual(store.database.prepare('SELECT bundle_json, digest, size, created_at FROM skills WHERE id=? AND version=?').get(skill.id, skill.version), original);
  const proof = verifyPayload(await (await api(`/v1/qualifications/${legacy.digest}`)).json(), key) as any;
  assert.equal(proof.qualification, 'qualified'); assert.equal(proof.digest, legacy.digest); assert.equal(proof.contentHash, contentHash(store.getSkill(skill.id, skill.version)!.bundle));
  assert.equal(proof.evaluation.purposePassed, true); assert.deepEqual(proof.evaluation.hosts, skill.hosts);
  const bundle = verifyPayload(await (await api(`/v1/bundles/${legacy.digest}`)).json(), key) as any;
  assert.equal(bundleDigest(bundle), legacy.digest); assert.equal(bundle.manifest.quality.evaluation, undefined);
  const publication = verifyPayload(await (await api('/v1/publication')).json(), key) as any;
  assert.equal(publication.items[0].skill.quality.evaluation.evaluationId, proof.evaluation.evaluationId);
  assert.equal(publication.items[0].bundle.manifest.quality.evaluation, undefined);
  assert.ok(!JSON.stringify(publication).includes('PRIVATE'));
  const revision = publication.revision;
  await api(`/v1/admin/skills/${skill.id}/${skill.version}/review`, { action: 'revoke', reviewer: 'Operator', notes: 'Public revocation reason' });
  assert.equal((verifyPayload(await (await api(`/v1/qualifications/${legacy.digest}`)).json(), key) as any).qualification, 'revoked');
  assert.notEqual((verifyPayload(await (await api('/v1/publication')).json(), key) as any).revision, revision);
});

test('fixed dependencies need qualification; recursive revocations hide all content and signed pages change revision', async t => {
  const { api, store, base } = await setup(t);
  const root = await publishSyntheticFixture(base, token, submission('base-skill'));
  const middle = submission('middle-skill'); middle.dependencies = [{ id: root.id, version: root.version }];
  await publishSyntheticFixture(base, token, middle);
  const leaf = submission('leaf-skill'); leaf.dependencies = [{ id: middle.id, version: middle.version }];
  await publishSyntheticFixture(base, token, leaf);
  await publishSyntheticFixture(base, token, submission('base-skill', '1.0.1-rc.1'));
  await publishSyntheticFixture(base, token, submission('base-skill', '1.0.1'));
  assert.equal(store.getPublicSkill('base-skill').record?.summary.version, '1.0.1');
  const key = await (await api('/v1/keys')).json() as PublicKeyInfo;
  const page1 = verifyPayload(await (await api('/v1/publication?limit=1')).json(), key) as any;
  const page2 = verifyPayload(await (await api('/v1/publication?limit=1&offset=1')).json(), key) as any;
  assert.equal(page1.revision, page2.revision); assert.equal(page1.total, 5);
  assert.notEqual(page1.items[0].skill.digest, page2.items[0].skill.digest);
  assert.equal((await api('/v1/publication?limit=11')).status, 400);
  await api('/v1/admin/skills/base-skill/1.0.0/review', { action: 'revoke', reviewer: 'Operator', notes: 'Dependency unsafe' });
  assert.equal(store.getSkill('middle-skill', '1.0.0')!.summary.status, 'revoked');
  assert.equal(store.getSkill('leaf-skill', '1.0.0')!.summary.status, 'revoked');
  const after = verifyPayload(await (await api('/v1/publication')).json(), key) as any;
  assert.notEqual(after.revision, page1.revision);
  assert.equal(after.total, 2);
  const statuses = verifyPayload(await (await api('/v1/publication/statuses')).json(), key) as any;
  assert.equal(statuses.revision, after.revision);
  assert.equal(statuses.items.filter((item: any) => item.qualification === 'revoked').length, 3);
  assert.ok(!JSON.stringify(statuses).includes('Synthetic resource body'));
  const dependencyBlocked = submission('blocked-dependent'); dependencyBlocked.dependencies = [{ id: root.id, version: root.version }];
  store.submitSkill(dependencyBlocked, scanSubmission(dependencyBlocked));
  assert.throws(() => store.reviewSkill(dependencyBlocked.id, dependencyBlocked.version, 'approve', 'Operator', 'Reason'), /not approved/);
});

test('ads suppress unknown and sensitive context, preview never creates a decision, and pause permanently releases reservations', async t => {
  const { api, store } = await setup(t);
  const campaign = store.createCampaign(campaignInput());
  const ad = (requestId: string, extra: object = {}) => api('/v1/ads/decision', { category: 'development', requestId, ...extra }, 'POST', false);
  assert.equal((await ad('unknown-context')).status, 422);
  assert.equal((await ad('sensitive-context', { context: 'sensitive' })).status, 422);
  assert.equal((await ad('medical-context', { context: 'normal', category: 'medical' })).status, 422);
  assert.equal((await api(`/v1/admin/campaigns/${campaign.id}/preview`, undefined, 'GET', false)).status, 401);
  for (let i = 0; i < 3; i++) assert.equal((await api(`/v1/admin/campaigns/${campaign.id}/preview`)).status, 200);
  assert.equal(store.metrics().decisions, 0);
  assert.equal((await ad('preview-context', { context: 'normal', placement: 'web-preview' })).status, 422);
  const signed = await (await ad('paid-context-1', { context: 'normal' })).json() as Signed<AdDecision>;
  assert.equal(store.getCampaign(campaign.id)!.reservedCents, 25);
  const second = await (await ad('paid-context-2', { context: 'normal' })).json() as Signed<AdDecision>;
  assert.equal(second.payload.house, false);
  assert.equal((await api(`/v1/admin/campaigns/${campaign.id}`, { budgetCents: 25 }, 'PATCH')).status, 409);
  assert.equal((await api(`/v1/admin/campaigns/${campaign.id}`, { active: false, budgetCents: 0 }, 'PATCH')).status, 200);
  assert.equal(store.getCampaign(campaign.id)!.reservedCents, 0);
  await api(`/v1/admin/campaigns/${campaign.id}`, { active: true, budgetCents: 1000 }, 'PATCH');
  assert.equal((await fetch(signed.payload.url, { redirect: 'manual' })).status, 410);
  assert.equal((await ad('paid-context-1', { context: 'normal' })).status, 410);
  assert.equal(store.metrics().spentCents, 0);
});

test('UTC paid-decision cap is rechecked transactionally and natural expiry preserves frozen price and destination', async t => {
  const { store } = await setup(t);
  const now = Date.now();
  const campaign = store.createCampaign({ ...campaignInput(now), dailyCap: 1 });
  // Both request handlers can select the same candidate before the first transaction commits.
  const candidate1 = store.listEligibleCampaigns('development', new Set())[0]!;
  const candidate2 = store.listEligibleCampaigns('development', new Set())[0]!;
  storeDecision(store, candidate1, 'cap-decision-one');
  assert.throws(() => storeDecision(store, candidate2, 'cap-decision-two'), /daily decision cap/);
  assert.equal(store.metrics().decisions, 1);
  assert.equal(store.getCampaign(campaign.id)!.reservedCents, 25);
  store.updateCampaign(campaign.id, { ...campaignInput(now), dailyCap: 1, cpcCents: 75, url: 'https://sponsor.example/changed', endsAt: new Date(now + 1000).toISOString() });
  const clicked = store.consumeClick(sha256('cap-decision-one'), new Date(now + 2000).toISOString());
  assert.equal(clicked.url, 'https://sponsor.example/original');
  assert.equal(store.metrics().spentCents, 25);
  assert.throws(() => store.consumeClick(sha256('cap-decision-one'), new Date(now + 3000).toISOString()), /already been used/);
  assert.equal(store.metrics().clicks, 1);
  assert.equal(store.getCampaign(campaign.id)!.reservedCents, 0);
  const midnight = '2026-07-01T23:59:59.000Z';
  const utc = store.createCampaign({ ...campaignInput(), startsAt: '2026-07-01T00:00:00.000Z', endsAt: '2026-07-04T00:00:00.000Z', dailyCap: 1 });
  storeDecision(store, utc, 'utc-day-one', midnight);
  storeDecision(store, utc, 'utc-day-two', '2026-07-02T00:00:01.000Z');
  assert.equal(store.getCampaign(utc.id)!.reservedCents, 50);
});

test('public inquiries validate consent, deduplicate, authorize operators and purge PII exactly after retention', async t => {
  const { api, store } = await setup(t);
  const input = { requestId: 'inquiry-test-1', name: 'Private Person', contact: 'private@example.test', company: 'Example', product: 'Example product', website: 'https://example.test', message: 'Private requirements', consent: true };
  assert.equal((await api('/v1/inquiries', { ...input, consent: false }, 'POST', false)).status, 422);
  const first = await (await api('/v1/inquiries', input, 'POST', false)).json();
  assert.equal(first.accepted, true); assert.equal(first.duplicate, false);
  const duplicate = await (await api('/v1/inquiries', input, 'POST', false)).json(); assert.equal(duplicate.id, first.id); assert.equal(duplicate.duplicate, true);
  assert.equal((await api('/v1/inquiries', { ...input, message: 'Other' }, 'POST', false)).status, 409);
  assert.equal((await api('/v1/admin/inquiries', undefined, 'GET', false)).status, 401);
  assert.equal((await api(`/v1/admin/inquiries/${first.id}`, { status: 'completed', operator: 'Test operator', notes: 'Private resolution' }, 'PATCH')).status, 200);
  const completed = store.listInquiries()[0]!;
  assert.equal(store.purgeInquiryPII(new Date(Date.parse(completed.closedAt!) + 180 * 86_400_000 - 1).toISOString()), 0);
  assert.equal(store.purgeInquiryPII(new Date(Date.parse(completed.closedAt!) + 180 * 86_400_000).toISOString()), 1);
  const purged = store.listInquiries()[0]!; assert.equal(purged.contact, ''); assert.equal(purged.name, ''); assert.equal(purged.message, ''); assert.equal(purged.notes, '');
  assert.equal((await api(`/v1/admin/inquiries/${first.id}`, { status: 'new', operator: 'Test operator', notes: 'Reopen' }, 'PATCH')).status, 409);
  assert.ok(store.auditItems().some(item => item.action === 'inquiry.pii_purged'));
  const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => api('/v1/inquiries', { ...input, requestId: `inquiry-rate-${index}` }, 'POST', false)));
  assert.ok(responses.some(response => response.status === 429));
});

test('reports support authenticated case detail and atomic pause; metrics use event dates and CSV escapes formulas', async t => {
  const { api, store } = await setup(t);
  const campaign = store.createCampaign(campaignInput());
  const day = new Date().toISOString().slice(0, 10);
  storeDecision(store, campaign, 'reported-decision-1');
  storeDecision(store, campaign, 'reported-decision-2');
  store.recordEvent({ decisionId: 'reported-decision-1', tokenHash: sha256('reported-decision-1'), eventId: 'ops-impression-1', type: 'impression' });
  store.recordEvent({ decisionId: 'reported-decision-1', tokenHash: sha256('reported-decision-1'), eventId: 'ops-impression-2', type: 'impression' });
  store.consumeClick(sha256('reported-decision-1'));
  const reportInput = { requestId: 'public-report-1', campaignId: campaign.id, reason: 'Misleading landing page' };
  const report = await (await api('/v1/reports', reportInput, 'POST', false)).json();
  assert.equal((await (await api('/v1/reports', reportInput, 'POST', false)).json()).duplicate, true);
  assert.equal((await api(`/v1/admin/reports/${report.id}`, undefined, 'GET', false)).status, 401);
  assert.equal((await (await api(`/v1/admin/reports/${report.id}`)).json()).report.campaign.id, campaign.id);
  await api(`/v1/admin/reports/${report.id}`, { action: 'pause', operator: 'Test operator', notes: 'Reviewed report evidence' }, 'PATCH');
  assert.equal(store.getCampaign(campaign.id)!.active, false); assert.equal(store.getCampaign(campaign.id)!.reservedCents, 0);
  assert.throws(() => store.consumeClick(sha256('reported-decision-2')), /permanently invalidated/);
  const metrics = await (await api(`/v1/admin/metrics?from=${day}&to=${day}&campaignId=${campaign.id}&groupBy=campaign`)).json();
  assert.equal(metrics.decisions, 2); assert.equal(metrics.impressions, 1); assert.equal(metrics.clicks, 1); assert.equal(metrics.spentCents, 25); assert.equal(metrics.reports, 1);
  const csv = await (await api(`/v1/admin/metrics.csv?from=${day}&to=${day}`)).text();
  assert.ok(csv.includes(`"'=HYPERLINK(""malicious"")"`));
  assert.equal((await api('/v1/admin/metrics?from=2026-02-30&to=2026-03-01')).status, 400);
  assert.equal((await api('/v1/admin/campaigns?limit=101')).status, 400);
  const filtered = await (await api('/v1/admin/campaigns?q=HYPERLINK&status=paused&limit=1')).json(); assert.equal(filtered.total, 1);
  assert.ok(store.auditItems().some(item => item.action === 'campaign.paused_by_report'));
});

test('signed online WAL backups restore packages, evaluations, ledger and the original trust key without overwriting destinations', async t => {
  const { api, store, base, dataDir } = await setup(t);
  const skill = await publishSyntheticFixture(base, token, submission('backup-skill'));
  const campaign = store.createCampaign(campaignInput());
  storeDecision(store, campaign, 'backup-paid-click');
  store.consumeClick(sha256('backup-paid-click'));
  storeDecision(store, campaign, 'backup-pending-click');
  const key = await (await api('/v1/keys')).json() as PublicKeyInfo;
  const snapshotPath = join(dataDir, 'consistent-backup');
  const checked = await backupRegistry(dataDir, snapshotPath);
  assert.equal(checked.keyId, key.keyId); assert.equal(checked.schemaVersion, 2);
  assert.equal((await checkRegistryBackup(snapshotPath, key.keyId)).valid, true);
  await assert.rejects(checkRegistryBackup(snapshotPath, 'ed25519:wrong-identity'), /expected registry key/);
  await assert.rejects(backupRegistry(dataDir, snapshotPath), /EEXIST/);
  // Data committed after the backup must not leak into the consistent snapshot.
  store.createCampaign({ ...campaignInput(), name: 'After snapshot' });
  const restoredDir = join(dataDir, 'restored-registry');
  await restoreRegistryBackup(snapshotPath, restoredDir, key.keyId);
  await assert.rejects(restoreRegistryBackup(snapshotPath, restoredDir, key.keyId), /EEXIST/);
  const restoredStore = await RegistryStore.open(restoredDir);
  const restoredServer = await createRegistryServer({ dataDir: restoredDir, adminToken: token });
  await new Promise<void>(resolve => restoredServer.listen(0, '127.0.0.1', resolve));
  const restoredBase = `http://127.0.0.1:${(restoredServer.address() as AddressInfo).port}`;
  try {
    assert.equal(restoredStore.metrics().campaigns, 1); assert.equal(restoredStore.metrics().clicks, 1); assert.equal(restoredStore.metrics().spentCents, 25);
    assert.equal(restoredStore.getCampaign(campaign.id)!.reservedCents, 25);
    assert.equal(restoredStore.getPublicSkill(skill.id, skill.version).record!.summary.digest, skill.digest);
    const restoredKey = await (await fetch(`${restoredBase}/v1/keys`)).json() as PublicKeyInfo;
    assert.deepEqual(restoredKey, key);
    const bundle = verifyPayload(await (await fetch(`${restoredBase}/v1/bundles/${skill.digest}`)).json(), key) as any;
    assert.equal(bundleDigest(bundle), skill.digest);
    const proof = verifyPayload(await (await fetch(`${restoredBase}/v1/qualifications/${skill.digest}`)).json(), key) as any;
    assert.equal(proof.qualification, 'qualified');
    restoredStore.consumeClick(sha256('backup-pending-click'));
    assert.equal(restoredStore.metrics().spentCents, 50);
  } finally {
    restoredStore.close();
    await new Promise<void>(resolve => restoredServer.close(() => resolve()));
  }
  await appendFile(join(snapshotPath, 'registry.sqlite'), 'tampered bytes');
  await assert.rejects(checkRegistryBackup(snapshotPath, key.keyId), /integrity mismatch/);
});

test('migration is repeatable, preserves historic bytes and refuses a database from a newer server', async t => {
  const { dataDir, store } = await setup(t);
  const legacy = makeLegacyFixture(store, submission('migration-legacy'));
  const before = store.getSkill(legacy.id, legacy.version)!.bundle;
  store.database.exec('DROP TABLE evaluations; DROP TABLE inquiries; DROP TABLE ad_reports; ALTER TABLE ad_decisions DROP COLUMN invalidated_at; PRAGMA user_version = 1;');
  const migrated = await RegistryStore.open(dataDir);
  try {
    assert.deepEqual(migrated.getSkill(legacy.id, legacy.version)!.bundle, before);
    assert.equal(migrated.getSkill(legacy.id, legacy.version)!.summary.digest, legacy.digest);
    assert.equal(migrated.qualificationProof(legacy.digest)!.qualification, 'needs-testing');
    assert.equal((migrated.database.prepare('PRAGMA user_version').get() as any).user_version, 2);
  } finally { migrated.close(); }
  const repeated = await RegistryStore.open(dataDir); repeated.close();
  store.database.exec('PRAGMA user_version = 99');
  await assert.rejects(RegistryStore.open(dataDir), /newer than this server/);
});

test('the latest human failure blocks approval even when an older human record passed; simulations and undeclared hosts cannot mask it', async t => {
  const { api, store } = await setup(t);
  const skill = submission('latest-human-result');
  await api('/v1/admin/skills', skill);
  const record = store.getSkill(skill.id, skill.version)!;
  const passing = syntheticEvaluation(contentHash(record.bundle), skill.hosts);
  const add = (value: unknown) => api(`/v1/admin/skills/${skill.id}/${skill.version}/evaluations`, value);
  assert.equal((await add(passing)).status, 201);
  assert.equal((await add({ ...passing, boundary: { ...passing.boundary, passed: false, actual: 'Observed genuine boundary failure' } })).status, 201);
  assert.equal((await add({ ...passing, kind: 'simulation' })).status, 201);
  assert.equal((await add({ ...passing, hostChecks: [...passing.hostChecks, { host: 'cursor', installed: true, read: true, notes: 'Undeclared compatibility claim' }] })).status, 422);
  const review = () => api(`/v1/admin/skills/${skill.id}/${skill.version}/review`, { action: 'approve', reviewer: 'Operator', notes: 'Review current evidence' });
  assert.equal((await review()).status, 409);
  assert.equal((await add(passing)).status, 201);
  assert.equal((await review()).status, 200);
});

test('expiry releases reserved money even when clicks are rejected and campaign read-only views reconcile idle expired links', async t => {
  const { api, store } = await setup(t);
  const now = Date.now();
  const campaign = store.createCampaign(campaignInput(now));
  storeDecision(store, campaign, 'expire-click-one', new Date(now).toISOString());
  assert.throws(() => store.consumeClick(sha256('expire-click-one'), new Date(now + 600_000).toISOString()), /expired/);
  assert.equal(store.getCampaign(campaign.id)!.reservedCents, 0);
  assert.equal(store.metrics().spentCents, 0);
  storeDecision(store, campaign, 'expire-click-two', new Date(now).toISOString());
  store.database.prepare('UPDATE ad_decisions SET expires_at = ? WHERE id = ?').run(new Date(now - 1).toISOString(), 'expire-click-two');
  const list = await (await api('/v1/admin/campaigns')).json();
  assert.equal(list.items.find((item: any) => item.id === campaign.id).reservedCents, 0);
  assert.equal(store.metrics().clicks, 0);
});

test('every accepted event ID remains bound to its original type and reason, including deduplicated impressions', async t => {
  const { api, store } = await setup(t);
  const campaign = store.createCampaign(campaignInput());
  const envelope = await (await api('/v1/ads/decision', { requestId: 'event-dedupe-request', context: 'normal', category: 'development' }, 'POST', false)).json() as Signed<AdDecision>;
  const event = (eventId: string, type: string, reason?: string) => api('/v1/events', { token: envelope.payload.token, eventId, type, ...(reason ? { reason } : {}) }, 'POST', false);
  assert.equal((await event('unique-event-first', 'impression')).status, 200);
  assert.equal((await (await event('unique-event-second', 'impression')).json()).duplicate, true);
  assert.equal((await event('unique-event-second', 'report', 'Attempted idempotency key reuse')).status, 409);
  assert.equal((await event('unique-event-report', 'report', 'Original report reason')).status, 200);
  assert.equal((await event('unique-event-report', 'report', 'Changed report reason')).status, 409);
  assert.equal(store.metrics().impressions, 1); assert.equal(store.metrics().reports, 1);
  const reports = store.listReports();
  assert.equal(reports[0]!.campaignId, campaign.id); assert.equal(reports[0]!.decisionId, envelope.payload.decisionId);
  assert.equal(reports[0]!.reason, 'Original report reason');
});

test('daily accounting separates click dates from unique paid-impression CTR cohorts and never fabricates zero-denominator rates', async t => {
  const { store } = await setup(t);
  const campaign = store.createCampaign({ ...campaignInput(), startsAt: '2026-07-01T00:00:00.000Z', endsAt: '2026-07-03T00:00:00.000Z' });
  storeDecision(store, campaign, 'cohort-midnight-one', '2026-07-01T23:58:00.000Z');
  storeDecision(store, campaign, 'cohort-midnight-two', '2026-07-01T23:58:01.000Z');
  store.recordEvent({ decisionId: 'cohort-midnight-one', tokenHash: sha256('cohort-midnight-one'), eventId: 'cohort-impression-one', type: 'impression', createdAt: '2026-07-01T23:59:00.000Z' });
  store.recordEvent({ decisionId: 'cohort-midnight-two', tokenHash: sha256('cohort-midnight-two'), eventId: 'cohort-impression-two', type: 'impression', createdAt: '2026-07-01T23:59:01.000Z' });
  const house: AdDecision = { decisionId: 'cohort-house', campaignId: null, creativeId: 'house', disclosure: '广告', text: 'Synthetic house', url: 'https://registry.example', expiresAt: '2026-07-02T00:08:00.000Z', token: 'cohort-house', house: true };
  store.storeDecision({ decision: house, signed: { payload: house }, requestId: 'cohort-house', requestHash: sha256('cohort-house'), targetUrl: 'https://registry.example', campaign: null, createdAt: '2026-07-01T23:58:00.000Z' });
  store.recordEvent({ decisionId: 'cohort-house', tokenHash: sha256('cohort-house'), eventId: 'cohort-impression-house', type: 'impression', createdAt: '2026-07-01T23:59:02.000Z' });
  store.consumeClick(sha256('cohort-midnight-one'), '2026-07-02T00:01:00.000Z');
  const first = store.metricsByPeriod('2026-07-01', '2026-07-01');
  assert.equal(first.paidImpressions, 2); assert.equal(first.clickedImpressions, 1); assert.equal(first.ctr, 0.5);
  assert.equal(first.impressions, 3); assert.equal(first.rows.find(row => row.campaignId === 'house')!.ctr, null);
  assert.equal(first.clicks, 0); assert.equal(first.spentCents, 0);
  const second = store.metricsByPeriod('2026-07-02', '2026-07-02');
  assert.equal(second.clicks, 1); assert.equal(second.spentCents, 25); assert.equal(second.ctr, null);
  assert.equal(second.rows[0]!.ctr, null);
  const total = store.metricsByPeriod('2026-07-01', '2026-07-02', campaign.id, 'campaign');
  assert.equal(total.ctr, 0.5); assert.equal(total.rows[0]!.ctr, 0.5);
});

test('independent SQLite processes cannot overcommit daily caps or bill one decision more than once', { timeout: 30_000 }, async t => {
  const { store, dataDir } = await setup(t);
  const campaign = store.createCampaign({ ...campaignInput(), dailyCap: 1 });
  const modulePath = fileURLToPath(new URL('../src/registry/database.ts', import.meta.url));
  const sharedPath = fileURLToPath(new URL('../src/shared.ts', import.meta.url));
  const tsx = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url));
  const script = `import { RegistryStore } from ${JSON.stringify(modulePath)}; import { sha256 } from ${JSON.stringify(sharedPath)}; (async () => { const store = await RegistryStore.open(process.argv[1]); const campaign = store.getCampaign(process.argv[2]); const id = process.argv[3]; try { if (process.argv[4] === 'click') { store.consumeClick(sha256(id)); } else { const now = new Date(); const decision = { decisionId:id,campaignId:campaign.id,creativeId:campaign.id,disclosure:'广告',text:campaign.text,url:'https://registry.example/r/test',expiresAt:new Date(now.getTime()+600000).toISOString(),token:id,house:false }; store.storeDecision({decision,signed:{payload:decision},requestId:id,requestHash:sha256(id),targetUrl:campaign.url,campaign,createdAt:now.toISOString()}); } process.stdout.write('accepted'); } catch(error) { process.stdout.write(error.code || 'error'); } finally { store.close(); } })();`;
  const run = (id: string, mode = 'decision') => promisify(execFile)(process.execPath, [tsx, '-e', script, dataDir, campaign.id, id, mode], { timeout: 20_000, maxBuffer: 1024 * 1024 });
  const decisions = await Promise.all(Array.from({ length: 6 }, (_, index) => run(`parallel-decision-${index}`)));
  assert.equal(decisions.filter(result => result.stdout === 'accepted').length, 1);
  assert.equal(store.metrics().decisions, 1); assert.equal(store.getCampaign(campaign.id)!.reservedCents, 25);
  const winner = `parallel-decision-${decisions.findIndex(result => result.stdout === 'accepted')}`;
  const clicks = await Promise.all(Array.from({ length: 6 }, () => run(winner, 'click')));
  assert.equal(clicks.filter(result => result.stdout === 'accepted').length, 1);
  assert.equal(store.metrics().clicks, 1); assert.equal(store.metrics().spentCents, 25); assert.equal(store.getCampaign(campaign.id)!.reservedCents, 0);
});

test('audit pagination can reach records older than the first thousand and filtered totals remain complete', async t => {
  const { api, store } = await setup(t);
  const insert = store.database.prepare('INSERT INTO audit_log (action, subject, created_at) VALUES (?, ?, ?)');
  store.database.exec('BEGIN IMMEDIATE');
  for (let index = 0; index < 1005; index++) insert.run(index === 0 ? 'oldest.audit' : 'recent.audit', `subject-${index}`, '2026-07-01T12:00:00.000Z');
  store.database.exec('COMMIT');
  const paged = await (await api('/v1/admin/audit?offset=1000&limit=10')).json();
  assert.equal(paged.total, 1005); assert.equal(paged.items.length, 5);
  assert.equal(paged.items.at(-1).subject, 'subject-0');
  const filtered = await (await api('/v1/admin/audit?action=oldest.audit&from=2026-07-01&to=2026-07-01')).json();
  assert.equal(filtered.total, 1); assert.equal(filtered.items[0].subject, 'subject-0');
});

test('dismissing reports leaves campaign commitments intact and invalid inquiries purge while active follow-ups retain their data', async t => {
  const { api, store } = await setup(t);
  const campaign = store.createCampaign(campaignInput());
  storeDecision(store, campaign, 'dismiss-report-decision');
  const submitted = await (await api('/v1/reports', { requestId: 'dismiss-report-id', campaignId: campaign.id, reason: 'Unsubstantiated report' }, 'POST', false)).json();
  const dismissed = await api(`/v1/admin/reports/${submitted.id}`, { action: 'dismiss', operator: 'Operator', notes: 'Verified the creative and original destination' }, 'PATCH');
  assert.equal(dismissed.status, 200); assert.equal(store.getCampaign(campaign.id)!.active, true); assert.equal(store.getCampaign(campaign.id)!.reservedCents, 25);
  assert.equal((await api(`/v1/admin/reports/${submitted.id}`, { action: 'pause', operator: 'Operator', notes: 'Cannot resolve again' }, 'PATCH')).status, 409);
  const input = { requestId: 'invalid-inquiry', name: 'Retention example', contact: 'person@example.test', company: 'Example', product: 'Example', website: 'https://example.test', message: 'Example requirement', consent: true };
  const invalid = await (await api('/v1/inquiries', input, 'POST', false)).json();
  const active = await (await api('/v1/inquiries', { ...input, requestId: 'active-inquiry' }, 'POST', false)).json();
  await api(`/v1/admin/inquiries/${invalid.id}`, { status: 'invalid', operator: 'Operator', notes: 'Invalid business need' }, 'PATCH');
  await api(`/v1/admin/inquiries/${active.id}`, { status: 'following-up', operator: 'Operator', notes: 'Conversation is ongoing' }, 'PATCH');
  const closed = store.listInquiries().find(item => item.id === invalid.id)!;
  store.purgeInquiryPII(new Date(Date.parse(closed.closedAt!) + 180 * 86_400_000).toISOString());
  assert.equal(store.listInquiries().find(item => item.id === invalid.id)!.contact, '');
  assert.equal(store.listInquiries().find(item => item.id === active.id)!.contact, input.contact);
  const audit = store.auditItems();
  assert.ok(audit.some(item => item.action === 'report.resolved' && item.subject === submitted.id));
  assert.ok(audit.some(item => item.action === 'inquiry.pii_purged' && item.subject === invalid.id));
});

test('advertising destinations reject IPv6, normalized IP literals, localhost subdomains and single-label intranet names', async t => {
  const { api, store } = await setup(t);
  for (const url of ['https://[::1]/', 'https://[2001:db8::1]/', 'https://127.1/', 'https://127.0.0.1/', 'https://service.localhost/', 'https://localhost./', 'https://intranet/', 'https://device.local/']) {
    const response = await api('/v1/admin/campaigns', { ...campaignInput(), url });
    assert.equal(response.status, 422, url);
  }
  assert.equal(store.listCampaigns().length, 0);
  assert.equal((await api('/v1/admin/campaigns', { ...campaignInput(), url: 'https://sponsor.example/product' })).status, 201);
});

test('pending and rejected identities, private files and rejection reasons stay absent across every public route', async t => {
  const { api, store } = await setup(t);
  const skill = submission('quarantined-identity'); skill.files['references/private.md'] = 'PRIVATE quarantine resource';
  await api('/v1/admin/skills', skill);
  const record = store.getSkill(skill.id, skill.version)!;
  const assertHidden = async () => {
    for (const path of [`/v1/skills/${skill.id}`, `/v1/skills/${skill.id}?version=${skill.version}`, `/v1/skills/${skill.id}/versions`, `/v1/skills/${skill.id}/resources?path=references%2Fprivate.md`, `/v1/bundles/${record.summary.digest}`, `/v1/qualifications/${record.summary.digest}`]) assert.equal((await api(path, undefined, 'GET', false)).status, 404, path);
    for (const path of ['/v1/catalog', '/v1/search', '/v1/publication', '/v1/publication/statuses', '/v1/revocations']) {
      const text = await (await api(path, undefined, 'GET', false)).text();
      assert.ok(!text.includes(skill.id), path); assert.ok(!text.includes('PRIVATE'), path);
    }
  };
  await assertHidden();
  assert.equal((await api(`/v1/admin/skills/${skill.id}/${skill.version}/review`, { action: 'reject', reviewer: 'Operator', notes: '' })).status, 422);
  assert.equal((await api(`/v1/admin/skills/${skill.id}/${skill.version}/review`, { action: 'reject', reviewer: 'Operator', notes: 'PRIVATE rejection rationale' })).status, 200);
  await assertHidden();
  const detail = await (await api(`/v1/admin/skills/${skill.id}/${skill.version}`)).json();
  assert.equal(detail.files['references/private.md'], 'PRIVATE quarantine resource');
  assert.equal(detail.reviews[0].notes, 'PRIVATE rejection rationale');
  assert.equal((await api(`/v1/admin/skills/${skill.id}/${skill.version}/review`, { action: 'approve', reviewer: 'Operator', notes: 'Cannot revive rejected version' })).status, 409);
});
