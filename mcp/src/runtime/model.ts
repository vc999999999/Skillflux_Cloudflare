import type { Bundle, Manifest, SearchResponse, SkillSummary } from '../shared.js';

export const STATE_DIRECTORY = '.skillflux';
export const STATE_SCHEMA = 'skillflux/runtime/v2' as const;
export const LOCK_SCHEMA = 'skillflux/lock/v1' as const;
export const PLAN_SCHEMA = 'skillflux/plan/v1' as const;

/** Local install anchor file replacing the old signed envelope. */
export const INSTALL_MANIFEST_FILE = '.skillflux-manifest.json';

export interface RuntimeConfig {
  schema: typeof STATE_SCHEMA;
  projectRoot: string;
  repo: string;
  source: string;
  host: Host;
  cliPath: string;
  createdAt: string;
}

export type Host = 'generic' | 'codex' | 'claude' | 'cursor';

export interface RuntimePolicy {
  schema: typeof STATE_SCHEMA;
  preauthorizeReviewedText: boolean;
  locale: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrustRecord {
  schema: typeof STATE_SCHEMA;
  repo: string;
  pinnedAt: string;
  method: 'repo-pin';
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
  permissions: import('../shared.js').Permissions;
  dependencies: { id: string; version: string }[];
}

export interface ResolutionPlanBody {
  schema: typeof PLAN_SCHEMA;
  id: string;
  projectRoot: string;
  repo: string;
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

/** Locally installed package: manifest plus full content, written atomically from staged downloads. */
export interface InstalledPackage {
  schema: typeof STATE_SCHEMA;
  digest: string;
  manifest: Manifest;
  files: Record<string, string>;
  indexSha: string;
  installedAt: string;
  warnings?: string[];
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
  source: 'catalog' | 'cache' | 'stale-cache' | 'unavailable';
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
  repo: string;
  host: Host;
  cliPath: string;
  source?: string;
  preauthorizeReviewedText?: boolean;
  locale?: string;
}

export interface InitResult {
  projectRoot: string;
  repo: string;
  host: Host;
  mcpConfigPath: string;
  bootstrapSkillPath: string;
  trust: TrustRecord;
  trustNotice: string;
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
  index: string;
  runs: string;
}

export type { Bundle, Manifest, SearchResponse, SkillSummary };
export type { Permissions } from '../shared.js';
