import { lstat, mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RuntimePaths } from './model.js';
import { STATE_DIRECTORY } from './model.js';
import { SkillFluxError } from './errors.js';

export function runtimePaths(projectRoot: string): RuntimePaths {
  const root = resolve(projectRoot);
  const state = join(root, STATE_DIRECTORY);
  return {
    root,
    state,
    config: join(state, 'config.json'),
    policy: join(state, 'policy.json'),
    trust: join(state, 'trust.json'),
    installation: join(state, 'installation.json'),
    lock: join(state, 'lock.json'),
    history: join(state, 'lock.history'),
    plans: join(state, 'plans'),
    skills: join(state, 'skills'),
    cache: join(state, 'cache'),
    staging: join(state, 'staging'),
    journal: join(state, 'journal.json'),
    mutex: join(state, 'runtime.lock'),
    revocations: join(state, 'revocations.json'),
    adFrequency: join(state, 'ad-frequency.json'),
    eventOutbox: join(state, 'event-outbox.json'),
    runs: join(state, 'runs'),
  };
}

export function isInside(parent: string, candidate: string): boolean {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

export async function canonicalProjectRoot(projectRoot: string): Promise<string> {
  const resolved = resolve(projectRoot);
  const info = await stat(resolved).catch(() => null);
  if (!info?.isDirectory()) throw new SkillFluxError('PROJECT_NOT_FOUND', `Project directory does not exist: ${resolved}`);
  return realpath(resolved);
}

export async function ensureStateLayout(paths: RuntimePaths): Promise<void> {
  await assertNoSymlinkPath(paths.root, paths.state, true);
  await mkdir(paths.state, { recursive: true, mode: 0o700 });
  await assertNoSymlinkPath(paths.root, paths.state, false);
  const directories = [paths.history, paths.plans, paths.skills, paths.cache, paths.staging, paths.runs];
  for (const directory of directories) {
    await assertNoSymlinkPath(paths.root, directory, true);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await assertNoSymlinkPath(paths.root, directory, false);
  }
}

export async function assertNoSymlinkPath(root: string, target: string, allowMissingLeaf = false): Promise<void> {
  const absoluteRoot = resolve(root);
  const absoluteTarget = resolve(target);
  if (!isInside(absoluteRoot, absoluteTarget)) throw new SkillFluxError('PATH_OUTSIDE_PROJECT', `Path escapes project: ${absoluteTarget}`);
  const rel = relative(absoluteRoot, absoluteTarget);
  if (!rel) return;
  let cursor = absoluteRoot;
  const parts = rel.split(sep);
  for (let index = 0; index < parts.length; index += 1) {
    cursor = join(cursor, parts[index]);
    const item = await lstat(cursor).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!item) {
      if (allowMissingLeaf) return;
      throw new SkillFluxError('PATH_MISSING', `Expected path does not exist: ${cursor}`);
    }
    if (item.isSymbolicLink()) throw new SkillFluxError('SYMLINK_REJECTED', `Symbolic links are not allowed in runtime paths: ${cursor}`);
  }
}

export async function readJson<T>(path: string): Promise<T> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') throw new SkillFluxError('STATE_NOT_FOUND', `Required state file is missing: ${path}`);
    throw error;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SkillFluxError('INVALID_JSON', `Invalid JSON in ${path}`);
  }
}

export async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    return await readJson<T>(path);
  } catch (error) {
    if (error instanceof SkillFluxError && error.code === 'STATE_NOT_FOUND') return null;
    throw error;
  }
}

export async function atomicWriteJson(path: string, value: unknown, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode, flag: 'wx' });
  await rename(temporary, path);
}

export async function atomicWriteText(path: string, value: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, { encoding: 'utf8', mode, flag: 'wx' });
  await rename(temporary, path);
}

export async function withProjectLock<T>(paths: RuntimePaths, operation: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
  const started = Date.now();
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  while (!handle) {
    await assertNoSymlinkPath(paths.root, paths.mutex, true);
    try {
      handle = await open(paths.mutex, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'EEXIST') throw error;
      const existing = await stat(paths.mutex).catch(() => null);
      if (existing) {
        let stalePid: number | null = null;
        try {
          const value = JSON.parse(await readFile(paths.mutex, 'utf8')) as { pid?: unknown };
          stalePid = typeof value.pid === 'number' && Number.isInteger(value.pid) && value.pid > 0 ? value.pid : null;
        } catch {
          stalePid = null;
        }
        let ownerAlive = true;
        if (stalePid !== null) {
          try {
            process.kill(stalePid, 0);
          } catch (ownerError) {
            const ownerNodeError = ownerError as NodeJS.ErrnoException;
            ownerAlive = ownerNodeError.code === 'EPERM';
          }
        }
        if ((!ownerAlive && stalePid !== null) || (stalePid === null && Date.now() - existing.mtimeMs > 120_000)) {
          const current = await stat(paths.mutex).catch(() => null);
          if (current && current.ino === existing.ino && current.mtimeMs === existing.mtimeMs && current.size === existing.size) {
            await rm(paths.mutex, { force: true });
            continue;
          }
        }
      }
      if (Date.now() - started >= timeoutMs) throw new SkillFluxError('PROJECT_BUSY', 'Another SkillFlux operation is active for this project');
      await new Promise(resolveWait => setTimeout(resolveWait, 50));
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => undefined);
    await rm(paths.mutex, { force: true }).catch(() => undefined);
  }
}

export async function removeIfExists(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}
