// Benchmark task specs: bench/tasks/<skillId>/<taskId>/{task.json, fixtures/, reference/, grade.mjs}
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gradeWorkspace } from './grade/run-grader.js';
import { BenchTask, SkillRecord } from './schema.js';
import { SKILLS_DIR, TASKS_DIR, readJson } from './paths.js';
import { listFiles } from './source/fetch.js';

export interface LoadedTask { spec: BenchTask; dir: string; sha256: string }

/** Content hash of everything that defines a task, so a changed task is a different task. */
export async function taskSha256(dir: string): Promise<string> {
  const hash = createHash('sha256');
  // Graders import the shared helpers in tasks/_lib, so they are part of the task.
  const shared = join(dir, '..', '..', '_lib');
  for (const [prefix, root] of [['task', dir], ['_lib', shared]] as const) {
    if (!existsSync(root)) continue;
    for (const file of await listFiles(root)) hash.update(`${prefix}/${file.path}\0${file.bytes}\0`).update(file.content).update('\0');
  }
  return hash.digest('hex');
}

export async function loadTasks(root = TASKS_DIR, onlySkills?: string[]): Promise<LoadedTask[]> {
  if (!existsSync(root)) return [];
  const tasks: LoadedTask[] = [];
  for (const skillId of (await readdir(root)).sort()) {
    if (skillId.startsWith('_') || skillId.startsWith('.')) continue;
    if (onlySkills?.length && !onlySkills.includes(skillId)) continue;
    const skillDir = join(root, skillId);
    for (const taskId of (await readdir(skillDir)).sort()) {
      const dir = join(skillDir, taskId);
      if (!existsSync(join(dir, 'task.json'))) continue;
      const spec = BenchTask.parse(await readJson(join(dir, 'task.json')));
      if (spec.skillId !== skillId || spec.id !== taskId) throw new Error(`${dir}: task.json id/skillId must match its directory`);
      tasks.push({ spec, dir, sha256: await taskSha256(dir) });
    }
  }
  return tasks;
}

/**
 * A task is usable only when its grader tells a correct result from no result:
 * the reference solution must pass and an untouched workspace must fail.
 */
export async function lintTasks(onlySkills?: string[], root = TASKS_DIR, skillsDir = SKILLS_DIR): Promise<string[]> {
  const failures: string[] = [];
  let tasks: LoadedTask[];
  try { tasks = await loadTasks(root, onlySkills); } catch (error) { return [(error as Error).message]; }
  if (!tasks.length) return ['no tasks found'];
  for (const task of tasks) {
    const label = `${task.spec.skillId}/${task.spec.id}`;
    const skillPath = join(skillsDir, `${task.spec.skillId}.json`);
    if (!existsSync(skillPath)) { failures.push(`${label}: no skill record ${task.spec.skillId}`); continue; }
    const skill = SkillRecord.parse(await readJson(skillPath));
    // The model must decide on its own to use the skill, so the prompt may not
    // point at it. Naming a file format the skill handles ("budget.xlsx") is fine.
    const prompt = task.spec.prompt.toLowerCase();
    const name = skill.name.toLowerCase();
    if (/\bskills?\b/.test(prompt) || prompt.includes(`/${name}`) || prompt.includes(`${name} skill`) || prompt.includes(`.claude/skills`)) {
      failures.push(`${label}: prompt refers to the skill`);
    }
    if (task.spec.kind === 'positive' && !existsSync(join(task.dir, 'reference'))) failures.push(`${label}: positive task needs a reference/ solution`);
    if (!existsSync(join(task.dir, task.spec.grader.entry))) { failures.push(`${label}: grader ${task.spec.grader.entry} missing`); continue; }
    if (task.spec.kind !== 'positive') continue;
    for (const [name, withReference, expected] of [['reference', true, true], ['empty workspace', false, false]] as const) {
      const work = await mkdtemp(join(tmpdir(), 'skillflux-lint-'));
      try {
        if (existsSync(join(task.dir, 'fixtures'))) await cp(join(task.dir, 'fixtures'), work, { recursive: true });
        if (withReference) await cp(join(task.dir, 'reference'), work, { recursive: true, force: true });
        const grade = await gradeWorkspace(task, work, null);
        if (grade.passed !== expected) failures.push(`${label}: grader ${expected ? 'fails' : 'passes'} the ${name}${grade.error ? ` (${grade.error})` : ''}`);
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    }
  }
  return failures;
}
