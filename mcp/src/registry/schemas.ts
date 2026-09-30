import { z } from 'zod';
import { safeRelativePath } from '../shared.js';

const identifier = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase kebab-case identifier');
const semanticVersion = z.string().max(80).regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/, 'must be a semantic version');
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
const evaluationCase = z.object({ input: cleanText(4000), expected: cleanText(4000), actual: cleanText(8000), passed: z.boolean(), steps: cleanText(4000).optional(), limitations: cleanText(4000).optional(), evidence: cleanText(8000).optional() }).strict();
export const evaluationSchema = z.object({
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), tester: cleanText(120), testedAt: dateTime,
  environment: cleanText(2000), kind: z.enum(['human', 'simulation']),
  purpose: evaluationCase, boundary: evaluationCase,
  hostChecks: z.array(z.object({ host: hostSchema, installed: z.boolean(), read: z.boolean(), notes: cleanText(4000) }).strict()).min(1).max(4),
  publicSummary: cleanText(2000),
}).strict().refine(value => new Set(value.hostChecks.map(item => item.host)).size === value.hostChecks.length, 'Duplicate host evidence');

export const submissionSchema = z.object({
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
  files: z.record(z.string(), z.string()).refine(files => Object.keys(files).every(safeRelativePath), 'contains an unsafe file path'),
  release: releaseSchema.optional(),
}).strict().superRefine((submission, context) => {
  const paths = Object.keys(submission.files);
  if (paths.length === 0) {
    context.addIssue({ code: 'custom', path: ['files'], message: 'must contain at least one file' });
  }
  if (paths.length > 64) {
    context.addIssue({ code: 'custom', path: ['files'], message: 'may contain at most 64 files' });
  }
  if (!Object.hasOwn(submission.files, submission.entry)) {
    context.addIssue({ code: 'custom', path: ['entry'], message: 'must identify a submitted file' });
  }
  const dependencies = new Set<string>();
  for (const dependency of submission.dependencies) {
    const key = `${dependency.id}@${dependency.version}`;
    if (dependency.id === submission.id) {
      context.addIssue({ code: 'custom', path: ['dependencies'], message: 'a skill cannot depend on itself' });
    }
    if (dependencies.has(key)) {
      context.addIssue({ code: 'custom', path: ['dependencies'], message: `duplicate dependency ${key}` });
    }
    dependencies.add(key);
  }
});

export const reviewSchema = z.object({
  action: z.enum(['approve', 'reject', 'revoke']),
  reviewer: cleanText(120),
  notes: cleanText(4_000),
}).strict();

const campaignBaseSchema = z.object({
  name: cleanText(120),
  sponsor: cleanText(120),
  text: cleanText(280).refine(value => !/[\r\n]/.test(value), 'must be a single line'),
  url: z.string().trim().min(1).max(2_048),
  categories: z.array(identifier.or(z.literal('*'))).max(50),
  active: z.boolean(),
  budgetCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  cpcCents: z.number().int().min(0).max(100_000_000),
  dailyCap: z.number().int().min(0).max(10_000_000),
  startsAt: dateTime,
  endsAt: dateTime,
}).strict();

export const campaignInputSchema = campaignBaseSchema.superRefine((campaign, context) => {
  if (Date.parse(campaign.startsAt) >= Date.parse(campaign.endsAt)) {
    context.addIssue({ code: 'custom', path: ['endsAt'], message: 'must be later than startsAt' });
  }
  if (campaign.active && campaign.budgetCents < campaign.cpcCents) {
    context.addIssue({ code: 'custom', path: ['budgetCents'], message: 'must cover at least one click while active' });
  }
  if (campaign.active && (campaign.cpcCents === 0 || campaign.dailyCap === 0)) {
    context.addIssue({ code: 'custom', path: ['active'], message: 'an active campaign needs positive cpcCents and dailyCap' });
  }
});

export const campaignPatchSchema = campaignBaseSchema.partial().strict().refine(value => Object.keys(value).length > 0, 'must include at least one field');

export const adRequestSchema = z.object({
  category: identifier,
  context: z.enum(['normal', 'sensitive', 'unknown']).default('unknown'),
  skillId: identifier.optional(),
  locale: z.string().trim().min(2).max(35).regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).optional(),
  placement: z.enum(['final-answer', 'web-preview']).optional(),
  excludedCampaigns: z.array(z.string().uuid()).max(100).optional(),
  requestId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();

export const eventSchema = z.object({
  token: z.string().min(40).max(2_048),
  type: z.enum(['impression', 'hide', 'report']),
  eventId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  reason: z.string().trim().max(1_000).optional(),
}).strict().superRefine((event, context) => {
  if (event.type === 'report' && !event.reason) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'is required for a report' });
  }
});

export const searchQuerySchema = z.object({
  q: z.string().max(200).default(''),
  category: identifier.optional(),
  host: hostSchema.optional(),
  sort: z.enum(['relevance', 'newest', 'name']).default('relevance'),
  limit: z.number().int().min(1).max(50).default(12),
  offset: z.number().int().min(0).max(10_000).default(0),
}).strict();

export type ValidSubmission = z.infer<typeof submissionSchema>;
export type ValidCampaignInput = z.infer<typeof campaignInputSchema>;

const requestId = z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);
export const inquirySchema = z.object({ requestId, name: cleanText(120), contact: cleanText(240), company: cleanText(160), product: cleanText(160), website: z.string().max(2048).url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }, 'must be an HTTPS website'), message: cleanText(4000), consent: z.literal(true) }).strict();
export const inquiryPatchSchema = z.object({ status: z.enum(['new', 'following-up', 'completed', 'invalid']), operator: cleanText(120), notes: cleanText(4000) }).strict();
export const reportSchema = z.object({ requestId, campaignId: z.string().uuid(), reason: cleanText(2000) }).strict();
export const reportPatchSchema = z.object({ action: z.enum(['dismiss', 'pause']), operator: cleanText(120), notes: cleanText(4000) }).strict();
