import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AdDecision,
  Bundle,
  Campaign,
  CampaignInput,
  Manifest,
  Metrics,
  QualityEvidence,
  ReviewStatus,
  SkillSummary,
  Submission,
  Evaluation, EvaluationInput, SkillVersionSummary, InquiryInput, Inquiry, AdReport, MetricRow, QualificationProof,
} from '../shared.js';
import { bundleDigest, canonical, sha256, contentHash } from '../shared.js';
import type { ScanResult } from './scan.js';

type SqlRow = Record<string, string | number | bigint | null | Uint8Array>;

interface SkillRow extends SqlRow {
  id: string;
  version: string;
  name: string;
  description: string;
  category: string;
  tags_json: string;
  hosts_json: string;
  publisher: string;
  license: string;
  entry: string;
  permissions_json: string;
  dependencies_json: string;
  quality_json: string;
  status: string;
  digest: string;
  size: number;
  bundle_json: string;
  created_at: string;
  reviewed_at: string | null;
  reviewer: string | null;
  review_notes: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
}

interface CampaignRow extends SqlRow {
  id: string;
  name: string;
  sponsor: string;
  text: string;
  url: string;
  categories_json: string;
  active: number;
  budget_cents: number;
  reserved_cents: number;
  spent_cents: number;
  cpc_cents: number;
  daily_cap: number;
  starts_at: string;
  ends_at: string;
  created_at: string;
  last_served_at: string | null;
}

interface DecisionRow extends SqlRow {
  id: string;
  request_id: string;
  request_hash: string;
  campaign_id: string | null;
  creative_id: string;
  disclosure: string;
  text: string;
  target_url: string;
  expires_at: string;
  token: string;
  token_hash: string;
  house: number;
  signed_json: string;
  created_at: string;
  clicked_at: string | null;
  reservation_cents: number;
  reservation_released: number;
  invalidated_at: string | null;
}

export interface SkillRecord {
  summary: SkillSummary;
  bundle: Bundle;
  reviewedAt: string | null;
  reviewer: string | null;
  reviewNotes: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
}

export interface CampaignCandidate extends Campaign {
  reservedCents: number;
  lastServedAt: string | null;
  decisionsToday: number;
}

export interface StoredDecision {
  decision: AdDecision;
  signed: unknown;
  requestHash: string;
  tokenHash: string;
  targetUrl: string;
  clickedAt: string | null;
  campaignId: string | null;
  house: boolean;
  invalidatedAt: string | null;
}

export class RegistryStoreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RegistryStoreError';
  }
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function stringify(value: unknown): string {
  return canonical(value);
}

function parseVersion(version: string): { core: bigint[]; prerelease: Array<bigint | string> } {
  const withoutBuild = version.split('+', 1)[0] ?? version;
  const separator = withoutBuild.indexOf('-');
  const coreText = separator === -1 ? withoutBuild : withoutBuild.slice(0, separator);
  const prereleaseText = separator === -1 ? '' : withoutBuild.slice(separator + 1);
  return {
    core: coreText.split('.').map(value => BigInt(value)),
    prerelease: prereleaseText ? prereleaseText.split('.').map(value => /^\d+$/.test(value) ? BigInt(value) : value) : [],
  };
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const leftPart = a.core[index] ?? 0n;
    const rightPart = b.core[index] ?? 0n;
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;
  if (b.prerelease.length === 0 && a.prerelease.length > 0) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    if (typeof leftPart === 'bigint' && typeof rightPart === 'string') return -1;
    if (typeof leftPart === 'string' && typeof rightPart === 'bigint') return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function skillRowToRecord(row: SkillRow): SkillRecord {
  const bundle = parseJson<Bundle>(row.bundle_json);
  return {
    summary: {
      id: row.id,
      version: row.version,
      name: row.name,
      description: row.description,
      category: row.category,
      tags: parseJson<string[]>(row.tags_json),
      hosts: parseJson<SkillSummary['hosts']>(row.hosts_json),
      publisher: row.publisher,
      license: row.license,
      status: row.status as ReviewStatus,
      digest: row.digest,
      size: Number(row.size),
      entry: row.entry,
      permissions: parseJson<SkillSummary['permissions']>(row.permissions_json),
      dependencies: parseJson<SkillSummary['dependencies']>(row.dependencies_json),
      quality: parseJson<QualityEvidence>(row.quality_json),
      createdAt: row.created_at,
      ...(bundle.manifest.release ? { release: bundle.manifest.release } : {}),
    },
    bundle,
    reviewedAt: row.reviewed_at,
    reviewer: row.reviewer,
    reviewNotes: row.review_notes,
    revokedAt: row.revoked_at,
    revocationReason: row.revocation_reason,
  };
}

function campaignRowToCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name,
    sponsor: row.sponsor,
    text: row.text,
    url: row.url,
    categories: parseJson<string[]>(row.categories_json),
    active: Boolean(row.active),
    budgetCents: Number(row.budget_cents),
    spentCents: Number(row.spent_cents),
    reservedCents: Number(row.reserved_cents),
    cpcCents: Number(row.cpc_cents),
    dailyCap: Number(row.daily_cap),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdAt: row.created_at,
  };
}

export class RegistryStore {
  readonly database: DatabaseSync;
  private closed = false;

