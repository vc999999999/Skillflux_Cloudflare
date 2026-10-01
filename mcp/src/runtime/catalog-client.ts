import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SkillFluxError } from './errors.js';
import type { CatalogIndex, CatalogIndexEntry } from '../catalog/model.js';

const DEFAULT_SOURCE = 'https://raw.githubusercontent.com';
const GITHUB_API = 'https://api.github.com';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_INDEX_BYTES = 16 * 1024 * 1024;
const DEFAULT_BRANCH = 'main';
const SHA_PATTERN = /^[0-9a-f]{40}$/;

export const DEFAULT_CATALOG_REPO = 'vc999999999/skillflux-catalog';

export function parseRepoRef(input: string): { owner: string; repo: string } {
  const value = input.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const shorthand = value.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (shorthand) return { owner: shorthand[1]!, repo: shorthand[2]! };
  const url = (() => { try { return new URL(value); } catch { return null; } })();
  if (url && (url.hostname === 'github.com' || url.hostname === 'www.github.com')) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 2) return { owner: parts[0]!, repo: parts[1]! };
  }
  throw new SkillFluxError('INVALID_REPO_REF', `Invalid catalog repository reference: ${input}. Use owner/name or a github.com URL.`);
}

export function normalizeSourceUrl(input: string | undefined): string {
  if (!input) return DEFAULT_SOURCE;
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new SkillFluxError('INVALID_SOURCE_URL', `Invalid catalog source URL: ${input}`);
  }
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new SkillFluxError('INSECURE_SOURCE_URL', 'Catalog source must use HTTPS; HTTP is allowed only for loopback development');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new SkillFluxError('INVALID_SOURCE_URL', 'Catalog source URL cannot contain credentials, query parameters or fragments');
  }
  return parsed.toString().replace(/\/+$/, '');
}

/** Resolved catalog source: a fixed repo plus a pinned commit that all downloads anchor to. */
export interface CatalogSource {
  repo: string;
  owner: string;
  name: string;
  source: string;
  branch: string;
  commitSha: string;
  apiBase: string;
}

export interface FetchedIndex {
  index: CatalogIndex;
  commitSha: string;
  fetchedAt: string;
}

export class CatalogClient {
  readonly repo: string;
  readonly source: string;
  readonly branch: string;
  readonly apiBase: string;
  readonly timeoutMs: number;

