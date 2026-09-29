import { createHash, sign, verify } from 'node:crypto';

export const PROTOCOL_VERSION = '1.0';
export type Host = 'generic' | 'codex' | 'claude' | 'cursor';
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'revoked';
export interface SkillFile { path: string; sha256: string; size: number }
export interface Permissions { network: string[]; shell: boolean; secrets: string[] }
export interface Dependency { id: string; version: string }
export interface ReleaseMetadata { notes: string; breaking: boolean; minClientVersion: string; maintainedAt: string; maintainedBy: string }
export interface EvaluationCase { input: string; expected: string; actual: string; passed: boolean; steps?: string; limitations?: string; evidence?: string }
export interface EvaluationInput {
  contentHash: string; tester: string; testedAt: string; environment: string; kind: 'human' | 'simulation';
  purpose: EvaluationCase; boundary: EvaluationCase;
  hostChecks: { host: Host; installed: boolean; read: boolean; notes: string }[];
  publicSummary: string;
}
export interface Evaluation extends EvaluationInput { id: string; skillId: string; version: string; createdAt: string; finalDigest: string | null }
export interface PublicEvaluation { evaluationId: string; contentHash: string; testedAt: string; summary: string; hosts: Host[]; purposePassed: boolean; boundaryPassed: boolean }
export interface QualificationProof { id: string; version: string; digest: string; contentHash: string; qualification: 'qualified' | 'needs-testing' | 'revoked'; evaluation?: PublicEvaluation; generatedAt: string; expiresAt: string }
export interface QualityEvidence {
  automated: { passed: boolean; checks: string[]; checkedAt: string };
  review: { reviewer: string; reviewedAt: string; notes: string } | null;
  evaluation?: PublicEvaluation;
}
export interface Manifest {
  schema: 'skillflux/v1'; id: string; version: string; name: string;
  description: string; category: string; tags: string[]; hosts: Host[];
  publisher: string; license: string; entry: string;
  permissions: Permissions; dependencies: Dependency[]; files: SkillFile[];
  quality: QualityEvidence; createdAt: string; release?: ReleaseMetadata;
}
export interface Bundle { manifest: Manifest; files: Record<string, string> }
export interface Signed<T> { payload: T; keyId: string; signature: string }
export interface PublicKeyInfo { keyId: string; publicKey: string }
export interface SkillSummary {
  id: string; version: string; name: string; description: string; category: string;
  tags: string[]; hosts: Host[]; publisher: string; license: string;
  status: ReviewStatus; digest: string; size: number; entry: string;
  permissions: Permissions; dependencies: Dependency[]; quality: QualityEvidence;
  createdAt: string; release?: ReleaseMetadata; qualification?: 'qualified' | 'needs-testing' | 'revoked'; score?: number; reasons?: string[];
}
export interface SkillVersionSummary { id: string; version: string; name: string; digest: string; status: ReviewStatus; qualification: 'qualified' | 'needs-testing' | 'revoked'; reason?: string; release?: ReleaseMetadata; hosts: Host[]; dependencies: Dependency[]; createdAt: string }
export interface SkillVersionsResponse { items: SkillVersionSummary[]; total: number; offset: number; limit: number }
export interface Publication { items: { skill: SkillSummary; bundle: Bundle }[]; total: number; offset: number; limit: number; revision: string; generatedAt: string; expiresAt: string }
export interface SearchResponse { items: SkillSummary[]; total: number; categories: string[]; offset: number; limit: number }
export interface Catalog { skills: SkillSummary[]; generatedAt: string; expiresAt: string }
export interface Revocations { items: { id: string; version: string; digest: string; reason: string; revokedAt: string }[]; generatedAt: string; expiresAt: string }
export interface SkillDetail { skill: SkillSummary; manifest: Manifest; content: string; resources: string[] }
export interface Submission {
  id: string; version: string; name: string; description: string; category: string;
  tags: string[]; hosts: Host[]; publisher: string; license: string; entry: string;
  permissions: Permissions; dependencies: Dependency[]; files: Record<string, string>;
  release?: ReleaseMetadata;
}
export interface CampaignInput {
  name: string; sponsor: string; text: string; url: string; categories: string[];
  active: boolean; budgetCents: number; cpcCents: number; dailyCap: number;
  startsAt: string; endsAt: string;
}
export interface Campaign extends CampaignInput { id: string; spentCents: number; reservedCents?: number; createdAt: string }
export interface AdRequest { category: string; context?: 'normal' | 'sensitive' | 'unknown'; skillId?: string; locale?: string; placement?: 'final-answer' | 'web-preview'; excludedCampaigns?: string[]; requestId: string }
export interface AdDecision { decisionId: string; campaignId: string | null; creativeId: string; disclosure: '广告'; text: string; url: string; expiresAt: string; token: string; house: boolean }
export interface Metrics { skills: Record<string, number>; campaigns: number; decisions: number; impressions: number; clicks: number; spentCents: number; reports: number; paidImpressions?: number; clickedImpressions?: number; ctr?: number | null }
export interface ApiError { error: { code: string; message: string } }
export interface InquiryInput { requestId: string; name: string; contact: string; company: string; product: string; website: string; message: string; consent: true }
export interface Inquiry extends InquiryInput { id: string; status: 'new' | 'following-up' | 'completed' | 'invalid'; createdAt: string; updatedAt: string; closedAt: string | null; notes: string; operator: string; purgedAt: string | null }
export interface AdReport { id: string; campaignId: string; decisionId: string | null; reason: string; status: 'new' | 'dismissed' | 'paused'; createdAt: string; updatedAt: string; operator: string; notes: string; campaign?: Campaign | null }
export interface MetricRow { date: string; campaignId: string; name: string; decisions: number; impressions: number; clicks: number; spentCents: number; reports: number; clickedImpressions: number; ctr: number | null }

