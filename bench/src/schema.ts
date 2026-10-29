// Data contracts shared by the bench tooling and the website. Every file the
// site publishes under /data/ is validated against these schemas at build
// time, so a hand edit that breaks a contract fails the build.
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
const isoTimestamp = z.string().datetime({ offset: true });
const sha = z.string().regex(/^[0-9a-f]{40}$/, 'a full 40-character commit SHA');
const kebab = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kebab-case');
const bilingual = z.object({ en: z.string().min(1), zh: z.string().min(1) });

export const SKILL_STATUSES = ['draft', 'listed', 'benchmarked', 'delisted'] as const;

/** One skill package at one pinned commit. Written by `bench import`, curated by hand. */
export const SkillRecord = z.object({
  schema: z.literal('skillflux-skill/v1'),
  id: kebab,
  name: z.string().min(1),
  displayName: bilingual,
  // SkillFlux's own editorial summary. Drafts carry a placeholder.
  summary: bilingual,
  // The frontmatter description at the pinned commit, quoted as the author's claim.
  upstreamDescription: z.string().min(1).max(4096),
  source: z.object({
    repo: z.string().url().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+$/, 'https://github.com/<owner>/<repo>'),
    // Directory inside the repository that holds SKILL.md; '' for the root.
    path: z.string().regex(/^(?:[^/].*[^/]|[^/]?)$/, 'no leading or trailing slash'),
    commitSha: sha,
    pinnedAt: isoDate,
  }),
  author: z.object({ name: z.string().min(1), url: z.string().url().optional() }),
  license: z.object({
    spdx: z.string().nullable(),
    raw: z.string().nullable(),
    file: z.string().nullable(),
  }),
  sourceSiteSlug: z.string().min(1),
  category: kebab,
  tags: z.array(z.string().min(1)),
  status: z.enum(SKILL_STATUSES),
  addedAt: isoDate,
  updatedAt: isoDate,
});
export type SkillRecord = z.infer<typeof SkillRecord>;

export const CHECK_STATUSES = ['pass', 'warn', 'fail', 'info'] as const;
export const HealthCheck = z.object({
  id: z.string().regex(/^[a-z]+(?:\.[a-zA-Z]+)+$/),
  status: z.enum(CHECK_STATUSES),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  detail: z.string(),
});
export type HealthCheck = z.infer<typeof HealthCheck>;

export const HEALTH_FLAGS = ['executes-code', 'network-calls', 'destructive-commands', 'risky-instructions', 'possible-secret', 'no-license', 'stale', 'archived-repo', 'upstream-changed'] as const;

/** Static health check of a skill at its pinned commit. Machine-written. */
export const HealthRecord = z.object({
  schema: z.literal('skillflux-health/v1'),
  skillId: kebab,
  commitSha: sha,
  checkerVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  // Changes only when the result changes, so a weekly re-run leaves no diff.
  changedAt: isoDate,
  resultHash: z.string().regex(/^[0-9a-f]{64}$/),
  checks: z.array(HealthCheck).min(1),
  metrics: z.object({
    descriptionChars: z.number().int().nonnegative(),
    bodyTokensApprox: z.number().int().nonnegative(),
    bodyLines: z.number().int().nonnegative(),
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    scriptCount: z.number().int().nonnegative(),
    lastCommitAt: isoTimestamp.nullable(),
    commitsSincePin: z.number().int().nonnegative().nullable(),
  }),
  // Volatile repository facts: recorded when the result is rewritten, never hashed.
  repo: z.object({ stars: z.number().int().nonnegative().nullable(), archived: z.boolean().nullable(), checkedAt: isoDate }),
  flags: z.array(z.enum(HEALTH_FLAGS)),
});
export type HealthRecord = z.infer<typeof HealthRecord>;

/** A benchmark task. Lives in bench/tasks/<skillId>/<taskId>/task.json. */
export const BenchTask = z.object({
  schema: z.literal('skillflux-bench-task/v1'),
  id: kebab,
  version: z.number().int().positive(),
  skillId: kebab,
  // negative-control tasks measure false triggering; they run in the with-skill arm only.
  kind: z.enum(['positive', 'negative-control']),
  title: bilingual,
  prompt: z.string().min(20),
  limits: z.object({ maxTurns: z.number().int().positive().max(200), timeoutSec: z.number().int().positive().max(3600) }),
  tools: z.array(z.string().min(1)).min(1),
  grader: z.discriminatedUnion('type', [
    z.object({ type: z.literal('script'), entry: z.string().min(1), timeoutSec: z.number().int().positive().max(600) }),
    // Model-judged trials are reported separately and never count toward the headline pass rate.
    z.object({ type: z.literal('llm-rubric'), entry: z.string().min(1), timeoutSec: z.number().int().positive().max(600), flag: z.literal('llm-judged') }),
  ]),
  // Plain-language list of what the grader checks; published next to the prompt.
  checks: z.array(bilingual).min(1),
  requires: z.array(z.string()).default([]),
});
export type BenchTask = z.infer<typeof BenchTask>;

