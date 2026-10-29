// Shared helpers for task graders (plain Node, no dependencies). A grader's
// default export receives { workDir } and returns { assertions }.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const check = (id, pass, detail, required = true) => ({ id, required, pass: Boolean(pass), detail });

export function exists(workDir, path) {
  const ok = existsSync(join(workDir, path));
  return check(`exists:${path}`, ok, ok ? `${path} exists` : `${path} is missing`);
}

export function readText(workDir, path) {
  try { return readFileSync(join(workDir, path), 'utf8'); } catch { return null; }
}

/** Runs the Python inspector; returns parsed JSON or { error }. */
export function inspect(kind, workDir, path) {
  const file = join(workDir, path);
  if (!existsSync(file)) return { error: `${path} is missing` };
  try {
    return JSON.parse(execFileSync('python3', ['-I', join(here, 'file_inspect.py'), kind, file], { encoding: 'utf8', timeout: 60_000 }));
  } catch (error) {
    try { return JSON.parse(error.stdout); } catch { return { error: String(error.message).slice(0, 200) }; }
  }
}

/** Finds a sheet by case-insensitive name. */
export function sheet(book, name) {
  if (!book?.sheets) return null;
  const key = Object.keys(book.sheets).find(item => item.toLowerCase() === name.toLowerCase());
  return key ? book.sheets[key] : null;
}

export const cellText = cell => cell?.f ?? (cell?.v === null || cell?.v === undefined ? '' : String(cell.v));

/** Runs a command in the workspace; returns { ok, output }. */
export function run(workDir, file, args, timeout = 60_000) {
  try {
    return { ok: true, output: execFileSync(file, args, { cwd: workDir, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ''}${error.stderr ?? ''}`.slice(-400) || String(error.message) };
  }
}
