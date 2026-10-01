import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
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
    index: join(state, 'index.json'),
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
  const directories = [paths.history, paths.plans, paths.skills, paths.cache, paths.staging];
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

async function atomicWrite(path: string, contents: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', mode);
  try {
    await handle.writeFile(contents, 'utf8');
    // fsync so a crash cannot leave a renamed-but-empty file behind.
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function atomicWriteJson(path: string, value: unknown, mode = 0o600): Promise<void> {
  await atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`, mode);
}

export async function atomicWriteText(path: string, value: string, mode = 0o600): Promise<void> {
  await atomicWrite(path, value, mode);
}

/** Remove leftover `*.tmp-*` files from writers that crashed between write and rename. */
export async function sweepTemporaryWrites(directory: string): Promise<number> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  let removed = 0;
  for (const entry of entries) {
    if (entry.isFile() && /\.\d+\.[0-9a-f-]{8,}\.tmp$/.test(entry.name)) {
      await rm(join(directory, entry.name), { force: true }).catch(() => undefined);
      removed += 1;
    }
  }
  return removed;
}

export async function withProjectLock<T>(paths: RuntimePaths, operation: () => Promise<T>, timeoutMs = 5 * 60_000): Promise<T> {
  const started = Date.now();
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  while (!handle) {
    await assertNoSymlinkPath(paths.root, paths.mutex, true);
    try {
      handle = await open(paths.mutex, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      } catch (error) {
        await handle.close();
        handle = null;
        throw error;
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'EEXIST') throw error;
      const existing = await stat(paths.mutex).catch(() => null);
      if (existing) {
        // Break stale locks purely by age: a reused PID would otherwise make a dead
        // lock look alive forever. Two minutes is far above any legit operation.
        if (Date.now() - existing.mtimeMs > 120_000) {
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
