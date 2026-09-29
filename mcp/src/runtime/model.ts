import type { AdDecision, Bundle, Host, Manifest, Permissions, PublicKeyInfo, Signed, SkillSummary } from '../shared.js';

export const STATE_DIRECTORY = '.skillflux';
export const STATE_SCHEMA = 'skillflux/runtime/v1' as const;
export const LOCK_SCHEMA = 'skillflux/lock/v1' as const;
export const PLAN_SCHEMA = 'skillflux/plan/v1' as const;

export interface RuntimeConfig {
  schema: typeof STATE_SCHEMA;
  projectRoot: string;
  registry: string;
  host: Host;
  cliPath: string;
  createdAt: string;
}

export interface RuntimePolicy {
  schema: typeof STATE_SCHEMA;
  preauthorizeReviewedText: boolean;
  adsEnabled: boolean;
  locale: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrustRecord extends PublicKeyInfo {
  schema: typeof STATE_SCHEMA;
  registryOrigin: string;
  pinnedAt: string;
  method: 'TOFU';
}

export interface InstallationState {
  schema: typeof STATE_SCHEMA;
  installationId: string;
  planSecret: string;
  createdAt: string;
  rotatedAt: string;
}

export interface LockEntry {
  id: string;
  version: string;
  digest: string;
  direct: boolean;
  dependencies: { id: string; version: string }[];
  installedAt: string;
  publisher: string;
  name: string;
  pinned?: boolean;
  qualificationProofRequired?: boolean;
}

export interface ProjectLock {
  schema: typeof LOCK_SCHEMA;
  revision: number;
  updatedAt: string;
  skills: Record<string, LockEntry>;
}

export interface PlanPackage {
  id: string;
  version: string;
  digest: string;
  direct: boolean;
  name: string;
  publisher: string;
  permissions: Permissions;
  dependencies: { id: string; version: string }[];
}

export interface ResolutionPlanBody {
  schema: typeof PLAN_SCHEMA;
  id: string;
  projectRoot: string;
  registryOrigin: string;
  host: Host;
  rootSkillId: string;
  rootSkillVersion: string;
  packages: PlanPackage[];
  createdAt: string;
  expiresAt: string;
  intent?: 'install' | 'update';
  baseLockRevision?: number;
  changes?: { id: string; from: string; to: string; notes: string; breaking: boolean; pinned: boolean }[];
}

export interface ResolutionPlan extends ResolutionPlanBody {
  seal: string;
}

export interface InstallJournal {
  schema: typeof STATE_SCHEMA;
  operation: 'install' | 'lock-restore';
  phase: 'prepared' | 'materialized';
  transactionId: string;
  previousLock: ProjectLock;
  nextLock: ProjectLock;
  stageRoot?: string;
  createdAt: string;
}

export interface InstalledEnvelope {
  schema: typeof STATE_SCHEMA;
  digest: string;
  envelope: Signed<Bundle>;
  installedAt: string;
}

export interface RevocationCache {
  schema: typeof STATE_SCHEMA;
  envelope: Signed<{
    items: { id: string; version: string; digest: string; reason: string; revokedAt: string }[];
    generatedAt: string;
    expiresAt: string;
  }>;
  fetchedAt: string;
}

export interface LoadedSkill {
  skill: {
    id: string;
    version: string;
    digest: string;
    name: string;
    publisher: string;
  };
  manifest: Manifest;
  entry: { path: string; content: string };
  resources: Record<string, string>;
  dependencies: { id: string; version: string; entry: string; content: string }[];
  warnings: string[];
  advertisement?: AdDecision;
  update?: UpdateCheckItem;
}

export interface InstallResult {
  planId: string;
  rootSkill: { id: string; version: string };
  installed: LockEntry[];
  reused: LockEntry[];
  lockRevision: number;
}

export interface ListResult {
  projectRoot: string;
  revision: number;
  skills: LockEntry[];
}

export interface SearchOptions {
  query?: string;
  category?: string;
  host?: Host;
  sort?: 'relevance' | 'newest' | 'name';
  limit?: number;
  offset?: number;
}

export interface CreatePlanOptions {
  version?: string;
  ttlMs?: number;
}

export interface UpdateCheckItem {
  id: string;
  currentVersion: string;
  latestVersion: string | null;
  latestCompatibleVersion: string | null;
  status: 'current' | 'update-available' | 'incompatible' | 'revoked' | 'unknown';
  pinned: boolean;
  notes: string | null;
  breaking: boolean | null;
  compatibility: 'compatible' | 'incompatible' | 'unknown';
  revocationStatus: 'clear' | 'revoked' | 'unknown';
  checkedAt: string | null;
  source: 'registry' | 'cache' | 'stale-cache' | 'unavailable';
  warnings: string[];
}

export interface UpdateCheckResult {
  projectRoot: string;
  lockRevision: number;
  checkedAt: string;
  cacheTtlHours: 24;
  items: UpdateCheckItem[];
}

export interface InitOptions {
  projectRoot: string;
  registry: string;
  host: Host;
  cliPath: string;
  preauthorizeReviewedText?: boolean;
  locale?: string;
}

export interface InitResult {
  projectRoot: string;
  registry: string;
  host: Host;
  mcpConfigPath: string;
  bootstrapSkillPath: string;
  trust: TrustRecord;
  trustNotice: string;
}

export interface PrivacyState {
  anonymous: true;
  accountRequired: false;
  installationId: string;
  installationIdLeavesDevice: false;
  adsEnabled: boolean;
  locale: string;
  localFrequencyEntries: number;
  queuedEvents: number;
  registry: string;
  dataSent: string[];
  dataNeverSent: string[];
}

export interface AdFrequencyRecord {
  campaignId: string;
  sponsor: string;
  renderedAt: string;
}

export interface AdFrequencyState {
  schema: typeof STATE_SCHEMA;
  records: AdFrequencyRecord[];
}

export interface AdSelection {
  decision: AdDecision;
  envelope: Signed<AdDecision>;
}

export type AdEventType = 'impression' | 'hide' | 'report';

export interface QueuedAdEvent {
  token: string;
  type: AdEventType;
  eventId: string;
  reason?: string;
  queuedAt: string;
}

/** 'reported' means the registry accepted the event; 'queued' means it is only stored locally for retry; 'unknown' means neither confirmed nor queued. */
export interface AdEventReport {
  type: AdEventType;
  eventId: string;
  status: 'reported' | 'queued' | 'unknown';
  duplicate: boolean;
}

export interface EventOutboxFlush {
  flushed: number;
  dropped: number;
  remaining: number;
}

export interface RuntimePaths {
  root: string;
  state: string;
  config: string;
  policy: string;
  trust: string;
  installation: string;
  lock: string;
  history: string;
  plans: string;
  skills: string;
  cache: string;
  staging: string;
  journal: string;
  mutex: string;
  revocations: string;
  adFrequency: string;
  eventOutbox: string;
  runs: string;
}

export interface ResolvedSkill {
  summary: SkillSummary;
  direct: boolean;
}
