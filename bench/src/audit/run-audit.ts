// Sampled static health check of a directory source. The source repository
// is pinned to a commit; a seeded sample of the skills it holds (method
// "repo") or links to (method "list") is checked with the L1 checker, and the
// result is written to web/data/source-audits/<slug>.json.
import { createHash } from 'node:crypto';
import { join, posix } from 'node:path';
import { CHECKER_VERSION, runHealthChecks } from '../health/checks.js';
import { WEB_DATA, today, writeJson } from '../paths.js';
import { SourceAudit, summarizeAudit, type SourceAuditItem } from '../schema.js';
import { openSparse } from '../source/sparse.js';
import { api, headSha, parseRepoUrl, repoMeta, type RepoRef } from '../source/github.js';

export const AUDITS_DIR = join(WEB_DATA, 'source-audits');

export interface AuditOptions {
  siteSlug: string;
  repo: string;
  method: 'repo' | 'list';
  sampleSize?: number;
  sha?: string;
}

export interface Candidate { repo: string; linkedPath: string | null; linkedName: string | null }

/** Deterministic shuffle: the same seed always gives the same sample. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  const keyed = items.map((item, index) => ({ item, key: createHash('sha256').update(`${seed}:${index}`).digest('hex') }));
  return keyed.sort((a, b) => a.key.localeCompare(b.key)).map(entry => entry.item);
}

// Test fixtures, examples and templates are not skills a user would install.
const NOT_A_SKILL = /(^|\/)(tests?|__tests__|fixtures?|golden|examples?|templates?|testdata|node_modules)(\/|$)/i;

export function skillDirs(paths: string[]): string[] {
  return paths.filter(path => /(^|\/)SKILL\.md$/.test(path)).map(path => path.replace(/\/?SKILL\.md$/, ''))
    .filter(dir => !NOT_A_SKILL.test(dir)).sort();
}

const NON_REPO_OWNERS = new Set(['topics', 'orgs', 'sponsors', 'marketplace', 'features', 'apps', 'settings', 'login', 'about', 'collections', 'search', 'site', 'pricing', 'enterprise']);

/**
 * GitHub links in a list's Markdown files, normalized to repository + directory.
 * Links through third-party mirrors (officialskills.sh, skills.sh) are not
 * followed: their slugs do not always match a real repository.
 */
