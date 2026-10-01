import { z } from 'zod';
import { safeRelativePath } from '../shared.js';

const identifier = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase kebab-case identifier');
const semanticVersion = z.string().max(80).regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:[1-9]\d*|\d)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/, 'must be a semantic version').refine(value => /^\d+\.\d+\.\d+/.test(value), 'must be a semantic version');
const cleanText = (maximum: number) => z.string().trim().min(1).max(maximum).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), 'contains unsupported control characters');
const dateTime = z.string().max(40).refine(value => Number.isFinite(Date.parse(value)), 'must be an ISO date-time');

export const hostSchema = z.enum(['generic', 'codex', 'claude', 'cursor']);

export const permissionsSchema = z.object({
  network: z.array(cleanText(240)).max(32),
  shell: z.boolean(),
  secrets: z.array(cleanText(120)).max(32),
}).strict();

export const dependencySchema = z.object({
  id: identifier,
  version: semanticVersion,
}).strict();

export const releaseSchema = z.object({ notes: cleanText(4000), breaking: z.boolean(), minClientVersion: semanticVersion, maintainedAt: dateTime, maintainedBy: cleanText(120) }).strict();

/** skillflux.json */
export const catalogManifestSchema = z.object({
  schema: z.literal('skillflux/v1'),
  id: identifier,
  version: semanticVersion,
  name: cleanText(120),
  description: cleanText(1_000),
  category: identifier,
  tags: z.array(cleanText(60)).max(40),
  hosts: z.array(hostSchema).min(1).max(4),
  publisher: cleanText(120),
  license: cleanText(80),
  entry: z.string().min(1).max(240).refine(safeRelativePath, 'must be a safe relative path'),
  permissions: permissionsSchema,
  dependencies: z.array(dependencySchema).max(32),
  createdAt: dateTime,
  release: releaseSchema.optional(),
}).strict().superRefine((manifest, context) => {
  const dependencies = new Set<string>();
  for (const dependency of manifest.dependencies) {
    const key = `${dependency.id}@${dependency.version}`;
    if (dependency.id === manifest.id) {
      context.addIssue({ code: 'custom', path: ['dependencies'], message: 'a skill cannot depend on itself' });
    }
    if (dependencies.has(key)) {
      context.addIssue({ code: 'custom', path: ['dependencies'], message: `duplicate dependency ${key}` });
    }
    dependencies.add(key);
  }
});

const evaluationCase = z.object({ input: cleanText(4000), expected: cleanText(4000), actual: cleanText(8000), passed: z.boolean(), steps: cleanText(4000).optional(), limitations: cleanText(4000).optional(), evidence: cleanText(8000).optional() }).strict();
const evaluationSchema = z.object({
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), tester: cleanText(120), testedAt: dateTime,
  environment: cleanText(2000), kind: z.enum(['human', 'simulation']),
  purpose: evaluationCase, boundary: evaluationCase,
  hostChecks: z.array(z.object({ host: hostSchema, installed: z.boolean(), read: z.boolean(), notes: cleanText(4000) }).strict()).min(1).max(4),
  publicSummary: cleanText(2000),
}).strict().refine(value => new Set(value.hostChecks.map(item => item.host)).size === value.hostChecks.length, 'Duplicate host evidence');

/** skillflux.review.json */
export const reviewSidecarSchema = z.object({
  status: z.enum(['approved', 'rejected', 'revoked', 'needs-testing']),
  reviewer: cleanText(120),
  reviewedAt: dateTime,
  notes: cleanText(4_000),
  revocationReason: cleanText(2_000).optional(),
  evaluation: evaluationSchema,
}).strict().superRefine((review, context) => {
  if (review.status === 'revoked' && !review.revocationReason) {
    context.addIssue({ code: 'custom', path: ['revocationReason'], message: 'a revoked version must state its reason' });
  }
});

export type CatalogManifestInput = z.infer<typeof catalogManifestSchema>;
export type ReviewSidecarInput = z.infer<typeof reviewSidecarSchema>;
