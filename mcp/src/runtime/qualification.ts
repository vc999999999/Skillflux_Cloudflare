import { contentHash, verifyPayload, type Bundle, type Host, type PublicKeyInfo, type QualificationProof, type Signed } from '../shared.js';
import { SkillFluxError } from './errors.js';

export const QUALIFICATION_FILE = '.skillflux-qualification.json';

export function verifyQualificationProof(envelope: Signed<QualificationProof>, key: PublicKeyInfo, expected: { id: string; version: string; digest: string; hosts: Host[]; bundle?: Bundle }, allowExpired = false, requireQualified = true): QualificationProof {
  let proof: QualificationProof;
  try { proof = verifyPayload(envelope, key); } catch (error) { throw new SkillFluxError('INVALID_QUALIFICATION_SIGNATURE', (error as Error).message); }
  if (proof.id !== expected.id || proof.version !== expected.version || proof.digest !== expected.digest
    || !/^[a-f0-9]{64}$/.test(proof.contentHash) || (expected.bundle && proof.contentHash !== contentHash(expected.bundle))) {
    throw new SkillFluxError('QUALIFICATION_BINDING_MISMATCH', 'Qualification proof is not bound to this exact skill version, digest and content');
  }
  if (!Number.isFinite(Date.parse(proof.generatedAt)) || Date.parse(proof.generatedAt) > Date.now() + 60_000
    || !Number.isFinite(Date.parse(proof.expiresAt)) || Date.parse(proof.expiresAt) <= Date.parse(proof.generatedAt)) throw new SkillFluxError('INVALID_QUALIFICATION', 'Qualification proof timestamps are invalid');
  if (!allowExpired && Date.parse(proof.expiresAt) <= Date.now()) throw new SkillFluxError('QUALIFICATION_EXPIRED', 'Online qualification proof is expired');
  if (!['qualified', 'needs-testing', 'revoked'].includes(proof.qualification)) throw new SkillFluxError('INVALID_QUALIFICATION', 'Qualification status is invalid');
  if (!requireQualified && proof.qualification !== 'qualified') return proof;
  if (proof.qualification === 'revoked') throw new SkillFluxError('SKILL_REVOKED', `${proof.id}@${proof.version} qualification was revoked`);
  const evaluation = proof.evaluation;
  if (proof.qualification !== 'qualified' || !evaluation || evaluation.contentHash !== proof.contentHash || !evaluation.purposePassed || !evaluation.boundaryPassed
    || !Array.isArray(evaluation.hosts) || !expected.hosts.every(host => evaluation.hosts.includes(host))) throw new SkillFluxError('UNTESTED_SKILL', 'This exact package does not have a current passing qualification for every declared host');
  return proof;
}
