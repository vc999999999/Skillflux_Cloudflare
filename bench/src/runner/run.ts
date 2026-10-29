// L2 benchmark orchestration. For each skill × task × arm × repetition:
// fresh temporary project and Claude config, skill present only in the
// with-skill arm, isolation verified from the init event, deterministic
// grading, and a full record written to bench/runs/<runId>/.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { arch, platform, release, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gradeWorkspace } from '../grade/run-grader.js';
import { REPO_ROOT, RUNS_DIR, SKILLS_DIR, readJson, writeJson } from '../paths.js';
import { SkillRecord, Trial, type Arm } from '../schema.js';
import { fetchSnapshot } from '../source/fetch.js';
import { parseRepoUrl } from '../source/github.js';
import { loadTasks, type LoadedTask } from '../tasks.js';
import { CLAUDE_FLAGS, claudeVersion, runClaude, trialEnv } from './claude.js';
import { seededShuffle } from './order.js';
import { isInfrastructureError, parseStream } from './stream.js';

export interface RunOptions {
  skills?: string[];
  model: string;
  repeats: number;
  concurrency: number;
  budgetUsd: number;
  seed: number;
  claudeBin?: string;
  allowHost: boolean;
  dryRun: boolean;
  // Overridable for tests.
  runsDir?: string;
  tasksDir?: string;
  skillsDir?: string;
  resolveSkillDir?: (skill: SkillRecord) => Promise<string>;
}

export interface RunManifest {
  runId: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  model: string;
  claudeCodeVersion: string;
  modelsResolved: string[];
  os: string;
  node: string;
  image: string | null;
  flags: string[];
  benchCommit: string;
  config: { repeats: number; seed: number; concurrency: number };
  budgetUsd: number;
  stoppedForBudget: boolean;
  retries: number;
  skills: Array<{ skillId: string; commitSha: string }>;
  tasks: Array<{ skillId: string; taskId: string; taskVersion: number; taskSha256: string; kind: 'positive' | 'negative-control'; title: { en: string; zh: string }; prompt: string; checks: Array<{ en: string; zh: string }> }>;
}

export const FAKE_CLAUDE = resolve(import.meta.dirname, '../../tests/fixtures/fake-claude.mjs');

function inContainer(): boolean {
  return existsSync('/.dockerenv') || process.env.SKILLFLUX_IN_CONTAINER === '1'
    || (existsSync('/proc/1/cgroup') && /docker|containerd|kubepods/.test(readFileSync('/proc/1/cgroup', 'utf8')));
}

function benchCommit(): string {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
}

interface Job { skill: SkillRecord; skillDir: string; task: LoadedTask; arm: Arm; rep: number }

