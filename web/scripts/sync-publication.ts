import { readFile, mkdir, rename, writeFile, lstat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { sha256, safeRelativePath, type Bundle, type Host, type Manifest } from '../../mcp/src/shared';
import type { CatalogIndex, CatalogIndexEntry } from '../../mcp/src/catalog/model';
import { validatePublication, type PublishedSkill, type PublicationSnapshot } from '../src/lib/publication';

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_SOURCE = 'https://raw.githubusercontent.com';
const DEFAULT_BRANCH = 'main';

function normalizeSourceUrl(input: string | undefined): string {
  if (!input) return DEFAULT_SOURCE;
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`Invalid catalog source URL: ${input}`);
  }
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('Catalog source must use HTTPS; HTTP is allowed only for a loopback development mirror');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Catalog source URL cannot contain credentials, query parameters or fragments');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function parseRepoRef(input: string): string {
  const value = input.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const shorthand = value.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (shorthand) return `${shorthand[1]}/${shorthand[2]}`;
  try {
    const url = new URL(value);
    if (url.hostname === 'github.com' || url.hostname === 'www.github.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length === 2) return `${parts[0]}/${parts[1]}`;
    }
  } catch { /* fall through */ }
  throw new Error(`Invalid catalog repository reference: ${input}. Use owner/name or a github.com URL.`);
}

async function fetchLimited(url: string, limit: number, init?: { headers?: Record<string, string> }): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'error', headers: init?.headers });
  if (response.status === 404) throw new Error(`Catalog resource not found: ${url}`);
  if (!response.ok) throw new Error(`Catalog request failed: HTTP ${response.status} at ${url}`);
  if (!response.body) throw new Error('Empty catalog response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new Error(`Catalog response exceeds ${limit} bytes: ${url}`); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return combined;
}