export const ARMS = ['with', 'without'] as const;
export type Arm = (typeof ARMS)[number];
export const TRIAL_STATUSES = ['ok', 'timeout', 'invalid', 'infra'] as const;

const tokens = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
});

export const Trial = z.object({
  skillId: kebab,
  taskId: kebab,
  arm: z.enum(ARMS),
  rep: z.number().int().positive(),
  status: z.enum(TRIAL_STATUSES),
  // null when the trial did not reach grading (timeout, invalid, infra).
  passed: z.boolean().nullable(),
  assertions: z.object({ passed: z.number().int().nonnegative(), total: z.number().int().nonnegative() }),
  triggered: z.boolean(),
  skillInvocations: z.number().int().nonnegative(),
  firstTriggerTurn: z.number().int().positive().nullable(),
  durationMs: z.number().nonnegative(),
  durationApiMs: z.number().nonnegative().nullable(),
  numTurns: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  tokens,
  transcriptSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  note: z.string().optional(),
});
export type Trial = z.infer<typeof Trial>;

const interval = z.tuple([z.number(), z.number()]);
export const VERDICTS = ['improves', 'hurts', 'no-detectable-difference'] as const;

export const ArmSummary = z.object({
  n: z.number().int().nonnegative(),
  passes: z.number().int().nonnegative(),
  passRate: z.number().min(0).max(1).nullable(),
  wilson95: interval.nullable(),
  triggered: z.number().int().nonnegative(),
  triggerRate: z.number().min(0).max(1).nullable(),
  triggerWilson95: interval.nullable(),
  medianDurationMs: z.number().nullable(),
  iqrDurationMs: interval.nullable(),
  medianCostUsd: z.number().nullable(),
  iqrCostUsd: interval.nullable(),
  medianOutputTokens: z.number().nullable(),
  excluded: z.object({ timeout: z.number().int(), invalid: z.number().int(), infra: z.number().int() }),
});
export type ArmSummary = z.infer<typeof ArmSummary>;

export const Comparison = z.object({
  passRateDelta: z.number().nullable(),
  newcombe95: interval.nullable(),
  verdict: z.enum(VERDICTS).nullable(),
});
export type Comparison = z.infer<typeof Comparison>;

export const TaskResult = z.object({
  taskId: kebab,
  taskVersion: z.number().int().positive(),
  taskSha256: z.string().regex(/^[0-9a-f]{64}$/),
  kind: z.enum(['positive', 'negative-control']),
  // What was tested travels with the result, so a run is self-describing.
  title: bilingual,
  prompt: z.string().min(1),
  checks: z.array(bilingual).min(1),
  arms: z.object({ with: ArmSummary, without: ArmSummary.nullable() }),
  comparison: Comparison.nullable(),
});

export const SkillResult = z.object({
  skillId: kebab,
  commitSha: sha,
  tasks: z.array(TaskResult).min(1),
  // Positive tasks pooled per arm; the page shows each task as well.
  pooled: z.object({ with: ArmSummary, without: ArmSummary, comparison: Comparison }),
  // Trigger rate on negative-control tasks (lower is better).
  falseTrigger: z.object({ n: z.number().int(), triggered: z.number().int(), rate: z.number().nullable(), wilson95: interval.nullable() }).nullable(),
});
export type SkillResult = z.infer<typeof SkillResult>;

/** A published benchmark run. Immutable once published; corrections supersede it. */
export const RunRecord = z.object({
  schema: z.literal('skillflux-bench-run/v1'),
  runId: z.string().regex(/^\d{8}-[0-9a-f]{4}$/),
  methodologyVersion: z.string().regex(/^\d+$/),
  status: z.enum(['published', 'superseded', 'withdrawn']),
  supersedes: z.string().nullable(),
  supersededBy: z.string().nullable(),
  publishedAt: isoDate,
  startedAt: isoTimestamp,
  finishedAt: isoTimestamp,
  environment: z.object({
    runner: z.literal('claude-code-headless'),
    claudeCodeVersion: z.string().min(1),
    modelRequested: z.string().min(1),
    modelsResolved: z.array(z.string().min(1)),
    os: z.string(),
    node: z.string(),
    image: z.string().nullable(),
    flags: z.array(z.string()),
    benchCommit: z.string(),
  }),
  config: z.object({ repeats: z.number().int().positive(), seed: z.number().int(), concurrency: z.number().int().positive() }),
  totals: z.object({ trials: z.number().int(), costUsd: z.number().nonnegative(), retries: z.number().int() }),
  skills: z.array(SkillResult).min(1),
  trials: z.array(Trial).min(1),
  deviations: z.array(z.string()),
  artifacts: z.object({ transcriptsUrl: z.string().url().nullable(), sha256: z.string().nullable(), note: z.string().optional() }),
});
export type RunRecord = z.infer<typeof RunRecord>;
