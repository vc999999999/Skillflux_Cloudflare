import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const BENCH_ROOT = resolve(import.meta.dirname, '..');
export const REPO_ROOT = resolve(BENCH_ROOT, '..');
export const WEB_DATA = join(REPO_ROOT, 'web', 'data');
export const SKILLS_DIR = join(WEB_DATA, 'skills');
export const HEALTH_DIR = join(WEB_DATA, 'health');
export const RUNS_PUBLISHED_DIR = join(WEB_DATA, 'benchmarks', 'runs');
export const TASKS_DIR = join(BENCH_ROOT, 'tasks');
export const RUNS_DIR = join(BENCH_ROOT, 'runs');

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

/** Stable, reviewable JSON: two-space indent and a trailing newline. */
export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJsonDir<T>(dir: string): Promise<T[]> {
  if (!existsSync(dir)) return [];
  const names = (await readdir(dir)).filter(name => name.endsWith('.json') && !name.startsWith('_')).sort();
  return Promise.all(names.map(name => readJson<T>(join(dir, name))));
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
