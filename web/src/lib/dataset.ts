// The open dataset published under /data/. Every file is rendered from the
// same validated data as the pages, and /data/index.json lists each file
// with its size and sha256 so a downloader can verify what it received.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HealthRecord, RunRecord, SkillRecord } from '@skillflux/bench/schema';
import { CHECKER_VERSION, CHECK_REGISTRY } from '@skillflux/bench/checks';
import { SITE } from '../config';
import { absoluteUrl } from './content';
import { toCsv } from './csv';
import { getRuns, getSkillViews } from './skills';
import type { SkillView } from './skill-data';

export const DATASET = {
  name: 'SkillFlux agent skill health and benchmark dataset',
  license: 'https://creativecommons.org/licenses/by/4.0/',
  licenseName: 'CC BY 4.0',
  version: '1.0.0',
} as const;

export interface DatasetFile { path: string; contentType: string; description: string; body: string }

export function reportPath(id: string): string { return `/skills/${id}/`; }

/** Only listed or benchmarked skills are published; drafts stay out of the dataset. */
function publishedViews(): SkillView[] {
  return getSkillViews().filter(view => view.indexable);
}

function skillRow(view: SkillView) {
  const { skill, health, result, counts } = view;
  const pooled = result?.skill.pooled;
  return {
    id: skill.id,
    name: skill.name,
    displayName: skill.displayName.en,
    category: skill.category,
    status: skill.status,
    repo: skill.source.repo,
    path: skill.source.path,
    commitSha: skill.source.commitSha,
    pinnedAt: skill.source.pinnedAt,
    author: skill.author.name,
    licenseSpdx: skill.license.spdx,
    licenseFile: skill.license.file,
    sourceSite: skill.sourceSiteSlug,
    healthCheckedCommit: health?.commitSha ?? null,
    healthPass: counts.pass,
    healthWarn: counts.warn,
    healthFail: counts.fail,
    flags: health?.flags ?? [],
    latestRun: result?.run.runId ?? null,
    passRateWith: pooled?.with.passRate ?? null,
    passRateWithout: pooled?.without.passRate ?? null,
    passRateDelta: pooled?.comparison.passRateDelta ?? null,
    verdict: pooled?.comparison.verdict ?? null,
    reportUrl: absoluteUrl(reportPath(skill.id)),
  };
}

const SKILL_COLUMNS = ['id', 'name', 'displayName', 'category', 'status', 'repo', 'path', 'commitSha', 'pinnedAt', 'author', 'licenseSpdx', 'licenseFile', 'sourceSite', 'healthCheckedCommit', 'healthPass', 'healthWarn', 'healthFail', 'flags', 'latestRun', 'passRateWith', 'passRateWithout', 'passRateDelta', 'verdict', 'reportUrl'];

function json(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }

function render(): DatasetFile[] {
  const views = publishedViews();
  const rows = views.map(skillRow);
  const runs = getRuns();
  const files: DatasetFile[] = [
    { path: 'skills.json', contentType: 'application/json', description: 'One row per published skill: source, pinned commit, license, health counts and latest benchmark headline.', body: json({ schema: 'skillflux-dataset-skills/v1', items: rows }) },
    { path: 'skills.csv', contentType: 'text/csv', description: 'skills.json as CSV; flags are separated by semicolons.', body: toCsv(SKILL_COLUMNS, rows.map(row => SKILL_COLUMNS.map(column => { const value = row[column as keyof typeof row]; return Array.isArray(value) ? value.join(';') : value; }))) },
    { path: 'health.json', contentType: 'application/json', description: 'Full static health check records for published skills.', body: json({ schema: 'skillflux-dataset-health/v1', checkerVersion: CHECKER_VERSION, items: views.flatMap(view => view.health ? [view.health] : []) }) },
    { path: 'health.csv', contentType: 'text/csv', description: 'One row per skill and check: status, value and detail.', body: toCsv(['skill_id', 'commit_sha', 'checker_version', 'changed_at', 'check_id', 'status', 'value', 'detail'], views.flatMap(view => (view.health?.checks ?? []).map(check => [view.skill.id, view.health!.commitSha, view.health!.checkerVersion, view.health!.changedAt, check.id, check.status, check.value, check.detail]))) },
    { path: 'checks.json', contentType: 'application/json', description: 'Definitions of every health check id.', body: json({ schema: 'skillflux-dataset-checks/v1', checkerVersion: CHECKER_VERSION, items: CHECK_REGISTRY }) },
    { path: 'trials.csv', contentType: 'text/csv', description: 'Every benchmark trial across published runs, one row per run, skill, task, arm and repetition.', body: toCsv(['run_id', 'skill_id', 'task_id', 'arm', 'rep', 'status', 'passed', 'assertions_passed', 'assertions_total', 'triggered', 'skill_invocations', 'duration_ms', 'num_turns', 'cost_usd', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'], runs.flatMap(run => run.trials.map(trial => [run.runId, trial.skillId, trial.taskId, trial.arm, trial.rep, trial.status, trial.passed, trial.assertions.passed, trial.assertions.total, trial.triggered, trial.skillInvocations, trial.durationMs, trial.numTurns, trial.costUsd, trial.tokens.input, trial.tokens.output, trial.tokens.cacheRead, trial.tokens.cacheWrite]))) },
    ...runs.map(run => ({ path: `runs/${run.runId}.json`, contentType: 'application/json', description: `Benchmark run ${run.runId} (${run.status}).`, body: json(run) })),
    ...views.map(view => ({ path: `skills/${view.skill.id}.json`, contentType: 'application/json', description: `Everything SkillFlux publishes about ${view.skill.displayName.en}.`, body: json({ skill: view.skill, health: view.health, benchmark: view.result ? { runId: view.result.run.runId, result: view.result.skill } : null }) })),
    { path: 'schema/skill.schema.json', contentType: 'application/schema+json', description: 'JSON Schema of a skill record.', body: json(z.toJSONSchema(SkillRecord)) },
    { path: 'schema/health.schema.json', contentType: 'application/schema+json', description: 'JSON Schema of a health record.', body: json(z.toJSONSchema(HealthRecord)) },
    { path: 'schema/run.schema.json', contentType: 'application/schema+json', description: 'JSON Schema of a benchmark run.', body: json(z.toJSONSchema(RunRecord)) },
  ];
  const manifest = {
    schema: 'skillflux-dataset-index/v1',
    name: DATASET.name,
    version: DATASET.version,
    license: DATASET.license,
    publisher: SITE.name,
    homepage: absoluteUrl('/data/'),
    methodology: absoluteUrl('/methodology/v1/'),
    counts: { skills: views.length, benchmarked: views.filter(view => view.result).length, runs: runs.length },
    files: files.map(file => ({
      path: `/data/${file.path}`,
      url: absoluteUrl(`/data/${file.path}`),
      contentType: file.contentType,
      bytes: Buffer.byteLength(file.body, 'utf8'),
      sha256: createHash('sha256').update(file.body).digest('hex'),
      description: file.description,
    })),
  };
  return [...files, { path: 'index.json', contentType: 'application/json', description: 'This manifest.', body: json(manifest) }];
}

let cache: DatasetFile[] | null = null;
export function getDatasetFiles(): DatasetFile[] { return cache ??= render(); }

/** Latest authored date across the dataset, never the build time. */
export function datasetModified(): string {
  return getSkillViews().filter(view => view.indexable).map(view => view.dateModified).sort().at(-1) ?? '2026-10-29';
}
