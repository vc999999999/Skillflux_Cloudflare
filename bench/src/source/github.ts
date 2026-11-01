// GitHub access through curl, which honours HTTPS_PROXY the way Node's fetch
// does not. GITHUB_TOKEN raises the API rate limit; it is optional.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface RepoRef { owner: string; repo: string }

export function parseRepoUrl(url: string): RepoRef {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/.exec(url);
  if (!match) throw new Error(`not a GitHub repository URL: ${url}`);
  return { owner: match[1]!, repo: match[2]! };
}

function authHeaders(): string[] {
  const token = process.env.GITHUB_TOKEN;
  return token ? ['-H', `Authorization: Bearer ${token}`] : [];
}

export async function curl(url: string, extra: string[] = []): Promise<Buffer> {
  try {
    const { stdout } = await run('curl', ['-fsSL', '--max-time', '120', '--retry', '4', '--retry-all-errors', '--retry-delay', '2', ...extra, url], {
      encoding: 'buffer', maxBuffer: 512 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    // Never echo the command line: it carries the Authorization header.
    const stderr = (error as { stderr?: Buffer }).stderr?.toString('utf8').trim().split('\n').at(-1) ?? '';
    throw new Error(`request failed: ${url}${stderr ? ` (${stderr})` : ''}`);
  }
}

// Set after the first 403: some networks deny the REST API for repositories
// outside an allow-list. Every caller has a git fallback, so later calls fail fast.
let apiDenied = false;

export async function api<T>(path: string): Promise<T> {
  if (apiDenied) throw new Error(`GitHub API unavailable: ${path}`);
  try {
    const body = await curl(`https://api.github.com${path}`, [
      '--retry', '0', '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28', ...authHeaders(),
    ]);
    return JSON.parse(body.toString('utf8')) as T;
  } catch (error) {
    if (/error: 403/.test((error as Error).message)) apiDenied = true;
    throw error;
  }
}

export async function resolveHead({ owner, repo }: RepoRef): Promise<string> {
  const info = await api<{ default_branch: string }>(`/repos/${owner}/${repo}`);
  const commit = await api<{ sha: string }>(`/repos/${owner}/${repo}/commits/${encodeURIComponent(info.default_branch)}`);
  return commit.sha;
}

export interface RepoMeta { stars: number; archived: boolean; licenseSpdx: string | null; pushedAt: string | null }

export async function repoMeta({ owner, repo }: RepoRef): Promise<RepoMeta> {
  const info = await api<{ stargazers_count: number; archived: boolean; license: { spdx_id: string } | null; pushed_at: string | null }>(`/repos/${owner}/${repo}`);
  const spdx = info.license?.spdx_id;
  return { stars: info.stargazers_count, archived: info.archived, licenseSpdx: spdx && spdx !== 'NOASSERTION' ? spdx : null, pushedAt: info.pushed_at };
}

// Commit history without file contents, for networks where the REST API is
// unavailable but git over HTTPS works. One bare clone per repository per process.
const HISTORY_DIR = resolve(import.meta.dirname, '../../cache/history');
const historyClones = new Map<string, Promise<string>>();

export function historyClone({ owner, repo }: RepoRef): Promise<string> {
  const key = `${owner}/${repo}`.toLowerCase();
  let pending = historyClones.get(key);
  if (!pending) {
    pending = (async () => {
      const dir = join(HISTORY_DIR, `${owner}-${repo}.git`);
      const url = `https://github.com/${owner}/${repo}.git`;
      if (existsSync(join(dir, 'HEAD'))) await run('git', ['-C', dir, 'fetch', '-q', '--filter=blob:none', url, '+HEAD:refs/heads/upstream']);
      else {
        await mkdir(HISTORY_DIR, { recursive: true });
        await run('git', ['clone', '-q', '--bare', '--filter=blob:none', url, dir]);
        await run('git', ['-C', dir, 'update-ref', 'refs/heads/upstream', 'HEAD']);
      }
      return dir;
    })();
    historyClones.set(key, pending);
  }
  return pending;
}

async function gitOut(dir: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', dir, ...args], { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

/** Default-branch head commit, read from git when the REST API is unavailable. */
export async function headSha(ref: RepoRef): Promise<string> {
  return resolveHead(ref).catch(async () => {
    const { stdout } = await run('git', ['ls-remote', `https://github.com/${ref.owner}/${ref.repo}.git`, 'HEAD'], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    const sha = stdout.split(/\s/)[0] ?? '';
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`no HEAD for ${ref.owner}/${ref.repo}`);
    return sha;
  });
}

/** Last commit touching a path at or before the pinned commit. */
export async function lastCommitAt({ owner, repo }: RepoRef, path: string, sha: string): Promise<string | null> {
  try {
    const query = new URLSearchParams({ sha, per_page: '1', ...(path ? { path } : {}) });
    const commits = await api<Array<{ commit: { committer: { date: string } } }>>(`/repos/${owner}/${repo}/commits?${query}`);
    return commits[0]?.commit.committer.date ?? null;
  } catch {
    const dir = await historyClone({ owner, repo });
    const date = await gitOut(dir, ['log', '-1', '--format=%cI', sha, ...(path ? ['--', path] : [])]);
    return date ? new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z') : null;
  }
}

/** Commits on the default branch since the pin that touch the skill's path. */
export async function commitsSincePin({ owner, repo }: RepoRef, path: string, sha: string): Promise<number | null> {
  try {
    const compare = await api<{ status: string; commits: Array<{ sha: string }>; files?: Array<{ filename: string }> }>(`/repos/${owner}/${repo}/compare/${sha}...HEAD`);
    if (compare.status === 'identical') return 0;
    if (!compare.files) return null;
    const prefix = path ? `${path}/` : '';
    const touched = compare.files.some(file => file.filename.startsWith(prefix));
    return touched ? compare.commits.length : 0;
  } catch {
    const dir = await historyClone({ owner, repo });
    // Same answer as the compare API: every commit since the pin if any of them touched the path.
    const touched = await gitOut(dir, ['rev-list', '--count', `${sha}..upstream`, ...(path ? ['--', path] : [])]);
    return Number(touched) > 0 ? Number(await gitOut(dir, ['rev-list', '--count', `${sha}..upstream`])) : 0;
  }
}