  constructor(repo: string, options: { source?: string; branch?: string; apiBase?: string; timeoutMs?: number } = {}) {
    const parsed = parseRepoRef(repo);
    this.repo = `${parsed.owner}/${parsed.repo}`;
    this.source = normalizeSourceUrl(options.source);
    this.branch = options.branch ?? DEFAULT_BRANCH;
    // Loopback sources (test fixtures, local mirrors) serve the GitHub-style
    // head-resolution API on the same origin; only GitHub splits the two hosts.
    this.apiBase = options.apiBase ?? (this.source === DEFAULT_SOURCE ? GITHUB_API : `${this.source}/api`);
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async resolveHead(): Promise<string> {
    // GitHub API path; custom sources fall back to resolving through the raw service below.
    const url = `${this.apiBase}/repos/${this.repo}/commits/${this.branch}`;
    const payload = await this.requestJson<{ sha?: string }>(url, MAX_RESPONSE_BYTES);
    if (!payload?.sha || !SHA_PATTERN.test(payload.sha)) {
      throw new SkillFluxError('INVALID_REPO_RESPONSE', `Could not resolve ${this.repo}@${this.branch} to a commit SHA`);
    }
    return payload.sha;
  }

  rawUrl(sha: string, path: string): string {
    if (!SHA_PATTERN.test(sha)) throw new SkillFluxError('INVALID_COMMIT_SHA', `Invalid commit SHA: ${sha}`);
    if (!path.startsWith('/') ) throw new SkillFluxError('INVALID_CATALOG_PATH', `Catalog path must be absolute: ${path}`);
    return `${this.source}/${this.repo}/${sha}${path}`;
  }

  async fetchIndex(options: { sha?: string } = {}): Promise<FetchedIndex> {
    const sha = options.sha ?? await this.resolveHead();
    const payload = await this.requestJson<CatalogIndex>(this.rawUrl(sha, '/index.json'), MAX_INDEX_BYTES);
    if (!payload || payload.schema !== 'skillflux-catalog-index/v1' || !Array.isArray(payload.skills)) {
      throw new SkillFluxError('INVALID_CATALOG_INDEX', `Catalog index at ${this.repo}@${sha.slice(0, 10)} is invalid`);
    }
    return { index: payload, commitSha: sha, fetchedAt: new Date().toISOString() };
  }

  async fetchFile(sha: string, path: string, expected: { sha256: string; size: number }): Promise<string> {
    const url = this.rawUrl(sha, `/skills/${path}`);
    const response = await this.fetch(url);
    const bytes = await readLimitedBody(response, MAX_RESPONSE_BYTES);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (bytes.byteLength !== expected.size) {
      throw new SkillFluxError('FILE_SIZE_MISMATCH', `${path}: expected ${expected.size} bytes, downloaded ${bytes.byteLength}`);
    }
    const { sha256 } = await import('../shared.js');
    if (sha256(bytes) !== expected.sha256) {
      throw new SkillFluxError('FILE_HASH_MISMATCH', `${path}: downloaded content does not match the catalog hash`);
    }
    return text;
  }

  private async requestJson<T>(url: string, limit: number): Promise<T> {
    const response = await this.fetch(url);
    const bytes = await readLimitedBody(response, limit);
    try {
      return JSON.parse(new TextDecoder('utf-8').decode(bytes)) as T;
    } catch {
      throw new SkillFluxError('INVALID_REPO_RESPONSE', `Catalog source returned an unreadable response for ${url}`);
    }
  }

  private async fetch(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'application/json', 'user-agent': 'skillflux-runtime' },
      });
      if (response.status >= 300 && response.status < 400) {
        throw new SkillFluxError('REDIRECT_REJECTED', `Catalog source redirects are not accepted: ${url}`);
      }
      if (!response.ok) {
        if (response.status === 404) throw new SkillFluxError('CATALOG_NOT_FOUND', `Catalog resource not found: ${url}`);
        throw new SkillFluxError('SOURCE_UNAVAILABLE', `Catalog source returned HTTP ${response.status} for ${url}`, { status: response.status });
      }
      return response;
    } catch (error) {
      if (error instanceof SkillFluxError) throw error;
      if ((error as Error).name === 'AbortError') throw new SkillFluxError('SOURCE_TIMEOUT', `Catalog source request timed out: ${url}`);
      throw new SkillFluxError('SOURCE_UNAVAILABLE', `Catalog source request failed: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readLimitedBody(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel('response too large');
        throw new SkillFluxError('SOURCE_RESPONSE_TOO_LARGE', `Catalog response exceeds ${limit} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

/** Load an index from a local catalog directory (tests and offline development). */
export async function readLocalCatalogIndex(catalogRoot: string): Promise<FetchedIndex> {
  const { versionContentHash } = await import('../catalog/build.js');
  const payload = JSON.parse(await readFile(join(catalogRoot, 'index.json'), 'utf8')) as CatalogIndex;
  if (payload.schema !== 'skillflux-catalog-index/v1' || !Array.isArray(payload.skills)) {
    throw new SkillFluxError('INVALID_CATALOG_INDEX', `Catalog index at ${catalogRoot} is invalid`);
  }
  return { index: payload, commitSha: versionContentHash({} as never, {}) || 'local', fetchedAt: new Date().toISOString() };
}

export function findEntry(index: CatalogIndex, id: string, version?: string): CatalogIndexEntry | undefined {
  const versions = index.skills.filter(entry => entry.skill.id === id);
  if (!versions.length) return undefined;
  if (!version) return versions[0];
  return versions.find(entry => entry.skill.version === version);
}
