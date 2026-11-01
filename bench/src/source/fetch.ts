// Downloads a repository snapshot at an exact commit into bench/cache. The
// cache key is the commit SHA, so a pinned snapshot is fetched only once.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { BENCH_ROOT } from '../paths.js';
import { curl, type RepoRef } from './github.js';

const run = promisify(execFile);

export const CACHE_DIR = join(BENCH_ROOT, 'cache');

export async function fetchSnapshot(ref: RepoRef, sha: string): Promise<string> {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`commit must be a full SHA: ${sha}`);
  const target = join(CACHE_DIR, `${ref.owner}-${ref.repo}-${sha}`);
  if (existsSync(join(target, '.complete'))) return target;
  const staging = `${target}.partial`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    const archive = await curl(`https://codeload.github.com/${ref.owner}/${ref.repo}/tar.gz/${sha}`);
    const tarball = `${staging}.tar.gz`;
    await writeFile(tarball, archive);
    // GitHub archives wrap everything in one <repo>-<sha>/ directory.
    await run('tar', ['-xzf', tarball, '-C', staging, '--strip-components', '1']);
    await rm(tarball, { force: true });
  } catch {
    // Some networks block codeload; a shallow git fetch of the exact commit works there.
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    const git = (...args: string[]) => run('git', ['-C', staging, ...args], { maxBuffer: 64 * 1024 * 1024 });
    await git('init', '-q');
    await git('fetch', '-q', '--depth', '1', `https://github.com/${ref.owner}/${ref.repo}.git`, sha);
    await git('-c', 'advice.detachedHead=false', 'checkout', '-q', 'FETCH_HEAD');
    await rm(join(staging, '.git'), { recursive: true, force: true });
  }
  await writeFile(join(staging, '.complete'), `${sha}\n`);
  await rm(target, { recursive: true, force: true });
  await rename(staging, target);
  return target;
}

export interface SnapshotFile { path: string; bytes: number; content: Buffer }

/** Every regular file under dir, with POSIX paths relative to dir. Symlinks are skipped. */
export async function listFiles(dir: string): Promise<SnapshotFile[]> {
  const files: SnapshotFile[] = [];
  async function walk(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.complete') continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const content = await readFile(path);
        files.push({ path: relative(dir, path).split(sep).join('/'), bytes: (await stat(path)).size, content });
      }
    }
  }
  await walk(dir);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Directories (relative to the snapshot root) that contain a SKILL.md. */
export async function findSkillDirs(root: string): Promise<string[]> {
  const files = await listFiles(root);
  return files.filter(file => /(^|\/)SKILL\.md$/.test(file.path))
    .map(file => file.path.replace(/\/?SKILL\.md$/, ''))
    .sort();
}