export function extractCandidates(markdown: string, self: RepoRef): Candidate[] {
  const seen = new Map<string, Candidate>();
  const add = (owner: string, repo: string, linkedPath: string | null, linkedName: string | null) => {
    if (NON_REPO_OWNERS.has(owner.toLowerCase())) return;
    if (owner.toLowerCase() === self.owner.toLowerCase() && repo.toLowerCase() === self.repo.toLowerCase()) return;
    const candidate = { repo: `https://github.com/${owner}/${repo}`, linkedPath, linkedName };
    const key = `${candidate.repo.toLowerCase()}#${linkedPath ?? ''}#${linkedName ?? ''}`;
    if (!seen.has(key)) seen.set(key, candidate);
  };
  for (const match of markdown.matchAll(/https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:\/(tree|blob)\/[^/\s)#"'>]+\/([^\s)#"'>]+))?(?=[\s)#"'>]|$)/g)) {
    const [, owner, repo, kind, rawPath] = match;
    let path = rawPath ? decodeURIComponent(rawPath).replace(/\/+$/, '') : null;
    if (path && kind === 'blob') path = /(^|\/)SKILL\.md$/i.test(path) ? posix.dirname(path).replace(/^\.$/, '') : null;
    add(owner!, repo!, path || null, null);
  }
  return [...seen.values()];
}

async function checkCandidate(candidate: Candidate, seed: string, pinnedSha?: string): Promise<SourceAuditItem> {
  const base = { repo: candidate.repo, linkedPath: candidate.linkedPath ?? candidate.linkedName, counts: null, name: null, scriptCount: null, bodyTokensApprox: null, licenseSpdx: null };
  const ref = parseRepoUrl(candidate.repo);
  let sha: string;
  let repo: Awaited<ReturnType<typeof openSparse>>;
  try {
    sha = pinnedSha ?? await headSha(ref);
    repo = await openSparse(ref, sha);
  } catch (error) {
    return { ...base, flags: [], statuses: {}, outcome: 'unreachable', commitSha: null, path: null, detail: (error as Error).message.split('\n')[0]!.slice(0, 200) };
  }
  const dirs = skillDirs(repo.paths);
  let pool = dirs;
  if (candidate.linkedPath !== null) pool = dirs.filter(dir => dir === candidate.linkedPath || dir.startsWith(`${candidate.linkedPath}/`));
  else if (candidate.linkedName !== null) pool = dirs.filter(dir => posix.basename(dir).toLowerCase() === candidate.linkedName!.toLowerCase());
  const dir = candidate.linkedPath !== null && pool.includes(candidate.linkedPath) ? candidate.linkedPath : seededShuffle(pool, `${seed}:${candidate.repo}`)[0];
  if (dir === undefined) {
    const where = candidate.linkedPath ?? candidate.linkedName;
    return { ...base, flags: [], statuses: {}, outcome: 'no-skill', commitSha: sha, path: null, detail: where ? `no SKILL.md for ${where}` : 'no SKILL.md in the repository' };
  }
  const prefix = dir ? `${dir}/` : '';
  const files = await repo.read(dir);
  const meta = await repoMeta(ref).catch(() => null);
  // REST API only: the git fallback downloads full histories, too slow for a sample of large repositories.
  const changed = await api<Array<{ commit: { committer: { date: string } } }>>(`/repos/${ref.owner}/${ref.repo}/commits?${new URLSearchParams({ sha, per_page: '1', ...(dir ? { path: dir } : {}) })}`)
    .then(commits => commits[0]?.commit.committer.date ?? null).catch(() => null);
  const result = runHealthChecks({
    dirName: posix.basename(dir) || ref.repo,
    files: files.filter(file => file.path.startsWith(prefix)).map(file => ({ ...file, path: file.path.slice(prefix.length) })),
    repoFiles: new Set(repo.paths),
    skillPath: dir,
    repoLicenseFile: repo.paths.find(path => /^(?:LICEN[CS]E|COPYING)(?:\.[a-z]+)?$/i.test(path)) ?? null,
    repoLicenseSpdx: meta?.licenseSpdx ?? null,
    archived: meta?.archived ?? null,
    lastCommitAt: changed,
    commitsSincePin: 0,
    checkedAt: today(),
  });
  const counts = { pass: 0, warn: 0, fail: 0, info: 0 };
  for (const item of result.checks) counts[item.status] += 1;
  return {
    ...base,
    outcome: 'checked',
    commitSha: sha,
    path: dir,
    name: result.name,
    counts,
    flags: result.flags,
    statuses: Object.fromEntries(result.checks.map(item => [item.id, item.status])),
    scriptCount: result.metrics.scriptCount,
    bodyTokensApprox: result.metrics.bodyTokensApprox,
    licenseSpdx: result.license.spdx,
    detail: `${counts.pass} pass, ${counts.warn} warn, ${counts.fail} fail`,
  };
}

export async function auditSource(options: AuditOptions): Promise<SourceAudit> {
  const ref = parseRepoUrl(options.repo);
  const sha = options.sha ?? await headSha(ref);
  const listing = await openSparse(ref, sha);
  const requested = options.sampleSize ?? 20;
  const seed = `${options.siteSlug}@${sha.slice(0, 12)}`;
  let candidates: Candidate[];
  if (options.method === 'repo') {
    candidates = skillDirs(listing.paths).map(dir => ({ repo: `https://github.com/${ref.owner}/${ref.repo}`, linkedPath: dir, linkedName: null }));
  } else {
    const markdown = (await listing.read('')).filter(file => /\.md$/i.test(file.path) && !/(^|\/)(CONTRIBUTING|CODE_OF_CONDUCT|SECURITY|CHANGELOG|LICENSE)\.md$/i.test(file.path)).map(file => file.content.toString('utf8')).join('\n');
    candidates = extractCandidates(markdown, ref);
  }
  const items: SourceAuditItem[] = [];
  for (const candidate of seededShuffle(candidates, seed).slice(0, requested)) {
    // A repository source is checked at its own pinned commit; linked repositories at their current head.
    const item = await checkCandidate(candidate, seed, options.method === 'repo' ? sha : undefined);
    items.push(item);
    console.log(`  ${item.outcome.padEnd(11)} ${candidate.repo.replace('https://github.com/', '')}${item.path ? `/${item.path}` : item.linkedPath ? ` → ${item.linkedPath}` : ''}${item.counts ? ` (${item.detail}${item.flags.length ? `; ${item.flags.join(', ')}` : ''})` : ''}`);
  }
  const audit = SourceAudit.parse({
    schema: 'skillflux-source-audit/v1',
    siteSlug: options.siteSlug,
    auditedAt: today(),
    checkerVersion: CHECKER_VERSION,
    method: options.method,
    listing: { repo: `https://github.com/${ref.owner}/${ref.repo}`, commitSha: sha, candidates: candidates.length },
    sample: { seed, requested },
    items,
    summary: summarizeAudit(items),
  });
  await writeJson(join(AUDITS_DIR, `${options.siteSlug}.json`), audit);
  return audit;
}