async function runTrial(job: Job, options: RunOptions, bin: string, trialDir: string): Promise<{ trial: Trial; models: string[]; version: string | null; infra: boolean }> {
  const root = await mkdtemp(join(tmpdir(), 'skillflux-trial-'));
  try {
    const work = join(root, 'work');
    const home = join(root, 'home');
    const configDir = join(home, '.claude-config');
    await mkdir(work, { recursive: true });
    await mkdir(configDir, { recursive: true });
    if (existsSync(join(job.task.dir, 'fixtures'))) await cp(join(job.task.dir, 'fixtures'), work, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: work });
    execFileSync('git', ['-c', 'user.email=bench@skillflux.app', '-c', 'user.name=SkillFlux Bench', 'add', '-A'], { cwd: work });
    execFileSync('git', ['-c', 'user.email=bench@skillflux.app', '-c', 'user.name=SkillFlux Bench', 'commit', '-q', '--allow-empty', '-m', 'baseline'], { cwd: work });
    // Identical settings in both arms; the only difference is the skill directory.
    await mkdir(join(work, '.claude'), { recursive: true });
    await writeFile(join(work, '.claude', 'settings.json'), '{}\n');
    if (job.arm === 'with') await cp(job.skillDir, join(work, '.claude', 'skills', job.skill.name), { recursive: true });

    const extra: Record<string, string> = options.dryRun ? { SKILLFLUX_FAKE_REFERENCE: join(job.task.dir, 'reference'), SKILLFLUX_FAKE_SKILL: job.skill.name } : {};
    const result = await runClaude(bin, CLAUDE_FLAGS(options.model, job.task.spec.limits.maxTurns, job.task.spec.tools), {
      cwd: work, env: trialEnv(home, configDir, extra), prompt: job.task.spec.prompt, timeoutSec: job.task.spec.limits.timeoutSec,
    });
    await mkdir(trialDir, { recursive: true });
    await writeFile(join(trialDir, 'transcript.jsonl'), result.stdout);
    await writeFile(join(trialDir, 'stderr.log'), result.stderr);
    const stream = parseStream(result.stdout, job.skill.name);
    const base = {
      skillId: job.skill.id, taskId: job.task.spec.id, arm: job.arm, rep: job.rep,
      triggered: stream.triggered, skillInvocations: stream.skillInvocations, firstTriggerTurn: stream.firstTriggerTurn,
      durationMs: stream.result?.durationMs ?? result.wallMs, durationApiMs: stream.result?.durationApiMs ?? null,
      numTurns: stream.result?.numTurns ?? 0, costUsd: stream.result?.costUsd ?? 0,
      tokens: stream.result?.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      transcriptSha256: createHash('sha256').update(result.stdout).digest('hex'),
    };
    const finish = (status: Trial['status'], passed: boolean | null, assertions = { passed: 0, total: 0 }, note?: string) =>
      ({ trial: Trial.parse({ ...base, status, passed, assertions, ...(note ? { note } : {}) }), models: stream.result?.modelsResolved ?? [], version: stream.init.version, infra: status === 'infra' });

    if (result.timedOut) return finish('timeout', null, undefined, `exceeded ${job.task.spec.limits.timeoutSec}s`);
    if (result.error || isInfrastructureError(stream, result.stderr)) return finish('infra', null, undefined, (result.error ?? stream.result?.errorText ?? result.stderr.trim().split('\n').at(-1) ?? 'no result event').slice(0, 200));
    // Isolation is checked, not assumed.
    const listed = stream.init.skillsListed;
    if (listed === null) return finish('invalid', null, undefined, 'init event does not list skills; isolation cannot be verified');
    if (job.arm === 'with' && !listed.includes(job.skill.name)) return finish('invalid', null, undefined, 'skill missing from the with-skill arm');
    if (job.arm === 'without' && listed.includes(job.skill.name)) return finish('invalid', null, undefined, 'skill leaked into the without-skill arm');

    const grade = await gradeWorkspace(job.task, work, join(trialDir, 'transcript.jsonl'));
    await writeJson(join(trialDir, 'grade.json'), grade);
    await cp(work, join(trialDir, 'work'), { recursive: true, filter: source => !source.includes(`${join(work, '.git')}`) });
    const required = grade.assertions.filter(item => item.required);
    return finish('ok', grade.passed, { passed: required.filter(item => item.pass).length, total: required.length }, grade.error ?? undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function runBenchmark(options: RunOptions): Promise<string> {
  if (!options.dryRun && !options.allowHost && !inContainer()) {
    throw new Error('Refusing to run outside a container: trials run Claude Code with all permissions granted. Use bench/docker, or --allow-host for a local smoke test that will not be published.');
  }
  const bin = options.dryRun ? FAKE_CLAUDE : options.claudeBin ?? 'claude';
  const skillsDir = options.skillsDir ?? SKILLS_DIR;
  const tasks = await loadTasks(options.tasksDir, options.skills);
  if (!tasks.length) throw new Error('no tasks for the selected skills');
  const skillIds = [...new Set(tasks.map(task => task.spec.skillId))];
  const skills = new Map<string, { record: SkillRecord; dir: string }>();
  for (const id of skillIds) {
    const record = SkillRecord.parse(await readJson(join(skillsDir, `${id}.json`)));
    const dir = options.resolveSkillDir
      ? await options.resolveSkillDir(record)
      : join(await fetchSnapshot(parseRepoUrl(record.source.repo), record.source.commitSha), record.source.path);
    skills.set(id, { record, dir });
  }

  const jobs: Job[] = [];
  for (const task of tasks) {
    const { record, dir } = skills.get(task.spec.skillId)!;
    const arms: Arm[] = task.spec.kind === 'positive' ? ['with', 'without'] : ['with'];
    for (const arm of arms) for (let rep = 1; rep <= options.repeats; rep += 1) jobs.push({ skill: record, skillDir: dir, task, arm, rep });
  }
  const ordered = seededShuffle(jobs, options.seed);
  const startedAt = new Date();
  const runId = `${startedAt.toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(2).toString('hex')}`;
  const runDir = join(options.runsDir ?? RUNS_DIR, `${options.dryRun ? 'dry-' : ''}${runId}`);
  await mkdir(runDir, { recursive: true });
  const env = trialEnv(join(runDir, '.home'), join(runDir, '.home', 'config'));
  const version = options.dryRun ? 'fake' : await claudeVersion(bin, env) ?? 'unknown';

  const trials: Trial[] = [];
  const models = new Set<string>();
  let spent = 0;
  let retries = 0;
  let stoppedForBudget = false;
  let next = 0;
  const worker = async () => {
    while (next < ordered.length) {
      if (spent >= options.budgetUsd) { stoppedForBudget = true; return; }
      const job = ordered[next++]!;
      const trialDir = join(runDir, 'trials', job.skill.id, job.task.spec.id, job.arm, String(job.rep));
      let outcome = await runTrial(job, options, bin, trialDir);
      // Infrastructure errors say nothing about the skill: retry up to twice.
      for (let attempt = 0; outcome.infra && attempt < 2; attempt += 1) {
        retries += 1;
        spent += outcome.trial.costUsd;
        await new Promise(done => setTimeout(done, options.dryRun ? 0 : 15_000 * (attempt + 1)));
        outcome = await runTrial(job, options, bin, trialDir);
      }
      spent += outcome.trial.costUsd;
      outcome.models.forEach(model => models.add(model));
      trials.push(outcome.trial);
      await writeJson(join(trialDir, 'trial.json'), outcome.trial);
      console.log(`${trials.length}/${ordered.length} ${job.skill.id} ${job.task.spec.id} ${job.arm}#${job.rep}: ${outcome.trial.status}${outcome.trial.passed === null ? '' : outcome.trial.passed ? ' pass' : ' fail'}${outcome.trial.triggered ? ' (invoked)' : ''} $${outcome.trial.costUsd.toFixed(3)} · total $${spent.toFixed(2)}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker));

  const order = new Map(jobs.map((job, index) => [`${job.skill.id}/${job.task.spec.id}/${job.arm}/${job.rep}`, index]));
  trials.sort((a, b) => order.get(`${a.skillId}/${a.taskId}/${a.arm}/${a.rep}`)! - order.get(`${b.skillId}/${b.taskId}/${b.arm}/${b.rep}`)!);
  const manifest: RunManifest = {
    runId, dryRun: options.dryRun, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
    model: options.model, claudeCodeVersion: version, modelsResolved: [...models].sort(),
    os: `${platform()} ${release()} ${arch()}`, node: process.version, image: process.env.SKILLFLUX_IMAGE_DIGEST ?? null,
    flags: CLAUDE_FLAGS(options.model, 0, ['…']).map(flag => flag === '0' ? '<maxTurns>' : flag === '…' ? '<task tools>' : flag),
    benchCommit: benchCommit(),
    config: { repeats: options.repeats, seed: options.seed, concurrency: options.concurrency },
    budgetUsd: options.budgetUsd, stoppedForBudget, retries,
    skills: [...skills.values()].map(({ record }) => ({ skillId: record.id, commitSha: record.source.commitSha })),
    tasks: tasks.map(task => ({ skillId: task.spec.skillId, taskId: task.spec.id, taskVersion: task.spec.version, taskSha256: task.sha256, kind: task.spec.kind, title: task.spec.title, prompt: task.spec.prompt, checks: task.spec.checks })),
  };
  await writeJson(join(runDir, 'manifest.json'), manifest);
  await writeJson(join(runDir, 'trials.json'), trials);
  if (stoppedForBudget) console.warn(`Stopped scheduling at $${spent.toFixed(2)} (budget $${options.budgetUsd}); ${ordered.length - trials.length} trials not run.`);
  return runDir;
}
