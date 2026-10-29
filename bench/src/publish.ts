// Turns a finished run directory into the immutable public record at
// web/data/benchmarks/runs/<runId>.json. Dry runs are never published.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { RUNS_PUBLISHED_DIR, readJson, today, writeJson } from './paths.js';
import type { RunManifest } from './runner/run.js';
import { RunRecord, Trial } from './schema.js';
import { summarizeSkill } from './summarize.js';

export interface PublishOptions { supersedes: string | null; outDir?: string; allowDryRun?: boolean; publishedAt?: string }

export async function buildRunRecord(runDir: string, options: PublishOptions): Promise<RunRecord> {
  const manifest = await readJson<RunManifest>(join(runDir, 'manifest.json'));
  if (manifest.dryRun && !options.allowDryRun) throw new Error('dry runs use a fake claude and cannot be published');
  const trials = (await readJson<unknown[]>(join(runDir, 'trials.json'))).map(value => Trial.parse(value));
  const deviations: string[] = [];
  if (manifest.stoppedForBudget) deviations.push(`Stopped at the $${manifest.budgetUsd} budget before every scheduled trial ran.`);
  const invalid = trials.filter(trial => trial.status === 'invalid').length;
  if (invalid) deviations.push(`${invalid} trial(s) failed the isolation check and are excluded from n.`);
  const skills = manifest.skills.map(({ skillId, commitSha }) => summarizeSkill(skillId, commitSha,
    manifest.tasks.filter(task => task.skillId === skillId).map(({ taskId, taskVersion, taskSha256, kind, title, prompt, checks }) => ({ taskId, taskVersion, taskSha256, kind, title, prompt, checks })),
    trials));
  return RunRecord.parse({
    schema: 'skillflux-bench-run/v1',
    runId: manifest.runId,
    methodologyVersion: '1',
    status: 'published',
    supersedes: options.supersedes,
    supersededBy: null,
    publishedAt: options.publishedAt ?? today(),
    startedAt: manifest.startedAt,
    finishedAt: manifest.finishedAt,
    environment: {
      runner: 'claude-code-headless',
      claudeCodeVersion: manifest.claudeCodeVersion,
      modelRequested: manifest.model,
      modelsResolved: manifest.modelsResolved,
      os: manifest.os,
      node: manifest.node,
      image: manifest.image,
      flags: manifest.flags,
      benchCommit: manifest.benchCommit,
    },
    config: manifest.config,
    totals: { trials: trials.length, costUsd: Math.round(trials.reduce((sum, trial) => sum + trial.costUsd, 0) * 10000) / 10000, retries: manifest.retries },
    skills,
    trials,
    deviations,
    artifacts: { transcriptsUrl: null, sha256: null, note: 'Transcripts are attached after review; see the run page.' },
  });
}

export async function publishRun(runDir: string, options: PublishOptions): Promise<string> {
  const record = await buildRunRecord(runDir, options);
  const outDir = options.outDir ?? RUNS_PUBLISHED_DIR;
  const path = join(outDir, `${record.runId}.json`);
  if (existsSync(path)) throw new Error(`${path} exists; published runs are immutable. Publish a new run with --supersedes instead.`);
  if (options.supersedes) {
    const previousPath = join(outDir, `${options.supersedes}.json`);
    if (!existsSync(previousPath)) throw new Error(`cannot supersede unknown run ${options.supersedes}`);
    // The only edit ever made to a published run: pointing at its replacement.
    const previous = RunRecord.parse(await readJson(previousPath));
    await writeJson(previousPath, { ...previous, status: 'superseded', supersededBy: record.runId });
  }
  await writeJson(path, record);
  console.log(`Next: review transcripts in ${runDir}/trials, redact local paths, then attach them as a GitHub release asset:\n  tar -czf transcripts.tar.gz -C ${runDir} trials\n  gh release create bench-${record.runId} transcripts.tar.gz --title "Benchmark run ${record.runId}" --notes "Raw transcripts for SkillFlux run ${record.runId}"`);
  return path;
}
