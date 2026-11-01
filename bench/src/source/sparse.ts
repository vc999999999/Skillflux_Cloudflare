// Reads part of a repository at an exact commit without downloading every
// file: a blobless fetch lists all paths, then only the requested
// directories (and root license files) are checked out. Used by source
// audits, which look at one skill in many large repositories.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { listFiles, CACHE_DIR, type SnapshotFile } from './fetch.js';
import type { RepoRef } from './github.js';

const run = promisify(execFile);
const LICENSE_FILE = /^(?:LICEN[CS]E|COPYING)(?:\.[a-z]+)?$/i;

export interface SparseRepo {
  sha: string;
  paths: string[];
  /** Files under `dir`, with paths relative to the repository root, plus root license files. */
  read(dir: string): Promise<SnapshotFile[]>;
}

export async function openSparse(ref: RepoRef, sha: string): Promise<SparseRepo> {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`commit must be a full SHA: ${sha}`);
  const dir = join(CACHE_DIR, 'sparse', `${ref.owner}-${ref.repo}-${sha}`);
  const git = async (...args: string[]) => (await run('git', ['-C', dir, ...args], { maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout;
  if (!existsSync(join(dir, '.git', 'sparse-ready'))) {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await git('init', '-q');
    await git('remote', 'add', 'origin', `https://github.com/${ref.owner}/${ref.repo}.git`);
    await git('fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', sha);
    await git('sparse-checkout', 'set', '--no-cone', '/LICENSE*', '/LICENCE*', '/COPYING*');
    await git('-c', 'advice.detachedHead=false', 'checkout', '-q', sha);
    await run('touch', [join(dir, '.git', 'sparse-ready')]);
  }
  const paths = (await git('ls-tree', '-r', '--name-only', sha)).split('\n').filter(Boolean).sort();
  return {
    sha,
    paths,
    async read(skillDir: string) {
      const pattern = skillDir ? `/${skillDir}/` : '/*';
      await git('sparse-checkout', 'add', pattern);
      const prefix = skillDir ? `${skillDir}/` : '';
      return (await listFiles(dir)).filter(file => file.path.startsWith(prefix) || LICENSE_FILE.test(file.path));
    },
  };
}
