// GitHub access through curl, which honours HTTPS_PROXY the way Node's fetch
// does not. GITHUB_TOKEN raises the API rate limit; it is optional.
import { execFile } from 'node:child_process';
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

export async function api<T>(path: string): Promise<T> {
  const body = await curl(`https://api.github.com${path}`, [
    '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28', ...authHeaders(),
  ]);
  return JSON.parse(body.toString('utf8')) as T;
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

/** Last commit touching a path at or before the pinned commit. */
export async function lastCommitAt({ owner, repo }: RepoRef, path: string, sha: string): Promise<string | null> {
  const query = new URLSearchParams({ sha, per_page: '1', ...(path ? { path } : {}) });
  const commits = await api<Array<{ commit: { committer: { date: string } } }>>(`/repos/${owner}/${repo}/commits?${query}`);
  return commits[0]?.commit.committer.date ?? null;
}

/** Commits on the default branch since the pin that touch the skill's path. */
export async function commitsSincePin({ owner, repo }: RepoRef, path: string, sha: string): Promise<number | null> {
  const compare = await api<{ status: string; commits: Array<{ sha: string }>; files?: Array<{ filename: string }> }>(`/repos/${owner}/${repo}/compare/${sha}...HEAD`);
  if (compare.status === 'identical') return 0;
  if (!compare.files) return null;
  const prefix = path ? `${path}/` : '';
  const touched = compare.files.some(file => file.filename.startsWith(prefix));
  return touched ? compare.commits.length : 0;
}