/** Canonical JSON is shared by signing, verification and content-addressing. */
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object' && value !== null) {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}';
  }
  throw new Error('Unsupported value in canonical JSON');
}
export function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
export function compareVersions(left: string, right: string): number {
  const parts = (value: string) => { const base = value.split('+')[0]!; const at = base.indexOf('-'); return { core: (at < 0 ? base : base.slice(0, at)).split('.').map(BigInt), pre: at < 0 ? [] : base.slice(at + 1).split('.') }; };
  const a = parts(left), b = parts(right);
  for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i]! < b.core[i]! ? -1 : 1;
  if (!a.pre.length || !b.pre.length) return a.pre.length ? -1 : b.pre.length ? 1 : 0;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return BigInt(x) < BigInt(y) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
export function bundleDigest(bundle: Bundle): string { return sha256(canonical(bundle)); }
/** Stable review target: excludes generated assessment evidence to avoid a digest cycle. */
export function contentHash(bundle: Bundle): string {
  const { quality: _quality, ...manifest } = bundle.manifest;
  return sha256(canonical({ manifest, files: bundle.files }));
}
export function signPayload<T>(payload: T, privateKey: string, keyId: string): Signed<T> {
  return { payload, keyId, signature: sign(null, Buffer.from(canonical(payload)), privateKey).toString('base64') };
}
export function verifyPayload<T>(envelope: Signed<T>, key: PublicKeyInfo): T {
  if (!envelope || envelope.keyId !== key.keyId || typeof envelope.signature !== 'string' || !verify(null, Buffer.from(canonical(envelope.payload)), key.publicKey, Buffer.from(envelope.signature, 'base64'))) {
    throw new Error('Invalid registry signature');
  }
  return envelope.payload;
}
export function safeRelativePath(path: string): boolean {
  return typeof path === 'string' && path.length > 0 && path.length <= 240 && !/[\\\x00-\x1f\x7f:]/.test(path) && !path.startsWith('/') && path.split('/').every(part => part !== '' && part !== '.' && part !== '..' && !part.endsWith('.') && !part.endsWith(' ') && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part));
}
