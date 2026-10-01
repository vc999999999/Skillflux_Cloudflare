import { createHash } from 'node:crypto';

export type Host = 'generic' | 'codex' | 'claude' | 'cursor';
export type ReviewStatus = 'approved' | 'rejected' | 'revoked' | 'needs-testing';
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
export interface PublicEvaluation { evaluationId: string; contentHash: string; testedAt: string; summary: string; hosts: Host[]; purposePassed: boolean; boundaryPassed: boolean }
export interface QualityEvidence {
  automated: { passed: boolean; checks: string[]; checkedAt: string };
  review: { reviewer: string; reviewedAt: string; notes: string } | null;
  evaluation?: PublicEvaluation;
}
export type Qualification = 'qualified' | 'needs-testing' | 'revoked';
export interface Manifest {
  schema: 'skillflux/v1'; id: string; version: string; name: string;
  description: string; category: string; tags: string[]; hosts: Host[];
  publisher: string; license: string; entry: string;
  permissions: Permissions; dependencies: Dependency[];
  createdAt: string; release?: ReleaseMetadata;
}
export interface Bundle { manifest: Manifest; files: Record<string, string> }
export interface SkillSummary {
  id: string; version: string; name: string; description: string; category: string;
  tags: string[]; hosts: Host[]; publisher: string; license: string;
  status: ReviewStatus; digest: string; size: number; entry: string;
  permissions: Permissions; dependencies: Dependency[]; quality: QualityEvidence;
  createdAt: string; release?: ReleaseMetadata; qualification?: Qualification; score?: number; reasons?: string[];
}
export interface SkillVersionSummary { id: string; version: string; name: string; digest: string; status: ReviewStatus; qualification: Qualification; reason?: string; release?: ReleaseMetadata; hosts: Host[]; dependencies: Dependency[]; createdAt: string }
export interface SearchResponse { items: SkillSummary[]; total: number; categories: string[]; offset: number; limit: number }

/** Canonical JSON is shared by content addressing and plan sealing. */
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
export function safeRelativePath(path: string): boolean {
  return typeof path === 'string' && path.length > 0 && path.length <= 240 && !/[\\\x00-\x1f\x7f:]/.test(path) && !path.startsWith('/') && path.split('/').every(part => part !== '' && part !== '.' && part !== '..' && !part.endsWith('.') && !part.endsWith(' ') && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part));
}
