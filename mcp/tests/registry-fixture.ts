/** Isolated integration-test fixtures. These simulate operator actions and never seed a production registry. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { EvaluationInput, Host, SkillSummary, Submission } from '../src/shared.js';
import { bundleDigest, canonical } from '../src/shared.js';
import type { RegistryStore } from '../src/registry/database.js';
import { scanSubmission } from '../src/registry/scan.js';

export const syntheticRelease = { notes: 'Synthetic integration fixture; not a real published human evaluation.', breaking: false, minClientVersion: '1.0.0', maintainedAt: '2026-01-01T00:00:00.000Z', maintainedBy: 'Integration test fixture' };
export function syntheticEvaluation(contentHash: string, hosts: Host[]): EvaluationInput {
  return { contentHash, tester: 'Synthetic test actor', testedAt: '2026-01-01T00:00:00.000Z', environment: 'Isolated HTTP integration test; mocked human input, no real host execution.', kind: 'human',
    purpose: { input: 'Synthetic intended-use input', expected: 'Synthetic expected output', actual: 'Synthetic observed output', passed: true },
    boundary: { input: 'Synthetic boundary input', expected: 'Synthetic bounded output', actual: 'Synthetic bounded output', passed: true },
    hostChecks: hosts.map(host => ({ host, installed: true, read: true, notes: 'Synthetic integration fixture representing a host check; not actual execution.' })),
    publicSummary: 'Synthetic integration fixture only; this is not a real human evaluation.' };
}
export async function recordSyntheticEvaluation(baseUrl: string, token: string, id: string, version: string): Promise<void> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const detailResponse = await fetch(`${baseUrl}/v1/admin/skills/${id}/${version}`, { headers });
  assert.equal(detailResponse.status, 200, await detailResponse.clone().text());
  const detail = await detailResponse.json() as { contentHash: string; skill: SkillSummary };
  const response = await fetch(`${baseUrl}/v1/admin/skills/${id}/${version}/evaluations`, { method: 'POST', headers, body: JSON.stringify(syntheticEvaluation(detail.contentHash, detail.skill.hosts)) });
  assert.equal(response.status, 201, await response.text());
}
export async function publishSyntheticFixture(baseUrl: string, token: string, submission: Submission): Promise<SkillSummary> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const existing = await fetch(`${baseUrl}/v1/admin/skills/${submission.id}/${submission.version}`, { headers });
  if (existing.status === 200) {
    const detail = await existing.json() as { skill: SkillSummary };
    if (detail.skill.status === 'approved') return detail.skill;
    assert.ok(detail.skill.release, 'Test registry must start dev:false to avoid quarantined seed versions without release metadata');
  } else {
    const response = await fetch(`${baseUrl}/v1/admin/skills`, { method: 'POST', headers, body: JSON.stringify({ ...submission, release: submission.release ?? syntheticRelease }) });
    assert.equal(response.status, 201, await response.text());
  }
  await recordSyntheticEvaluation(baseUrl, token, submission.id, submission.version);
  const approved = await fetch(`${baseUrl}/v1/admin/skills/${submission.id}/${submission.version}/review`, { method: 'POST', headers, body: JSON.stringify({ action: 'approve', reviewer: 'Synthetic test actor', notes: 'Synthetic integration test approval; not actual QA.' }) });
  assert.equal(approved.status, 200, await approved.clone().text());
  return (await approved.json() as { skill: SkillSummary }).skill;
}
export async function seedSyntheticCatalog(baseUrl: string, token: string): Promise<void> {
  const submissions = JSON.parse(await readFile(new URL('../catalog/seed.json', import.meta.url), 'utf8')) as Submission[];
  for (const submission of submissions) await publishSyntheticFixture(baseUrl, token, submission);
}

/** Reproduces an older, already-signed public package without inventing test evidence. */
export function makeLegacyFixture(store: RegistryStore, submission: Submission): SkillSummary {
  const current = store.submitSkill(submission, scanSubmission(submission));
  const quality = { ...current.summary.quality, review: { reviewer: 'Legacy public reviewer', reviewedAt: '2026-01-01T00:00:00.000Z', notes: 'Legacy public assessment text' } };
  const bundle = { manifest: { ...current.bundle.manifest, quality }, files: current.bundle.files };
  store.database.prepare("UPDATE skills SET status='approved', quality_json=?, bundle_json=?, digest=?, size=? WHERE id=? AND version=?")
    .run(canonical(quality), canonical(bundle), bundleDigest(bundle), Buffer.byteLength(canonical(bundle)), submission.id, submission.version);
  return store.getSkill(submission.id, submission.version)!.summary;
}
