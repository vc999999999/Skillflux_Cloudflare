import type { Bundle, EvaluationInput, Host, Permissions, ReleaseMetadata, SkillFile } from '../shared.js';

/** Resolved in-repo skill version directory: declared manifest, review sidecar, and content files. */
export interface SkillVersionDirectory {
  skillId: string;
  version: string;
  directory: string;
  manifest: CatalogManifest;
  review: ReviewSidecar;
  files: Record<string, string>;
}

/** skillflux.json — declarative fields owned by the skill author. */
export interface CatalogManifest {
  schema: 'skillflux/v1';
  id: string;
  version: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  hosts: Host[];
  publisher: string;
  license: string;
  entry: string;
  permissions: Permissions;
  dependencies: { id: string; version: string }[];
  createdAt: string;
  release?: ReleaseMetadata;
}

/** skillflux.review.json — maintainer review + evaluation evidence bound to the content hash. */
export interface ReviewSidecar {
  status: 'approved' | 'rejected' | 'revoked' | 'needs-testing';
  reviewer: string;
  reviewedAt: string;
  notes: string;
  revocationReason?: string;
  evaluation: EvaluationInput & { publicSummaryShown?: boolean };
}

export const CATALOG_INDEX_SCHEMA = 'skillflux-catalog-index/v1' as const;
export const CATALOG_MANIFEST_FILE = 'skillflux.json';
export const CATALOG_REVIEW_FILE = 'skillflux.review.json';
export const CATALOG_INDEX_FILE = 'index.json';

/** One version entry in the generated index.json. */
export interface CatalogIndexEntry {
  skill: {
    id: string;
    version: string;
    name: string;
    description: string;
    category: string;
    tags: string[];
    hosts: Host[];
    publisher: string;
    license: string;
    status: ReviewSidecar['status'];
    digest: string;
    size: number;
    entry: string;
    permissions: Permissions;
    dependencies: { id: string; version: string }[];
    createdAt: string;
    release?: ReleaseMetadata;
    qualification: CatalogQualification;
    quality: {
      automated: { passed: boolean; checks: string[]; checkedAt: string };
      review: { reviewer: string; reviewedAt: string; notes: string };
      evaluation?: {
        evaluationId: string;
        contentHash: string;
        testedAt: string;
        summary: string;
        hosts: Host[];
        purposePassed: boolean;
        boundaryPassed: boolean;
      };
    };
  };
  /** Content files in the version directory, excluding the sidecars themselves. */
  files: SkillFile[];
}

export type CatalogQualification = 'qualified' | 'needs-testing' | 'revoked';

export interface CatalogIndex {
  schema: typeof CATALOG_INDEX_SCHEMA;
  generatedAt: string;
  skills: CatalogIndexEntry[];
}

export type { Bundle };