  private constructor(path: string) {
    this.database = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
    });
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
    const version = this.database.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version > 2) { this.database.close(); throw new Error('Registry database schema is newer than this server supports'); }
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT NOT NULL,
        version TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        hosts_json TEXT NOT NULL,
        publisher TEXT NOT NULL,
        license TEXT NOT NULL,
        entry TEXT NOT NULL,
        permissions_json TEXT NOT NULL,
        dependencies_json TEXT NOT NULL,
        quality_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','revoked')),
        digest TEXT NOT NULL,
        size INTEGER NOT NULL CHECK (size >= 0),
        bundle_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        reviewer TEXT,
        review_notes TEXT,
        revoked_at TEXT,
        revocation_reason TEXT,
        PRIMARY KEY (id, version)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS skills_public_lookup ON skills (status, id, created_at);
      CREATE INDEX IF NOT EXISTS skills_category ON skills (status, category);

      CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        skill_id TEXT NOT NULL,
        version TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('approve','reject','revoke')),
        reviewer TEXT NOT NULL,
        notes TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (skill_id, version) REFERENCES skills(id, version)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sponsor TEXT NOT NULL,
        text TEXT NOT NULL,
        url TEXT NOT NULL,
        categories_json TEXT NOT NULL,
        active INTEGER NOT NULL CHECK (active IN (0,1)),
        budget_cents INTEGER NOT NULL CHECK (budget_cents >= 0),
        reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0),
        spent_cents INTEGER NOT NULL DEFAULT 0 CHECK (spent_cents >= 0),
        cpc_cents INTEGER NOT NULL CHECK (cpc_cents >= 0),
        daily_cap INTEGER NOT NULL CHECK (daily_cap >= 0),
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_served_at TEXT
      ) STRICT;

      CREATE TABLE IF NOT EXISTS ad_decisions (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        request_hash TEXT NOT NULL,
        campaign_id TEXT,
        creative_id TEXT NOT NULL,
        disclosure TEXT NOT NULL,
        text TEXT NOT NULL,
        target_url TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        token TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        house INTEGER NOT NULL CHECK (house IN (0,1)),
        signed_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        clicked_at TEXT,
        reservation_cents INTEGER NOT NULL DEFAULT 0 CHECK (reservation_cents >= 0),
        reservation_released INTEGER NOT NULL DEFAULT 0 CHECK (reservation_released IN (0,1)),
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS decisions_campaign_day ON ad_decisions (campaign_id, created_at);

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        decision_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('impression','hide','report')),
        reason TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (decision_id) REFERENCES ad_decisions(id)
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS one_event_type_per_decision ON events(decision_id, type);

      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id TEXT NOT NULL,
        decision_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind = 'click'),
        amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
        created_at TEXT NOT NULL,
        UNIQUE (decision_id, kind),
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
        FOREIGN KEY (decision_id) REFERENCES ad_decisions(id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        subject TEXT NOT NULL,
        created_at TEXT NOT NULL,
        details_json TEXT
      ) STRICT;
    `);
    // Forward-only, repeatable migration. Historical approvals receive no invented evidence.
    const columns = this.database.prepare('PRAGMA table_info(ad_decisions)').all() as Array<{ name: string }>;
    if (!columns.some(column => column.name === 'invalidated_at')) this.database.exec('ALTER TABLE ad_decisions ADD COLUMN invalidated_at TEXT');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS evaluations (
        id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, version TEXT NOT NULL,
        content_hash TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL, final_digest TEXT,
        FOREIGN KEY (skill_id, version) REFERENCES skills(id, version)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS evaluations_skill ON evaluations(skill_id, version, created_at);
      CREATE TABLE IF NOT EXISTS inquiries (
        id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
        data_json TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        closed_at TEXT, purged_at TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS ad_reports (
        id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, request_hash TEXT NOT NULL,
        campaign_id TEXT NOT NULL, decision_id TEXT, reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        operator TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS inquiries_retention ON inquiries(closed_at, purged_at);
      CREATE INDEX IF NOT EXISTS reports_campaign ON ad_reports(campaign_id, created_at);
      CREATE TABLE IF NOT EXISTS event_receipts (
        event_id TEXT PRIMARY KEY, decision_id TEXT NOT NULL, token_hash TEXT NOT NULL,
        type TEXT NOT NULL, reason_hash TEXT NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY (decision_id) REFERENCES ad_decisions(id)
      ) STRICT;
      PRAGMA user_version = 2;
    `);
    this.purgeInquiryPII();
  }

  static async open(dataDir: string): Promise<RegistryStore> {
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    return new RegistryStore(join(dataDir, 'registry.sqlite'));
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private transaction<T>(work: () => T, readOnly = false): T {
    this.database.exec(readOnly ? 'BEGIN' : 'BEGIN IMMEDIATE');
    try {
      const result = work();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private audit(action: string, subject: string, details?: unknown, createdAt = new Date().toISOString()): void {
    this.database.prepare('INSERT INTO audit_log (action, subject, created_at, details_json) VALUES (?, ?, ?, ?)')
      .run(action, subject, createdAt, details === undefined ? null : stringify(details));
  }

  hasSkill(id: string, version: string): boolean {
    return Boolean(this.database.prepare('SELECT 1 AS found FROM skills WHERE id = ? AND version = ?').get(id, version));
  }

  submitSkill(submission: Submission, scan: ScanResult, submittedAt = new Date().toISOString()): SkillRecord {
    if (this.hasSkill(submission.id, submission.version)) {
      throw new RegistryStoreError(409, 'version_immutable', 'That skill version already exists and cannot be overwritten');
    }
    const manifest: Manifest = {
      schema: 'skillflux/v1',
      id: submission.id,
      version: submission.version,
      name: submission.name,
      description: submission.description,
      category: submission.category,
      tags: [...new Set(submission.tags)],
      hosts: [...new Set(submission.hosts)],
      publisher: submission.publisher,
      license: submission.license,
      entry: submission.entry,
      permissions: submission.permissions,
      dependencies: submission.dependencies,
      files: scan.files,
      quality: scan.quality,
      createdAt: submittedAt,
      ...(submission.release ? { release: submission.release } : {}),
    };
    const bundle: Bundle = { manifest, files: submission.files };
    const digest = bundleDigest(bundle);
    const size = Buffer.byteLength(canonical(bundle));
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO skills (
          id, version, name, description, category, tags_json, hosts_json, publisher,
          license, entry, permissions_json, dependencies_json, quality_json, status,
          digest, size, bundle_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
      `).run(
        manifest.id,
        manifest.version,
        manifest.name,
        manifest.description,
        manifest.category,
        stringify(manifest.tags),
        stringify(manifest.hosts),
        manifest.publisher,
        manifest.license,
        manifest.entry,
        stringify(manifest.permissions),
        stringify(manifest.dependencies),
        stringify(manifest.quality),
        digest,
        size,
        stringify(bundle),
        submittedAt,
      );
      this.audit('skill.submitted', `${manifest.id}@${manifest.version}`, {
        automatedPassed: scan.quality.automated.passed,
        automatedChecks: scan.quality.automated.checks,
        failures: scan.failures,
        fileCount: scan.files.length,
        contentBytes: scan.totalBytes,
      }, submittedAt);
    });
    return this.getSkill(submission.id, submission.version)!;
  }

  getSkill(id: string, version: string): SkillRecord | null {
    const row = this.database.prepare('SELECT * FROM skills WHERE id = ? AND version = ?').get(id, version) as SkillRow | undefined;
    return row ? skillRowToRecord(row) : null;
  }

  listSkills(): SkillRecord[] {
    const rows = this.database.prepare('SELECT * FROM skills ORDER BY created_at DESC, id ASC, version DESC').all() as unknown as SkillRow[];
    return rows.map(skillRowToRecord);
  }

  evaluations(id: string, version: string): Evaluation[] {
    const rows = this.database.prepare('SELECT * FROM evaluations WHERE skill_id = ? AND version = ? ORDER BY rowid DESC').all(id, version) as Array<{ id: string; skill_id: string; version: string; data_json: string; created_at: string; final_digest: string | null }>;
    return rows.map(row => ({ ...parseJson<EvaluationInput>(row.data_json), id: row.id, skillId: row.skill_id, version: row.version, createdAt: row.created_at, finalDigest: row.final_digest }));
  }

  private evaluationPasses(record: SkillRecord, evaluation: Evaluation): boolean {
    return evaluation.kind === 'human' && evaluation.contentHash === contentHash(record.bundle)
      && evaluation.purpose.passed && evaluation.boundary.passed
      && record.summary.hosts.every(host => evaluation.hostChecks.some(check => check.host === host && check.installed && check.read));
  }

  isQualified(record: SkillRecord, seen = new Set<string>()): boolean {
    const key = `${record.summary.id}@${record.summary.version}`;
    if (seen.has(key) || record.summary.status !== 'approved' || !record.summary.quality.automated.passed || !record.summary.quality.review) return false;
    const evaluationId = record.summary.quality.evaluation?.evaluationId;
    const evaluation = this.evaluations(record.summary.id, record.summary.version).find(item => item.id === evaluationId && item.finalDigest === record.summary.digest);
    if (!evaluation || !this.evaluationPasses(record, evaluation)) return false;
    const chain = new Set([...seen, key]);
    return record.summary.dependencies.every(dependency => {
      const target = this.getSkill(dependency.id, dependency.version);
      return Boolean(target && this.isQualified(target, chain));
    });
  }

  addEvaluation(id: string, version: string, input: EvaluationInput): Evaluation {
    return this.transaction(() => {
      const record = this.getSkill(id, version);
      if (!record) throw new RegistryStoreError(404, 'skill_not_found', 'Skill version was not found');
      if (record.summary.status === 'rejected' || record.summary.status === 'revoked' || this.isQualified(record)) throw new RegistryStoreError(409, 'evaluation_closed', 'This version cannot receive further evaluation records');
      if (input.contentHash !== contentHash(record.bundle)) throw new RegistryStoreError(409, 'content_hash_mismatch', 'Evaluation does not match immutable submitted content');
      if (input.hostChecks.some(check => !record.summary.hosts.includes(check.host))) throw new RegistryStoreError(422, 'undeclared_test_host', 'Host evidence must refer to a declared host');
      if (Date.parse(input.testedAt) > Date.now() + 60_000) throw new RegistryStoreError(422, 'future_evaluation', 'Test time cannot be in the future');
      const evaluationId = randomUUID();
      const createdAt = new Date().toISOString();
      this.database.prepare('INSERT INTO evaluations (id, skill_id, version, content_hash, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(evaluationId, id, version, input.contentHash, stringify(input), createdAt);
      this.audit('skill.evaluated', `${id}@${version}`, { evaluationId, kind: input.kind, tester: input.tester, contentHash: input.contentHash }, createdAt);
      return this.evaluations(id, version).find(item => item.id === evaluationId)!;
    });
  }

  versionSummaries(id?: string): SkillVersionSummary[] {
    return this.listSkills().filter(record => (!id || record.summary.id === id) && ['approved', 'revoked'].includes(record.summary.status)).map(record => ({
      id: record.summary.id, version: record.summary.version, name: record.summary.name,
      digest: record.summary.digest, status: record.summary.status,
      qualification: record.summary.status === 'revoked' ? 'revoked' as const : this.isQualified(record) ? 'qualified' as const : 'needs-testing' as const,
      ...(record.summary.status === 'revoked' ? { reason: record.revocationReason ?? 'Version revoked' } : !this.isQualified(record) ? { reason: '待人工补测：版本尚无完整、绑定当前内容的人工实测审批证据。' } : {}),
      hosts: record.summary.hosts, dependencies: record.summary.dependencies,
      ...(record.summary.release ? { release: record.summary.release } : {}), createdAt: record.summary.createdAt,
    })).sort((a, b) => a.id.localeCompare(b.id) || compareVersions(b.version, a.version));
  }

  adminSkillDetail(id: string, version: string): unknown {
    const record = this.getSkill(id, version);
    if (!record) throw new RegistryStoreError(404, 'skill_not_found', 'Skill version was not found');
    const previous = this.listSkills().filter(item => item.summary.id === id && compareVersions(item.summary.version, version) < 0).sort((a, b) => compareVersions(b.summary.version, a.summary.version))[0];
    const files = record.bundle.files;
    const before = previous?.bundle.files ?? {};
    const reviews = this.database.prepare('SELECT action, reviewer, notes, created_at AS createdAt FROM reviews WHERE skill_id = ? AND version = ? ORDER BY id DESC').all(id, version);
    return { skill: { ...record.summary, qualification: record.summary.status === 'revoked' ? 'revoked' : this.isQualified(record) ? 'qualified' : 'needs-testing' }, manifest: record.bundle.manifest, files, contentHash: contentHash(record.bundle), evaluations: this.evaluations(id, version), reviews,
      diff: { baseVersion: previous?.summary.version ?? null, added: Object.keys(files).filter(path => !Object.hasOwn(before, path)), removed: Object.keys(before).filter(path => !Object.hasOwn(files, path)), changed: Object.keys(files).filter(path => Object.hasOwn(before, path) && before[path] !== files[path]).map(path => ({ path, before: before[path], after: files[path] })) } };
  }

  listApproved(): SkillRecord[] {
    const rows = this.database.prepare("SELECT * FROM skills WHERE status = 'approved'").all() as unknown as SkillRow[];
    return rows.map(skillRowToRecord).filter(record => this.isQualified(record)).map(record => ({ ...record, summary: { ...record.summary, qualification: 'qualified' as const } })).sort((left, right) => {
      const idOrder = left.summary.id.localeCompare(right.summary.id, 'en');
      return idOrder || compareVersions(right.summary.version, left.summary.version);
    });
  }

  listLatestApproved(): SkillRecord[] {
    const latest = new Map<string, SkillRecord>();
    for (const record of this.listApproved()) {
      const previous = latest.get(record.summary.id);
      if (!previous || compareVersions(record.summary.version, previous.summary.version) > 0) latest.set(record.summary.id, record);
    }
    return [...latest.values()];
  }

  getPublicSkill(id: string, version?: string): { record: SkillRecord | null; revoked: boolean } {
    if (version) {
      const record = this.getSkill(id, version);
      if (!record) return { record: null, revoked: false };
      if (record.summary.status === 'revoked') return { record: null, revoked: true };
      return { record: this.isQualified(record) ? { ...record, summary: { ...record.summary, qualification: 'qualified' } } : null, revoked: false };
    }
    const records = this.listApproved().filter(record => record.summary.id === id);
    if (records.length > 0) return { record: records.sort((a, b) => compareVersions(b.summary.version, a.summary.version))[0]!, revoked: false };
    const anyRevoked = this.database.prepare("SELECT 1 AS found FROM skills WHERE id = ? AND status = 'revoked' LIMIT 1").get(id);
    return { record: null, revoked: Boolean(anyRevoked) };
  }

  getApprovedByDigest(digest: string): SkillRecord | null {
    const row = this.database.prepare("SELECT * FROM skills WHERE digest = ? AND status = 'approved' LIMIT 1").get(digest) as SkillRow | undefined;
    const record = row ? skillRowToRecord(row) : null;
    return record && this.isQualified(record) ? record : null;
  }

  qualificationProof(digest: string, now = new Date().toISOString()): QualificationProof | null {
    const row = this.database.prepare("SELECT * FROM skills WHERE digest = ? AND status IN ('approved', 'revoked') LIMIT 1").get(digest) as SkillRow | undefined;
    if (!row) return null;
    const record = skillRowToRecord(row);
    const qualified = this.isQualified(record);
    return { id: record.summary.id, version: record.summary.version, digest, contentHash: contentHash(record.bundle),
      qualification: record.summary.status === 'revoked' ? 'revoked' : qualified ? 'qualified' : 'needs-testing',
      ...(qualified && record.summary.quality.evaluation ? { evaluation: record.summary.quality.evaluation } : {}),
      generatedAt: now, expiresAt: new Date(Date.parse(now) + 15 * 60_000).toISOString() };
  }

  private cascadeDependencyRevocations(
    rootId: string,
    rootVersion: string,
    rootReason: string,
    revokedAt: string,
  ): void {
    const revoked = new Set([`${rootId}@${rootVersion}`]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const dependent of this.listSkills().filter(record => record.summary.status === 'approved')) {
        const failedDependency = dependent.summary.dependencies.find(dependency => revoked.has(`${dependency.id}@${dependency.version}`));
        if (!failedDependency) continue;
        const key = `${dependent.summary.id}@${dependent.summary.version}`;
        const reason = `Dependency ${failedDependency.id}@${failedDependency.version} was revoked: ${rootReason}`;
        this.database.prepare(`
          UPDATE skills SET status = 'revoked', revoked_at = ?, revocation_reason = ?,
            reviewed_at = ?, reviewer = ?, review_notes = ?
          WHERE id = ? AND version = ? AND status = 'approved'
        `).run(
          revokedAt,
          reason,
          revokedAt,
          'system:dependency-revocation',
          reason,
          dependent.summary.id,
          dependent.summary.version,
        );
        this.database.prepare('INSERT INTO reviews (skill_id, version, action, reviewer, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(dependent.summary.id, dependent.summary.version, 'revoke', 'system:dependency-revocation', reason, revokedAt);
        this.audit('skill.revoke.dependency', key, {
          dependency: `${failedDependency.id}@${failedDependency.version}`,
          root: `${rootId}@${rootVersion}`,
        }, revokedAt);
        revoked.add(key);
        changed = true;
      }
    }
  }

  reviewSkill(
    id: string,
    version: string,
    action: 'approve' | 'reject' | 'revoke',
    reviewer: string,
    notes: string,
    reviewedAt = new Date().toISOString(),
  ): SkillRecord {
    return this.transaction(() => {
      const current = this.getSkill(id, version);
      if (!current) throw new RegistryStoreError(404, 'skill_not_found', 'Skill version was not found');
      if (!notes.trim()) throw new RegistryStoreError(422, 'review_reason_required', 'Every review requires a reason');

      if (action === 'approve') {
        const historicalRetest = current.summary.status === 'approved' && !this.isQualified(current);
        if (current.summary.status !== 'pending' && !historicalRetest) {
          throw new RegistryStoreError(409, 'invalid_review_transition', 'Only pending versions or historical approvals awaiting testing can be approved');
        }
        if (!current.summary.quality.automated.passed) {
          throw new RegistryStoreError(409, 'automated_checks_failed', 'A version with failed automated checks cannot be approved');
        }
        for (const dependency of current.summary.dependencies) {
          const dependencyRecord = this.getSkill(dependency.id, dependency.version);
          if (!dependencyRecord || !this.isQualified(dependencyRecord)) {
            throw new RegistryStoreError(409, 'dependency_unavailable', `Dependency ${dependency.id}@${dependency.version} is not approved`);
          }
        }
        const evaluation = this.evaluations(id, version).find(item => item.kind === 'human');
        if (!evaluation || !this.evaluationPasses(current, evaluation)) throw new RegistryStoreError(409, 'human_testing_required', 'Approval requires the latest human record to pass purpose, boundary and every declared host installation/read check for this content hash');
        if (!historicalRetest && !current.bundle.manifest.release) throw new RegistryStoreError(409, 'release_metadata_required', 'Release metadata is required');
        const quality: QualityEvidence = {
          automated: current.summary.quality.automated,
          review: { reviewer: 'SkillFlux operator', reviewedAt, notes: evaluation.publicSummary },
          evaluation: { evaluationId: evaluation.id, contentHash: evaluation.contentHash, testedAt: evaluation.testedAt, summary: evaluation.publicSummary, hosts: evaluation.hostChecks.map(item => item.host), purposePassed: true, boundaryPassed: true },
        };
        const bundle: Bundle = historicalRetest ? current.bundle : {
          manifest: { ...current.bundle.manifest, quality },
          files: current.bundle.files,
        };
        const digest = historicalRetest ? current.summary.digest : bundleDigest(bundle);
        const size = historicalRetest ? current.summary.size : Buffer.byteLength(canonical(bundle));
        if (historicalRetest) {
          // Historical signed bytes are immutable. Only the external assessment is updated.
          this.database.prepare('UPDATE skills SET quality_json = ?, reviewed_at = ?, reviewer = ?, review_notes = ? WHERE id = ? AND version = ?')
            .run(stringify(quality), reviewedAt, reviewer, notes, id, version);
        } else this.database.prepare(`
          UPDATE skills SET status = 'approved', quality_json = ?, digest = ?, size = ?,
            bundle_json = ?, reviewed_at = ?, reviewer = ?, review_notes = ?
          WHERE id = ? AND version = ?
        `).run(stringify(quality), digest, size, stringify(bundle), reviewedAt, reviewer, notes, id, version);
        this.database.prepare('UPDATE evaluations SET final_digest = ? WHERE id = ?').run(digest, evaluation.id);
      } else if (action === 'reject') {
        if (current.summary.status !== 'pending') {
          throw new RegistryStoreError(409, 'invalid_review_transition', 'Only pending versions can be rejected');
        }
        this.database.prepare(`
          UPDATE skills SET status = 'rejected', reviewed_at = ?, reviewer = ?, review_notes = ?
          WHERE id = ? AND version = ?
        `).run(reviewedAt, reviewer, notes, id, version);
      } else {
        if (current.summary.status !== 'approved') {
          throw new RegistryStoreError(409, 'invalid_review_transition', 'Only approved versions can be revoked');
        }
        if (!notes.trim()) throw new RegistryStoreError(422, 'revocation_reason_required', 'Revocation requires a reason');
        this.database.prepare(`
          UPDATE skills SET status = 'revoked', revoked_at = ?, revocation_reason = ?,
            reviewed_at = ?, reviewer = ?, review_notes = ?
          WHERE id = ? AND version = ?
        `).run(reviewedAt, notes, reviewedAt, reviewer, notes, id, version);
        this.cascadeDependencyRevocations(id, version, notes, reviewedAt);
      }

      this.database.prepare('INSERT INTO reviews (skill_id, version, action, reviewer, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, version, action, reviewer, notes, reviewedAt);
      this.audit(`skill.${action}`, `${id}@${version}`, { reviewer, notes }, reviewedAt);
      return this.getSkill(id, version)!;
    });
  }

  listRevocations(): Array<{ id: string; version: string; digest: string; reason: string; revokedAt: string }> {
    const rows = this.database.prepare(`
      SELECT id, version, digest, revocation_reason, revoked_at
      FROM skills WHERE status = 'revoked' ORDER BY revoked_at DESC, id ASC
    `).all() as unknown as Array<{
      id: string;
      version: string;
      digest: string;
      revocation_reason: string;
      revoked_at: string;
    }>;
    return rows.map(row => ({
      id: row.id,
      version: row.version,
      digest: row.digest,
      reason: row.revocation_reason,
      revokedAt: row.revoked_at,
    }));
  }

  createCampaign(input: CampaignInput, createdAt = new Date().toISOString()): Campaign {
    const id = randomUUID();
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO campaigns (
          id, name, sponsor, text, url, categories_json, active, budget_cents,
          cpc_cents, daily_cap, starts_at, ends_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.name, input.sponsor, input.text, input.url, stringify([...new Set(input.categories)]),
        input.active ? 1 : 0, input.budgetCents, input.cpcCents, input.dailyCap,
        input.startsAt, input.endsAt, createdAt,
      );
      this.audit('campaign.created', id, { sponsor: input.sponsor, active: input.active, budgetCents: input.budgetCents }, createdAt);
    });
    return this.getCampaign(id)!;
  }

  getCampaign(id: string): Campaign | null {
    const row = this.database.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as CampaignRow | undefined;
    return row ? campaignRowToCampaign(row) : null;
  }

  updateCampaign(id: string, input: CampaignInput, updatedAt = new Date().toISOString()): Campaign {
    return this.transaction(() => {
      this.releaseExpiredReservations(updatedAt);
      const current = this.getCampaign(id);
      if (!current) throw new RegistryStoreError(404, 'campaign_not_found', 'Campaign was not found');
      if (!input.active) this.invalidateCampaignDecisions(id, updatedAt);
      const internal = this.database.prepare('SELECT spent_cents, reserved_cents FROM campaigns WHERE id = ?').get(id) as {
        spent_cents: number;
        reserved_cents: number;
      };
      if (input.budgetCents < Number(internal.spent_cents) + Number(internal.reserved_cents)) {
        throw new RegistryStoreError(409, 'budget_below_commitments', 'Budget cannot be lower than recorded spend plus active click reservations');
      }
      const result = this.database.prepare(`
        UPDATE campaigns SET name = ?, sponsor = ?, text = ?, url = ?, categories_json = ?,
          active = ?, budget_cents = ?, cpc_cents = ?, daily_cap = ?, starts_at = ?, ends_at = ?
        WHERE id = ?
      `).run(
        input.name, input.sponsor, input.text, input.url, stringify([...new Set(input.categories)]),
        input.active ? 1 : 0, input.budgetCents, input.cpcCents, input.dailyCap,
        input.startsAt, input.endsAt, id,
      );
      if (Number(result.changes) !== 1) throw new RegistryStoreError(404, 'campaign_not_found', 'Campaign was not found');
      this.audit('campaign.updated', id, { active: input.active, budgetCents: input.budgetCents }, updatedAt);
      return this.getCampaign(id)!;
    });
  }

  listCampaigns(): Campaign[] {
    this.expireAdReservations();
    const rows = this.database.prepare('SELECT * FROM campaigns ORDER BY created_at DESC, id ASC').all() as unknown as CampaignRow[];
    return rows.map(campaignRowToCampaign);
  }

  expireAdReservations(now = new Date().toISOString()): void { this.transaction(() => this.releaseExpiredReservations(now)); }

  private invalidateCampaignDecisions(id: string, now: string): void {
    const row = this.database.prepare('SELECT COALESCE(SUM(reservation_cents), 0) AS amount FROM ad_decisions WHERE campaign_id = ? AND clicked_at IS NULL AND reservation_released = 0').get(id) as { amount: number };
    this.database.prepare('UPDATE campaigns SET reserved_cents = MAX(0, reserved_cents - ?) WHERE id = ?').run(Number(row.amount), id);
    this.database.prepare('UPDATE ad_decisions SET invalidated_at = ?, reservation_released = 1 WHERE campaign_id = ? AND clicked_at IS NULL AND invalidated_at IS NULL').run(now, id);
  }

  private releaseExpiredReservations(now: string): void {
    const expired = this.database.prepare(`
      SELECT campaign_id, SUM(reservation_cents) AS amount
      FROM ad_decisions
      WHERE campaign_id IS NOT NULL AND reservation_released = 0 AND clicked_at IS NULL AND expires_at <= ?
      GROUP BY campaign_id
    `).all(now) as unknown as Array<{ campaign_id: string; amount: number }>;
    for (const row of expired) {
      this.database.prepare(`
        UPDATE campaigns SET reserved_cents = MAX(0, reserved_cents - ?) WHERE id = ?
      `).run(Number(row.amount), row.campaign_id);
    }
    this.database.prepare(`
      UPDATE ad_decisions SET reservation_released = 1
      WHERE campaign_id IS NOT NULL AND reservation_released = 0 AND clicked_at IS NULL AND expires_at <= ?
    `).run(now);
  }

  listEligibleCampaigns(category: string, excluded: Set<string>, now = new Date().toISOString()): CampaignCandidate[] {
    this.transaction(() => this.releaseExpiredReservations(now));
    const startOfDay = `${now.slice(0, 10)}T00:00:00.000Z`;
    const rows = this.database.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM ad_decisions d WHERE d.campaign_id = c.id AND d.house = 0 AND d.created_at >= ? AND d.created_at < ?) AS decisions_today
      FROM campaigns c
      WHERE c.active = 1 AND c.starts_at <= ? AND c.ends_at > ?
    `).all(startOfDay, new Date(Date.parse(startOfDay) + 86_400_000).toISOString(), now, now) as unknown as Array<CampaignRow & { decisions_today: number }>;
    return rows
      .filter(row => {
        const categories = parseJson<string[]>(row.categories_json);
        return !excluded.has(row.id)
          && (categories.length === 0 || categories.includes('*') || categories.includes(category))
          && Number(row.spent_cents) + Number(row.reserved_cents) + Number(row.cpc_cents) <= Number(row.budget_cents)
          && Number(row.decisions_today) < Number(row.daily_cap);
      })
      .map(row => ({
        ...campaignRowToCampaign(row),
        reservedCents: Number(row.reserved_cents),
        lastServedAt: row.last_served_at,
        decisionsToday: Number(row.decisions_today),
      }))
      .sort((left, right) => {
        if (left.decisionsToday !== right.decisionsToday) return left.decisionsToday - right.decisionsToday;
        const leftRatio = (left.spentCents + left.reservedCents) / Math.max(1, left.budgetCents);
        const rightRatio = (right.spentCents + right.reservedCents) / Math.max(1, right.budgetCents);
        if (leftRatio !== rightRatio) return leftRatio - rightRatio;
        return (left.lastServedAt ?? '').localeCompare(right.lastServedAt ?? '') || left.id.localeCompare(right.id);
      });
  }

  getDecisionByRequestId(requestId: string): StoredDecision | null {
    const row = this.database.prepare('SELECT * FROM ad_decisions WHERE request_id = ?').get(requestId) as DecisionRow | undefined;
    return row ? this.decisionRowToStored(row) : null;
  }

  getDecisionByTokenHash(tokenHash: string): StoredDecision | null {
    const row = this.database.prepare('SELECT * FROM ad_decisions WHERE token_hash = ?').get(tokenHash) as DecisionRow | undefined;
    return row ? this.decisionRowToStored(row) : null;
  }

  private decisionRowToStored(row: DecisionRow): StoredDecision {
    const signed = parseJson<{ payload: AdDecision }>(row.signed_json);
    return {
      decision: signed.payload,
      signed,
      requestHash: row.request_hash,
      tokenHash: row.token_hash,
      targetUrl: row.target_url,
      clickedAt: row.clicked_at,
      campaignId: row.campaign_id,
      house: Boolean(row.house),
      invalidatedAt: row.invalidated_at,
    };
  }

  storeDecision(input: {
    decision: AdDecision;
    signed: unknown;
    requestId: string;
    requestHash: string;
    targetUrl: string;
    campaign: Campaign | null;
    createdAt: string;
  }): StoredDecision {
    return this.transaction(() => {
      this.releaseExpiredReservations(input.createdAt);
      const existing = this.getDecisionByRequestId(input.requestId);
      if (existing) {
        if (existing.requestHash !== input.requestHash) {
          throw new RegistryStoreError(409, 'request_id_reused', 'requestId was already used for different ad inputs');
        }
        if (existing.invalidatedAt) throw new RegistryStoreError(410, 'decision_invalidated', 'Ad decision has been permanently invalidated');
        if (existing.decision.expiresAt <= input.createdAt) throw new RegistryStoreError(410, 'decision_expired', 'Ad decision has expired');
        return existing;
      }
      let reservationCents = 0;
      if (input.campaign) {
        const campaign = this.getCampaign(input.campaign.id);
        if (!campaign || !campaign.active) throw new RegistryStoreError(409, 'campaign_unavailable', 'Campaign is no longer active');
        const day = `${input.createdAt.slice(0, 10)}T00:00:00.000Z`;
        const nextDay = new Date(Date.parse(day) + 86_400_000).toISOString();
        const count = this.database.prepare('SELECT COUNT(*) AS count FROM ad_decisions WHERE campaign_id = ? AND house = 0 AND created_at >= ? AND created_at < ?').get(campaign.id, day, nextDay) as { count: number };
        if (Number(count.count) >= campaign.dailyCap) throw new RegistryStoreError(409, 'campaign_daily_cap', 'Campaign daily decision cap has been reached');
        if (campaign.startsAt > input.createdAt || campaign.endsAt <= input.createdAt) throw new RegistryStoreError(409, 'campaign_unavailable', 'Campaign is outside its serving window');
        if (campaign.cpcCents !== input.campaign.cpcCents || campaign.url !== input.targetUrl || campaign.text !== input.decision.text) throw new RegistryStoreError(409, 'campaign_changed', 'Campaign changed while preparing this decision');
        const update = this.database.prepare(`
          UPDATE campaigns SET reserved_cents = reserved_cents + cpc_cents, last_served_at = ?
          WHERE id = ? AND active = 1 AND spent_cents + reserved_cents + cpc_cents <= budget_cents
        `).run(input.createdAt, campaign.id);
        if (Number(update.changes) !== 1) throw new RegistryStoreError(409, 'campaign_budget_unavailable', 'Campaign budget is no longer available');
        reservationCents = campaign.cpcCents;
      }
      const tokenHash = sha256(input.decision.token);
      this.database.prepare(`
        INSERT INTO ad_decisions (
          id, request_id, request_hash, campaign_id, creative_id, disclosure, text,
          target_url, expires_at, token, token_hash, house, signed_json, created_at,
          reservation_cents
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.decision.decisionId,
        input.requestId,
        input.requestHash,
        input.campaign?.id ?? null,
        input.decision.creativeId,
        input.decision.disclosure,
        input.decision.text,
        input.targetUrl,
        input.decision.expiresAt,
        input.decision.token,
        tokenHash,
        input.decision.house ? 1 : 0,
        stringify(input.signed),
        input.createdAt,
        reservationCents,
      );
      return this.getDecisionByTokenHash(tokenHash)!;
    });
  }

  recordEvent(input: {
    eventId: string;
    tokenHash: string;
    decisionId: string;
    type: 'impression' | 'hide' | 'report';
    reason?: string;
    createdAt?: string;
  }): { duplicate: boolean } {
    return this.transaction(() => {
      const now = input.createdAt ?? new Date().toISOString();
      const decision = this.database.prepare('SELECT invalidated_at, token_hash, expires_at FROM ad_decisions WHERE id = ?').get(input.decisionId) as { invalidated_at: string | null; token_hash: string; expires_at: string } | undefined;
      if (!decision || decision.invalidated_at) throw new RegistryStoreError(410, 'decision_invalidated', 'Ad decision has been permanently invalidated');
      if (decision.token_hash !== input.tokenHash) throw new RegistryStoreError(401, 'invalid_decision_token', 'Event token does not match the decision');
      if (decision.expires_at <= now) throw new RegistryStoreError(410, 'decision_expired', 'Ad decision has expired');
      const reasonHash = sha256(input.reason ?? '');
      const receipt = this.database.prepare('SELECT token_hash, type, reason_hash FROM event_receipts WHERE event_id = ?').get(input.eventId) as { token_hash: string; type: string; reason_hash: string } | undefined;
      if (receipt) {
        if (receipt.token_hash !== input.tokenHash || receipt.type !== input.type || receipt.reason_hash !== reasonHash) throw new RegistryStoreError(409, 'event_id_reused', 'eventId was already used for different event inputs');
        return { duplicate: true };
      }
      const existingEvent = this.database.prepare('SELECT event_id, token_hash, type, reason FROM events WHERE event_id = ?').get(input.eventId) as {
        event_id: string;
        token_hash: string;
        type: string;
        reason: string | null;
      } | undefined;
      if (existingEvent) {
        if (existingEvent.token_hash !== input.tokenHash || existingEvent.type !== input.type || sha256(existingEvent.reason ?? '') !== reasonHash) {
          throw new RegistryStoreError(409, 'event_id_reused', 'eventId was already used for another event');
        }
        return { duplicate: true };
      }
      this.database.prepare('INSERT INTO event_receipts (event_id, decision_id, token_hash, type, reason_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(input.eventId, input.decisionId, input.tokenHash, input.type, reasonHash, now);
      const sameType = this.database.prepare('SELECT 1 AS found FROM events WHERE decision_id = ? AND type = ?').get(input.decisionId, input.type);
      if (sameType) return { duplicate: true };
      this.database.prepare(`
        INSERT INTO events (event_id, decision_id, token_hash, type, reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(input.eventId, input.decisionId, input.tokenHash, input.type, input.reason ?? null, now);
      if (input.type === 'report') {
        const stored = this.getDecisionByTokenHash(input.tokenHash);
        if (stored?.campaignId) this.insertReport({ requestId: input.eventId, campaignId: stored.campaignId, reason: input.reason ?? '' }, input.decisionId, input.createdAt);
      }
      return { duplicate: false };
    });
  }

  consumeClick(tokenHash: string, now = new Date().toISOString()): { url: string; billed: boolean } {
    // Expiry is maintenance, not part of a click attempt that may be rejected and rolled back.
    this.expireAdReservations(now);
    return this.transaction(() => {
      const row = this.database.prepare('SELECT * FROM ad_decisions WHERE token_hash = ?').get(tokenHash) as DecisionRow | undefined;
      if (!row) throw new RegistryStoreError(404, 'decision_not_found', 'Ad decision was not found');
      if (row.invalidated_at) throw new RegistryStoreError(410, 'decision_invalidated', 'Ad decision has been permanently invalidated');
      if (row.expires_at <= now) throw new RegistryStoreError(410, 'decision_expired', 'Ad decision has expired');
      if (row.clicked_at) throw new RegistryStoreError(410, 'decision_replayed', 'Ad click token has already been used');

      let billed = false;
      if (row.campaign_id) {
        const campaignRow = this.database.prepare('SELECT * FROM campaigns WHERE id = ?').get(row.campaign_id) as CampaignRow | undefined;
        if (!campaignRow || !campaignRow.active) {
          if (!row.reservation_released) {
            this.database.prepare('UPDATE campaigns SET reserved_cents = MAX(0, reserved_cents - ?) WHERE id = ?')
              .run(Number(row.reservation_cents), row.campaign_id);
            this.database.prepare('UPDATE ad_decisions SET reservation_released = 1 WHERE id = ?').run(row.id);
          }
          throw new RegistryStoreError(410, 'campaign_inactive', 'Campaign is no longer active');
        }
        this.database.prepare(`
          UPDATE campaigns SET reserved_cents = MAX(0, reserved_cents - ?), spent_cents = spent_cents + ?
          WHERE id = ?
        `).run(Number(row.reservation_cents), Number(row.reservation_cents), row.campaign_id);
        this.database.prepare(`
          INSERT INTO ledger (campaign_id, decision_id, kind, amount_cents, created_at)
          VALUES (?, ?, 'click', ?, ?)
        `).run(row.campaign_id, row.id, Number(row.reservation_cents), now);
        billed = true;
      }
      this.database.prepare(`
        UPDATE ad_decisions SET clicked_at = ?, reservation_released = 1 WHERE id = ?
      `).run(now, row.id);
      return { url: row.target_url, billed };
    });
  }

  metrics(): Metrics {
    const skills: Record<string, number> = { pending: 0, approved: 0, rejected: 0, revoked: 0 };
    const skillRows = this.database.prepare('SELECT status, COUNT(*) AS count FROM skills GROUP BY status').all() as unknown as Array<{ status: string; count: number }>;
    for (const row of skillRows) skills[row.status] = Number(row.count);
    const scalar = (query: string): number => {
      const row = this.database.prepare(query).get() as { value: number | null };
      return Number(row.value ?? 0);
    };
    return {
      skills,
      campaigns: scalar('SELECT COUNT(*) AS value FROM campaigns'),
      decisions: scalar('SELECT COUNT(*) AS value FROM ad_decisions'),
      impressions: scalar("SELECT COUNT(*) AS value FROM events WHERE type = 'impression'"),
      clicks: scalar("SELECT COUNT(*) AS value FROM ledger WHERE kind = 'click'"),
      spentCents: scalar("SELECT COALESCE(SUM(amount_cents), 0) AS value FROM ledger WHERE kind = 'click'"),
      reports: scalar('SELECT COUNT(*) AS value FROM ad_reports'),
    };
  }

  submitInquiry(input: InquiryInput): { id: string; duplicate: boolean } {
    this.purgeInquiryPII();
    return this.transaction(() => {
      const hash = sha256(stringify(input));
      const existing = this.database.prepare('SELECT id, request_hash FROM inquiries WHERE request_id = ?').get(input.requestId) as { id: string; request_hash: string } | undefined;
      if (existing) {
        if (existing.request_hash !== hash) throw new RegistryStoreError(409, 'request_id_reused', 'Request identifier was reused with different content');
        return { id: existing.id, duplicate: true };
      }
      const id = randomUUID(), now = new Date().toISOString();
      this.database.prepare("INSERT INTO inquiries (id, request_id, request_hash, data_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'new', ?, ?)").run(id, input.requestId, hash, stringify({ ...input, notes: '', operator: '' }), now, now);
      this.audit('inquiry.created', id);
      return { id, duplicate: false };
    });
  }

  purgeInquiryPII(now = new Date().toISOString()): number {
    const cutoff = new Date(Date.parse(now) - 180 * 86_400_000).toISOString();
    return this.transaction(() => {
      const rows = this.database.prepare("SELECT id FROM inquiries WHERE status IN ('completed', 'invalid') AND closed_at <= ? AND purged_at IS NULL").all(cutoff) as Array<{ id: string }>;
      for (const row of rows) {
        this.database.prepare('UPDATE inquiries SET data_json = ?, purged_at = ?, updated_at = ? WHERE id = ?').run(stringify({ requestId: '', name: '', contact: '', company: '', product: '', website: '', message: '', consent: true, notes: '', operator: '' }), now, now, row.id);
        this.audit('inquiry.pii_purged', row.id, { retentionDays: 180 }, now);
      }
      return rows.length;
    });
  }

  listInquiries(): Inquiry[] {
    this.purgeInquiryPII();
    const rows = this.database.prepare('SELECT * FROM inquiries ORDER BY created_at DESC, id').all() as Array<{ id: string; data_json: string; status: Inquiry['status']; created_at: string; updated_at: string; closed_at: string | null; purged_at: string | null }>;
    return rows.map(row => ({ ...parseJson<InquiryInput & { operator: string; notes: string }>(row.data_json), id: row.id, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, closedAt: row.closed_at, purgedAt: row.purged_at }));
  }

  updateInquiry(id: string, input: { status: Inquiry['status']; operator: string; notes: string }): Inquiry {
    this.purgeInquiryPII();
    this.transaction(() => {
      const row = this.database.prepare('SELECT * FROM inquiries WHERE id = ?').get(id) as { data_json: string; purged_at: string | null; closed_at: string | null; status: string } | undefined;
      if (!row) throw new RegistryStoreError(404, 'inquiry_not_found', 'Inquiry was not found');
      if (row.purged_at) throw new RegistryStoreError(409, 'inquiry_purged', 'Purged inquiries cannot be reopened');
      const now = new Date().toISOString();
      const closed = ['completed', 'invalid'].includes(input.status);
      const closedAt = closed ? row.closed_at ?? now : null;
      this.database.prepare('UPDATE inquiries SET data_json = ?, status = ?, updated_at = ?, closed_at = ? WHERE id = ?').run(stringify({ ...parseJson<object>(row.data_json), notes: input.notes, operator: input.operator }), input.status, now, closedAt, id);
      this.audit('inquiry.updated', id, { status: input.status, operator: input.operator }, now);
    });
    return this.listInquiries().find(item => item.id === id)!;
  }

  private insertReport(input: { requestId: string; campaignId: string; reason: string }, decisionId: string | null = null, createdAt = new Date().toISOString()): { id: string; duplicate: boolean } {
    const hash = sha256(stringify(input));
    const existing = this.database.prepare('SELECT id, request_hash FROM ad_reports WHERE request_id = ?').get(input.requestId) as { id: string; request_hash: string } | undefined;
    if (existing) {
      if (existing.request_hash !== hash) throw new RegistryStoreError(409, 'request_id_reused', 'Request identifier was reused with different content');
      return { id: existing.id, duplicate: true };
    }
    if (!this.getCampaign(input.campaignId)) throw new RegistryStoreError(404, 'campaign_not_found', 'Campaign was not found');
    const id = randomUUID();
    this.database.prepare('INSERT INTO ad_reports (id, request_id, request_hash, campaign_id, decision_id, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, input.requestId, hash, input.campaignId, decisionId, input.reason, createdAt, createdAt);
    this.audit('report.created', id, { campaignId: input.campaignId }, createdAt);
    return { id, duplicate: false };
  }

  submitReport(input: { requestId: string; campaignId: string; reason: string }): { id: string; duplicate: boolean } { return this.transaction(() => this.insertReport(input)); }

  listReports(): AdReport[] {
    const rows = this.database.prepare('SELECT * FROM ad_reports ORDER BY created_at DESC, id').all() as Array<{ id: string; campaign_id: string; decision_id: string | null; reason: string; status: AdReport['status']; created_at: string; updated_at: string; operator: string; notes: string }>;
    return rows.map(row => ({ id: row.id, campaignId: row.campaign_id, decisionId: row.decision_id, reason: row.reason, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, operator: row.operator, notes: row.notes }));
  }

  getReport(id: string): AdReport | null {
    const report = this.listReports().find(item => item.id === id);
    return report ? { ...report, campaign: this.getCampaign(report.campaignId) } : null;
  }

  resolveReport(id: string, input: { action: 'dismiss' | 'pause'; operator: string; notes: string }): AdReport {
    return this.transaction(() => {
      const report = this.getReport(id);
      if (!report) throw new RegistryStoreError(404, 'report_not_found', 'Report was not found');
      if (report.status !== 'new') throw new RegistryStoreError(409, 'report_resolved', 'Report was already resolved');
      const now = new Date().toISOString();
      if (input.action === 'pause') {
        this.invalidateCampaignDecisions(report.campaignId, now);
        this.database.prepare('UPDATE campaigns SET active = 0 WHERE id = ?').run(report.campaignId);
        this.audit('campaign.paused_by_report', report.campaignId, { reportId: id, operator: input.operator }, now);
      }
      this.database.prepare('UPDATE ad_reports SET status = ?, updated_at = ?, operator = ?, notes = ? WHERE id = ?').run(input.action === 'pause' ? 'paused' : 'dismissed', now, input.operator, input.notes, id);
      this.audit('report.resolved', id, input, now);
      return this.getReport(id)!;
    });
  }

  metricsByPeriod(from: string, to: string, campaignId?: string, groupBy: 'day' | 'campaign' = 'day'): Metrics & { rows: MetricRow[]; from: string; to: string; paidDecisions: number; houseDecisions: number } {
    this.expireAdReservations();
    return this.transaction(() => {
    const start = `${from}T00:00:00.000Z`, end = new Date(Date.parse(`${to}T00:00:00.000Z`) + 86_400_000).toISOString();
    const rows = new Map<string, MetricRow>();
    const names = new Map((this.database.prepare('SELECT id, name FROM campaigns').all() as Array<{ id: string; name: string }>).map(item => [item.id, item.name]));
    const add = (date: string, id: string | null, field: 'decisions' | 'impressions' | 'clicks' | 'spentCents' | 'reports' | 'clickedImpressions', value: number) => {
      const normalizedId = id ?? 'house';
      if (campaignId && normalizedId !== campaignId) return;
      const day = groupBy === 'day' ? date.slice(0, 10) : '';
      const key = `${day}:${normalizedId}`;
      const row = rows.get(key) ?? { date: day, campaignId: normalizedId, name: id ? names.get(id) ?? id : 'SkillFlux house', decisions: 0, impressions: 0, clicks: 0, spentCents: 0, reports: 0, clickedImpressions: 0, ctr: null };
      row[field] += value; rows.set(key, row);
    };
    for (const row of this.database.prepare('SELECT created_at, campaign_id FROM ad_decisions WHERE created_at >= ? AND created_at < ?').all(start, end) as Array<{ created_at: string; campaign_id: string | null }>) add(row.created_at, row.campaign_id, 'decisions', 1);
    for (const row of this.database.prepare("SELECT e.created_at, d.campaign_id FROM events e JOIN ad_decisions d ON d.id = e.decision_id WHERE e.type = 'impression' AND e.created_at >= ? AND e.created_at < ?").all(start, end) as Array<{ created_at: string; campaign_id: string | null }>) add(row.created_at, row.campaign_id, 'impressions', 1);
    // CTR groups by the first impression's UTC date. A later click belongs to that same impression cohort.
    for (const row of this.database.prepare("SELECT e.created_at, d.campaign_id FROM events e JOIN ad_decisions d ON d.id = e.decision_id WHERE e.type = 'impression' AND d.campaign_id IS NOT NULL AND d.clicked_at IS NOT NULL AND e.created_at >= ? AND e.created_at < ?").all(start, end) as Array<{ created_at: string; campaign_id: string }>) add(row.created_at, row.campaign_id, 'clickedImpressions', 1);
    for (const row of this.database.prepare('SELECT created_at, campaign_id, amount_cents FROM ledger WHERE created_at >= ? AND created_at < ?').all(start, end) as Array<{ created_at: string; campaign_id: string; amount_cents: number }>) { add(row.created_at, row.campaign_id, 'clicks', 1); add(row.created_at, row.campaign_id, 'spentCents', Number(row.amount_cents)); }
    for (const row of this.database.prepare('SELECT created_at, campaign_id FROM ad_reports WHERE created_at >= ? AND created_at < ?').all(start, end) as Array<{ created_at: string; campaign_id: string }>) add(row.created_at, row.campaign_id, 'reports', 1);
    const items = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date) || a.campaignId.localeCompare(b.campaignId));
    for (const row of items) row.ctr = row.campaignId !== 'house' && row.impressions > 0 ? row.clickedImpressions / row.impressions : null;
    const total = (field: keyof Pick<MetricRow, 'decisions' | 'impressions' | 'clicks' | 'spentCents' | 'reports'>) => items.reduce((sum, row) => sum + row[field], 0);
    const paidImpressions = items.filter(row => row.campaignId !== 'house').reduce((sum, row) => sum + row.impressions, 0);
    const clickedImpressions = items.reduce((sum, row) => sum + row.clickedImpressions, 0);
    return { ...this.metrics(), from, to, rows: items, decisions: total('decisions'), impressions: total('impressions'), clicks: total('clicks'), spentCents: total('spentCents'), reports: total('reports'), paidDecisions: items.filter(row => row.campaignId !== 'house').reduce((sum, row) => sum + row.decisions, 0), houseDecisions: items.filter(row => row.campaignId === 'house').reduce((sum, row) => sum + row.decisions, 0), paidImpressions, clickedImpressions, ctr: paidImpressions > 0 ? clickedImpressions / paidImpressions : null };
    }, true);
  }

  auditItems(): Array<{ id: string | number; action: string; subject: string; createdAt: string; details?: unknown }> {
    const rows = this.database.prepare('SELECT * FROM audit_log ORDER BY id DESC').all() as unknown as Array<{
      id: number;
      action: string;
      subject: string;
      created_at: string;
      details_json: string | null;
    }>;
    return rows.map(row => ({
      id: Number(row.id),
      action: row.action,
      subject: row.subject,
      createdAt: row.created_at,
      ...(row.details_json ? { details: parseJson<unknown>(row.details_json) } : {}),
    }));
  }
}
