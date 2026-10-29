// Helpers for task graders. A grader is `export default async ({ workDir })
// => ({ assertions: [{ id, required, pass, detail }] })`; it inspects files
// only and never learns which arm produced them.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface Assertion { id: string; required: boolean; pass: boolean; detail: string }
export interface GradeResult { assertions: Assertion[] }
export type Grader = (context: { workDir: string }) => Promise<GradeResult>;

export function assertion(id: string, pass: boolean, detail: string, required = true): Assertion {
  return { id, required, pass, detail };
}

export function fileExists(workDir: string, path: string): Assertion {
  const ok = existsSync(join(workDir, path));
  return assertion(`exists:${path}`, ok, ok ? `${path} exists` : `${path} is missing`);
}

export async function readText(workDir: string, path: string): Promise<string | null> {
  try { return await readFile(join(workDir, path), 'utf8'); } catch { return null; }
}

export async function matches(workDir: string, path: string, pattern: RegExp, id = `matches:${path}`): Promise<Assertion> {
  const text = await readText(workDir, path);
  const ok = text !== null && pattern.test(text);
  return assertion(id, ok, ok ? `${path} matches ${pattern}` : `${path} ${text === null ? 'is missing' : `does not match ${pattern}`}`);
}

/** Runs a command in the workspace (for example a Python check). Exit code 0 passes. */
export async function command(workDir: string, file: string, args: string[], id: string, timeoutMs = 60_000): Promise<Assertion> {
  try {
    const { stdout } = await run(file, args, { cwd: workDir, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
    return assertion(id, true, stdout.trim().slice(0, 300) || 'ok');
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; message: string };
    return assertion(id, false, (failure.stderr || failure.stdout || failure.message).trim().slice(0, 300));
  }
}