async function fetchJson<T>(url: string, limit = MAX_RESPONSE_BYTES): Promise<T> {
  const bytes = await fetchLimited(url, limit, { headers: { accept: 'application/json', 'user-agent': 'skillflux-web-sync' } });
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

const GITHUB_API_SOURCE = 'https://api.github.com';

/** Sync a publication snapshot from the GitHub catalog repository at a pinned commit. */
export interface PublicationStatusEntry {
  id: string; version: string; name: string; digest: string; status: string;
  qualification: 'qualified' | 'needs-testing' | 'revoked'; createdAt: string; reason?: string;
}

export async function synchronizePublication(options: { repo: string; output: string; source?: string; branch?: string }): Promise<PublicationSnapshot> {
  const repo = parseRepoRef(options.repo);
  let previous: PublicationSnapshot | undefined;
  try { previous = JSON.parse(await readFile(options.output, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (previous) validatePublication(previous);
  if (previous?.repo && previous.repo !== repo) {
    throw new Error(`Publication is pinned to ${previous.repo}; refusing to switch to ${repo}. Use a separate output path for a new catalog repository.`);
  }
  const source = normalizeSourceUrl(options.source);
  const branch = options.branch ?? DEFAULT_BRANCH;
  // The head-resolution API host follows the source: loopback sources (fixtures,
  // local mirrors) serve the GitHub-style API on the same origin at /api.
  const apiBase = source === DEFAULT_SOURCE ? GITHUB_API_SOURCE : `${source}/api`;
  const head = await fetchJson<{ sha?: string }>(`${apiBase}/repos/${repo}/commits/${branch}`);
  if (!head?.sha || !/^[0-9a-f]{40}$/.test(head.sha)) throw new Error(`Could not resolve ${repo}@${branch} to a commit SHA`);
  const raw = (path: string): string => `${source}/${repo}/${head.sha}/${path.replace(/^\//, '')}`;
  const index = await fetchJson<CatalogIndex>(raw('index.json'));
  if (!index || index.schema !== 'skillflux-catalog-index/v1' || !Array.isArray(index.skills)) throw new Error(`Catalog index at ${repo}@${head.sha.slice(0, 10)} is invalid`);
  const items: PublishedSkill[] = [];
  for (const catalogEntry of index.skills) {
    // Only approved, qualified versions publish installable content; revoked or
    // needs-testing entries appear in the status list only.
    if (catalogEntry.skill.status !== 'approved' || catalogEntry.skill.qualification !== 'qualified') continue;
    const published = await syncEntry(catalogEntry, raw);
    items.push(published);
  }
  // Status track: every catalog entry contributes a status record; only approved+qualified
  // entries additionally contribute installable content. Revoked/needs-testing versions stay
  // visible as status (with the public review note as reason) without publishing their files.
  const statuses: PublicationStatusEntry[] = index.skills.map(catalogEntry => {
    const skill = catalogEntry.skill;
    const base = { id: skill.id, version: skill.version, name: skill.name, digest: skill.digest, status: skill.status, qualification: skill.qualification, createdAt: skill.createdAt };
    if (skill.qualification === 'qualified') return base;
    return { ...base, reason: skill.quality.review?.notes };
  });
  const snapshot: PublicationSnapshot = { schema: 'skillflux-publication/v2', repo, commitSha: head.sha, fetchedAt: new Date().toISOString(), items, statuses };
  validatePublication(snapshot);
  await mkdir(dirname(options.output), { recursive: true });
  const stat = await lstat(options.output).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
  if (stat?.isSymbolicLink()) throw new Error('Refusing to replace a symlinked publication output');
  const staged = `${options.output}.${randomUUID()}.tmp`;
  await writeFile(staged, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
  await rename(staged, options.output);
  return snapshot;
}

async function syncEntry(entry: CatalogIndexEntry, raw: (path: string) => string): Promise<PublishedSkill> {
  const summary = entry.skill;
  const manifest: Manifest = {
    schema: 'skillflux/v1',
    id: summary.id, version: summary.version, name: summary.name, description: summary.description,
    category: summary.category, tags: summary.tags, hosts: summary.hosts as Host[],
    publisher: summary.publisher, license: summary.license, entry: summary.entry,
    permissions: summary.permissions, dependencies: summary.dependencies,
    createdAt: summary.createdAt, ...(summary.release ? { release: summary.release } : {}),
  };
  (manifest as Manifest & { files: Array<{ path: string; sha256: string; size: number }> }).files = entry.files;
  const files: Record<string, string> = {};
  for (const file of entry.files) {
    if (!safeRelativePath(file.path)) throw new Error(`Unsafe file path in index: ${file.path}`);
    const bytes = await fetchLimited(raw(`skills/${summary.category}/${summary.id}/${summary.version}/${file.path}`), MAX_FILE_BYTES, { headers: { 'user-agent': 'skillflux-web-sync' } });
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (bytes.byteLength !== file.size || sha256(text) !== file.sha256) {
      throw new Error(`Downloaded file does not match the catalog hash: ${summary.id}/${summary.version}/${file.path}`);
    }
    files[file.path] = text;
  }
  const declaredSize = summary.size;
  const computedSize = entry.files.reduce((sum, file) => sum + file.size, 0);
  if (Number.isSafeInteger(declaredSize) && declaredSize !== computedSize) {
    throw new Error(`Catalog size mismatch for ${summary.id}@${summary.version}: declared ${declaredSize} bytes, files sum to ${computedSize}`);
  }
  const bundle: Bundle = { manifest, files };
  return { skill: summary, bundle };
}

async function main(): Promise<void> {
  const parsed = parseArgs({ options: {
    repo: { type: 'string' }, source: { type: 'string' }, branch: { type: 'string' },
    output: { type: 'string' }, help: { type: 'boolean', default: false },
  } });
  if (parsed.values.help) {
    process.stdout.write('Sync the curated catalog from GitHub: npm run publication:sync --workspace @skillflux/web -- --repo OWNER/NAME [--source URL] [--output PATH]\nAll files are downloaded at the resolved commit SHA and verified against index.json hashes. Failed syncs never replace the previous snapshot.\n');
    return;
  }
  const repo = parsed.values.repo ?? process.env.SKILLFLUX_CATALOG_REPO;
  if (!repo) throw new Error('Set --repo or SKILLFLUX_CATALOG_REPO. The directory can build without a catalog; curated publication cannot sync without one.');
  const output = resolve(parsed.values.output ?? process.env.SKILLFLUX_PUBLICATION_PATH ?? fileURLToPath(new URL('../data/registry-publication.json', import.meta.url)));
  const snapshot = await synchronizePublication({ repo, output, source: parsed.values.source, branch: parsed.values.branch });
  process.stdout.write(`Verified ${snapshot.items.length} curated versions from ${snapshot.repo}@${snapshot.commitSha!.slice(0, 10)}; snapshot: ${output}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`${(error as Error).message}\n`); process.exitCode = 1; });
