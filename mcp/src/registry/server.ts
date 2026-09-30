import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type {
  AdDecision,
  AdRequest,
  ApiError,
  CampaignInput,
  Catalog,
  Revocations,
  SearchResponse,
  SkillDetail,
  SkillSummary,
  Submission,
} from '../shared.js';
import { canonical, PROTOCOL_VERSION, sha256, signPayload } from '../shared.js';
import { issueDecisionToken, loadOrCreateRegistryKeys, verifyDecisionToken } from './crypto.js';
import { compareVersions, RegistryStore, RegistryStoreError, type CampaignCandidate, type SkillRecord } from './database.js';
import { scanSubmission } from './scan.js';
import {
  adRequestSchema,
  campaignInputSchema,
  campaignPatchSchema,
  eventSchema,
  reviewSchema,
  searchQuerySchema,
  submissionSchema,
  evaluationSchema, inquirySchema, inquiryPatchSchema, reportSchema, reportPatchSchema,
} from './schemas.js';

const MAX_JSON_BODY_BYTES = 1024 * 1024;
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:4321', 'http://127.0.0.1:4321'];
const SENSITIVE_CATEGORIES = new Set([
  'crisis', 'emergency', 'finance', 'financial', 'health', 'legal', 'medical',
  'minor', 'politics', 'safety', 'self-harm', 'suicide',
]);

export interface RegistryServerOptions {
  dataDir: string;
  adminToken?: string;
  allowedOrigins?: string[];
  publicUrl?: string;
  dev?: boolean;
  seedPath?: string;
  trustedProxies?: string[];
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

interface RateEntry {
  count: number;
  resetAt: number;
}

class FixedWindowRateLimiter {
  private readonly entries = new Map<string, RateEntry>();
  private requests = 0;
  private readonly maximumEntries = 50_000;

  consume(key: string, limit: number, windowMs = 60_000): { allowed: boolean; retryAfter: number } {
    const now = Date.now();
    this.requests += 1;
    if (this.requests % 256 === 0 || this.entries.size >= this.maximumEntries) {
      for (const [entryKey, entry] of this.entries) {
        if (entry.resetAt <= now) this.entries.delete(entryKey);
      }
      while (this.entries.size >= this.maximumEntries) {
        const oldest = this.entries.keys().next().value as string | undefined;
        if (!oldest) break;
        this.entries.delete(oldest);
      }
    }
    const current = this.entries.get(key);
    if (!current || current.resetAt <= now) {
      this.entries.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfter: 0 };
    }
    current.count += 1;
    return {
      allowed: current.count <= limit,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
    };
  }
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Invalid allowed origin: ${value}`);
  }
  return url.origin;
}

function normalizePublicUrl(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('publicUrl must be an HTTP(S) URL without embedded credentials');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('publicUrl must be an origin without a path prefix');
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) {
    throw new Error('Plain HTTP publicUrl is allowed only for loopback development');
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function normalizeIp(value: string): string | null {
  const withoutBrackets = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  const normalized = withoutBrackets.startsWith('::ffff:') ? withoutBrackets.slice(7) : withoutBrackets;
  return isIP(normalized) ? normalized : null;
}

function requestIp(request: IncomingMessage, trustedProxies: Set<string>): string {
  const remote = normalizeIp(request.socket.remoteAddress ?? '') ?? 'unknown';
  if (!trustedProxies.has(remote)) return remote;
  const forwarded = request.headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
  if (!value) return remote;
  const chain = value.split(',').map(item => normalizeIp(item.trim())).filter((item): item is string => Boolean(item));
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const candidate = chain[index]!;
    if (!trustedProxies.has(candidate)) return candidate;
  }
  return remote;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error && Array.isArray((error as { issues: unknown[] }).issues)) {
    const issues = (error as { issues: Array<{ path?: Array<string | number>; message?: string }> }).issues;
    return issues.slice(0, 5).map(issue => `${issue.path?.join('.') || 'request'}: ${issue.message ?? 'invalid'}`).join('; ');
  }
  return error instanceof Error ? error.message : 'Invalid request';
}

function assertJsonContentType(request: IncomingMessage): void {
  const contentType = request.headers['content-type'];
  if (!contentType || !contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json');
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  assertJsonContentType(request);
  const declared = request.headers['content-length'];
  if (declared && Number.parseInt(declared, 10) > MAX_JSON_BODY_BYTES) {
    request.resume();
    throw new HttpError(413, 'body_too_large', 'JSON body exceeds 1 MiB', { Connection: 'close' });
  }
  let size = 0;
  let exceeded = false;
  const chunks: Buffer[] = [];
  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    size += chunk.byteLength;
    if (size > MAX_JSON_BODY_BYTES) {
      exceeded = true;
      continue;
    }
    chunks.push(chunk);
  }
  if (exceeded) throw new HttpError(413, 'body_too_large', 'JSON body exceeds 1 MiB');
  if (chunks.length === 0) throw new HttpError(400, 'invalid_json', 'JSON body is required');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON');
  }
}

function parseNonNegativeInteger(value: string | null, fallback: number, field: string): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) throw new HttpError(400, 'invalid_query', `${field} must be a non-negative integer`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) throw new HttpError(400, 'invalid_query', `${field} is too large`);
  return parsed;
}

function decodePathSegment(value: string, label: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, 'invalid_path', `${label} contains invalid URL encoding`);
  }
}

function securityHeaders(isHttps: boolean): Record<string, string> {
  return {
    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    'Cross-Origin-Resource-Policy': 'same-site',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...(isHttps ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
  };
}

function setResponseHeaders(
  response: ServerResponse,
  requestOrigin: string | undefined,
  allowedOrigins: Set<string>,
  isHttps: boolean,
): void {
  for (const [name, value] of Object.entries(securityHeaders(isHttps))) response.setHeader(name, value);
  response.setHeader('Vary', 'Origin');
  if (requestOrigin && allowedOrigins.has(requestOrigin)) {
    response.setHeader('Access-Control-Allow-Origin', requestOrigin);
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Access-Control-Max-Age', '600');
  }
}

function sendJson(response: ServerResponse, status: number, value: unknown, cacheControl = 'no-store'): void {
  const body = JSON.stringify(value);
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.setHeader('Cache-Control', cacheControl);
  response.end(body);
}

function sendError(response: ServerResponse, error: HttpError | RegistryStoreError): void {
  if (error instanceof HttpError && error.headers) {
    for (const [name, value] of Object.entries(error.headers)) response.setHeader(name, value);
  }
  const body: ApiError = { error: { code: error.code, message: error.message } };
  sendJson(response, error.status, body);
}

function assertAdmin(request: IncomingMessage, adminToken: string | undefined): void {
  if (!adminToken) throw new HttpError(404, 'admin_disabled', 'Operator API is disabled');
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ') || !safeEqual(authorization.slice(7), adminToken)) {
    throw new HttpError(401, 'unauthorized', 'A valid operator bearer token is required', {
      'WWW-Authenticate': 'Bearer realm="skillflux-operator"',
    });
  }
}

function vetCampaignUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(422, 'invalid_campaign_url', 'Campaign URL is invalid');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || isIP(hostname) !== 0 || !hostname.includes('.') || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new HttpError(422, 'invalid_campaign_url', 'Campaign URL must use HTTPS on a public hostname without credentials');
  }
  return url.toString();
}

function canonicalCampaignInput(input: CampaignInput): CampaignInput {
  return {
    ...input,
    url: vetCampaignUrl(input.url),
    startsAt: new Date(input.startsAt).toISOString(),
    endsAt: new Date(input.endsAt).toISOString(),
  };
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN');
}

function queryTerms(query: string): string[] {
  const normalized = normalizeSearchText(query).trim();
  if (!normalized) return [];
  const terms = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const expanded = new Set<string>(terms);
  for (const term of terms) {
    if (/^\p{Script=Han}+$/u.test(term) && term.length > 2) {
      for (let index = 0; index < term.length - 1; index += 1) expanded.add(term.slice(index, index + 2));
    }
  }
  return [...expanded];
}

function scoreSkill(summary: SkillSummary, query: string): { score: number; reasons: string[] } {
  const phrase = normalizeSearchText(query).trim();
  if (!phrase) return { score: 0, reasons: [] };
  const terms = queryTerms(query);
  const fields: Array<{ label: string; value: string; weight: number }> = [
    { label: '\u540d\u79f0', value: summary.name, weight: 10 },
    { label: 'ID', value: summary.id, weight: 9 },
    { label: '\u6807\u7b7e', value: summary.tags.join(' '), weight: 7 },
    { label: '\u5206\u7c7b', value: summary.category, weight: 6 },
    { label: '\u63cf\u8ff0', value: summary.description, weight: 4 },
    { label: '\u53d1\u5e03\u8005', value: summary.publisher, weight: 1 },
  ];
  let score = 0;
  const reasons: string[] = [];
  for (const field of fields) {
    const normalized = normalizeSearchText(field.value);
    let fieldScore = 0;
    if (normalized === phrase) fieldScore += field.weight * 5;
    else if (normalized.includes(phrase)) fieldScore += field.weight * 3;
    for (const term of terms) {
      if (normalized.includes(term)) fieldScore += field.weight;
    }
    if (fieldScore > 0) {
      score += fieldScore;
      reasons.push(`${field.label}\u5339\u914d`);
    }
  }
  return { score, reasons };
}

function searchSkills(records: SkillRecord[], input: {
  q: string;
  category?: string;
  host?: 'generic' | 'codex' | 'claude' | 'cursor';
  sort: 'relevance' | 'newest' | 'name';
  limit: number;
  offset: number;
}): SearchResponse {
  const hostFiltered = input.host ? records.filter(record => record.summary.hosts.includes(input.host!) || record.summary.hosts.includes('generic')) : records;
  const categories = [...new Set(hostFiltered.map(record => record.summary.category))].sort((a, b) => a.localeCompare(b, 'en'));
  const categoryFiltered = input.category ? hostFiltered.filter(record => record.summary.category === input.category) : hostFiltered;
  const scored = categoryFiltered
    .map(record => ({ summary: record.summary, ...scoreSkill(record.summary, input.q) }))
    .filter(result => !input.q.trim() || result.score > 0);

  scored.sort((left, right) => {
    if (input.sort === 'name') {
      return left.summary.name.localeCompare(right.summary.name, 'zh-CN')
        || left.summary.id.localeCompare(right.summary.id, 'en');
    }
    if (input.sort === 'newest' || !input.q.trim()) {
      return right.summary.createdAt.localeCompare(left.summary.createdAt)
        || compareVersions(right.summary.version, left.summary.version)
        || left.summary.id.localeCompare(right.summary.id, 'en');
    }
    return right.score - left.score
      || right.summary.createdAt.localeCompare(left.summary.createdAt)
      || left.summary.id.localeCompare(right.summary.id, 'en');
  });

  const total = scored.length;
  const items = scored.slice(input.offset, input.offset + input.limit).map(result => ({
    ...result.summary,
    ...(input.q.trim() ? { score: result.score, reasons: result.reasons } : {}),
  }));
  return { items, total, categories, offset: input.offset, limit: input.limit };
}

function selectCampaign(candidates: CampaignCandidate[]): CampaignCandidate | null {
  return candidates[0] ?? null;
}

function isSensitiveCategory(category: string): boolean {
  return category.split('-').some(part => SENSITIVE_CATEGORIES.has(part)) || SENSITIVE_CATEGORIES.has(category);
}

async function seedDevelopmentCatalog(store: RegistryStore, seedPath: string): Promise<void> {
  const value = JSON.parse(await readFile(seedPath, 'utf8')) as unknown;
  if (!Array.isArray(value)) throw new Error('Development seed must be a JSON array');
  for (const candidate of value) {
    const parsed = submissionSchema.safeParse(candidate);
    if (!parsed.success) throw new Error(`Invalid development seed: ${errorMessage(parsed.error)}`);
    const submission = parsed.data as Submission;
    if (store.hasSkill(submission.id, submission.version)) continue;
    const scan = scanSubmission(submission);
    if (!scan.quality.automated.passed) {
      throw new Error(`Development seed ${submission.id}@${submission.version} failed checks: ${scan.failures.join('; ')}`);
    }
    store.submitSkill(submission, scan);
    // Development material is quarantined; fixtures are never recorded as human QA.
  }
}

function parseSearch(url: URL): ReturnType<typeof searchQuerySchema.parse> {
  const allowed = new Set(['q', 'category', 'host', 'sort', 'limit', 'offset']);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw new HttpError(400, 'invalid_query', `Unknown search parameter: ${key}`);
  }
  const raw = {
    q: url.searchParams.get('q') ?? '',
    ...(url.searchParams.has('category') ? { category: url.searchParams.get('category') } : {}),
    ...(url.searchParams.has('host') ? { host: url.searchParams.get('host') } : {}),
    sort: url.searchParams.get('sort') ?? 'relevance',
    limit: parseNonNegativeInteger(url.searchParams.get('limit'), 12, 'limit'),
    offset: parseNonNegativeInteger(url.searchParams.get('offset'), 0, 'offset'),
  };
  const result = searchQuerySchema.safeParse(raw);
  if (!result.success) throw new HttpError(400, 'invalid_query', errorMessage(result.error));
  return result.data;
}

function campaignInputFromExisting(existing: ReturnType<RegistryStore['getCampaign']>, patch: Partial<CampaignInput>): CampaignInput {
  if (!existing) throw new HttpError(404, 'campaign_not_found', 'Campaign was not found');
  return {
    name: patch.name ?? existing.name,
    sponsor: patch.sponsor ?? existing.sponsor,
    text: patch.text ?? existing.text,
    url: patch.url ?? existing.url,
    categories: patch.categories ?? existing.categories,
    active: patch.active ?? existing.active,
    budgetCents: patch.budgetCents ?? existing.budgetCents,
    cpcCents: patch.cpcCents ?? existing.cpcCents,
    dailyCap: patch.dailyCap ?? existing.dailyCap,
    startsAt: patch.startsAt ?? existing.startsAt,
    endsAt: patch.endsAt ?? existing.endsAt,
  };
}

function page<T>(items: T[], url: URL, defaultLimit = 50, maximumLimit = 100): { items: T[]; total: number; offset: number; limit: number } {
  const offset = parseNonNegativeInteger(url.searchParams.get('offset'), 0, 'offset');
  const limit = parseNonNegativeInteger(url.searchParams.get('limit'), defaultLimit, 'limit');
  if (limit < 1 || limit > maximumLimit || offset > 100_000) throw new HttpError(400, 'invalid_query', 'Pagination is outside supported limits');
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  if (q.length > 200) throw new HttpError(400, 'invalid_query', 'Search is too long');
  const status = url.searchParams.get('status');
  const filtered = items.filter(item => (!q || JSON.stringify(item).toLowerCase().includes(q)) && (!status || (item as { status?: string }).status === status));
  return { items: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit };
}

function metricsParameters(url: URL): { from: string; to: string; campaignId?: string; groupBy: 'day' | 'campaign' } {
  const today = new Date().toISOString().slice(0, 10);
  const from = url.searchParams.get('from') ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const to = url.searchParams.get('to') ?? today;
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  if (!valid(from) || !valid(to) || from > to || Date.parse(to) - Date.parse(from) > 366 * 86_400_000) throw new HttpError(400, 'invalid_query', 'Choose a valid UTC date range of at most 367 days');
  const groupBy = url.searchParams.get('groupBy') ?? 'day';
  if (groupBy !== 'day' && groupBy !== 'campaign') throw new HttpError(400, 'invalid_query', 'groupBy must be day or campaign');
  const campaignId = url.searchParams.get('campaignId') ?? undefined;
  return { from, to, ...(campaignId ? { campaignId } : {}), groupBy };
}

function csvCell(value: unknown): string { const text = String(value ?? ''); const safe = /^[\s]*[=+@\-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text; return `"${safe.replace(/"/g, '""')}"`; }

export async function createRegistryServer(options: RegistryServerOptions): Promise<http.Server> {
  if (!options.dataDir) throw new Error('createRegistryServer requires dataDir');
  const configuredPublicUrl = options.publicUrl ? normalizePublicUrl(options.publicUrl) : undefined;
  const allowedOrigins = new Set((options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS).map(normalizeOrigin));
  const trustedProxies = new Set((options.trustedProxies ?? []).map(value => {
    const normalized = normalizeIp(value);
    if (!normalized) throw new Error(`Invalid trusted proxy address: ${value}`);
    return normalized;
  }));
  const store = await RegistryStore.open(options.dataDir);
  let keys;
  try {
    keys = await loadOrCreateRegistryKeys(options.dataDir);
    if (options.dev && options.seedPath) await seedDevelopmentCatalog(store, options.seedPath);
  } catch (error) {
    store.close();
    throw error;
  }

  const limiter = new FixedWindowRateLimiter();
  const retentionTimer = setInterval(() => { try { store.purgeInquiryPII(); store.expireAdReservations(); } catch { /* Next run retries; read paths also reconcile expiration. */ } }, 60_000);
  retentionTimer.unref();
  let server: http.Server;

  const baseUrl = (): string => {
    if (configuredPublicUrl) return configuredPublicUrl;
    const address = server.address();
    if (address && typeof address === 'object') return `http://127.0.0.1:${address.port}`;
    return 'http://127.0.0.1';
  };

  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
    setResponseHeaders(response, origin, allowedOrigins, Boolean(configuredPublicUrl?.startsWith('https:')));
    try {
      if (origin && !allowedOrigins.has(origin)) throw new HttpError(403, 'origin_not_allowed', 'Browser origin is not allowed');
      if (request.method === 'OPTIONS') {
        response.statusCode = 204;
        response.setHeader('Cache-Control', 'no-store');
        response.end();
        return;
      }

      const url = new URL(request.url ?? '/', 'http://registry.local');
      const pathname = url.pathname;
      const remote = requestIp(request, trustedProxies);
      const bucket = pathname.startsWith('/v1/admin/') ? 'admin'
        : pathname === '/v1/ads/decision' ? 'ads'
          : pathname === '/v1/events' ? 'events'
            : 'public';
      const limit = bucket === 'public' ? 300 : bucket === 'events' ? 240 : 120;
      if (pathname !== '/health') {
        const rate = limiter.consume(`${remote}:${bucket}`, limit);
        if (!rate.allowed) throw new HttpError(429, 'rate_limited', 'Too many requests', { 'Retry-After': String(rate.retryAfter) });
      }

      if (request.method === 'GET' && pathname === '/health') {
        sendJson(response, 200, { status: 'ok', version: PROTOCOL_VERSION }, 'no-store');
        return;
      }

      if (request.method === 'GET' && pathname === '/v1/keys') {
        sendJson(response, 200, { keyId: keys.keyId, publicKey: keys.publicKey }, 'public, max-age=300');
        return;
      }

      if (request.method === 'GET' && pathname === '/v1/catalog') {
        const generatedAt = new Date();
        const payload: Catalog = {
          skills: store.listApproved().map(record => record.summary),
          generatedAt: generatedAt.toISOString(),
          expiresAt: new Date(generatedAt.getTime() + 15 * 60_000).toISOString(),
        };
        sendJson(response, 200, signPayload(payload, keys.privateKey, keys.keyId), 'public, max-age=60');
        return;
      }

      if (request.method === 'GET' && (pathname === '/v1/publication' || pathname === '/v1/publication/statuses')) {
        const records = store.listApproved();
        const statuses = store.versionSummaries();
        const revision = sha256(canonical({ skills: records.map(record => record.summary), statuses }));
        const generatedAt = new Date();
        const common = { revision, generatedAt: generatedAt.toISOString(), expiresAt: new Date(generatedAt.getTime() + 15 * 60_000).toISOString() };
        const payload = pathname.endsWith('/statuses') ? { ...page(statuses, url), ...common } : { ...page(records.map(record => ({ skill: record.summary, bundle: record.bundle })), url, 10, 10), ...common };
        sendJson(response, 200, signPayload(payload, keys.privateKey, keys.keyId));
        return;
      }

      if (request.method === 'GET' && pathname === '/v1/revocations') {
        const generatedAt = new Date();
        const payload: Revocations = {
          items: store.listRevocations(),
          generatedAt: generatedAt.toISOString(),
          expiresAt: new Date(generatedAt.getTime() + 5 * 60_000).toISOString(),
        };
        sendJson(response, 200, signPayload(payload, keys.privateKey, keys.keyId), 'public, max-age=30');
        return;
      }

      const qualificationMatch = pathname.match(/^\/v1\/qualifications\/([a-f0-9]{64})$/);
      if (request.method === 'GET' && qualificationMatch) {
        const proof = store.qualificationProof(qualificationMatch[1]!);
        if (!proof) throw new HttpError(404, 'qualification_not_found', 'Public qualification was not found');
        sendJson(response, 200, signPayload(proof, keys.privateKey, keys.keyId));
        return;
      }

      if (request.method === 'GET' && pathname === '/v1/search') {
        const query = parseSearch(url);
        const payload = searchSkills(store.listLatestApproved(), query);
        sendJson(response, 200, payload);
        return;
      }

      const versionsMatch = pathname.match(/^\/v1\/skills\/([^/]+)\/versions$/);
      if (request.method === 'GET' && versionsMatch) {
        const items = store.versionSummaries(decodePathSegment(versionsMatch[1]!, 'skill id'));
        if (!items.length) throw new HttpError(404, 'skill_not_found', 'Public skill was not found');
        sendJson(response, 200, page(items, url));
        return;
      }

      const resourceMatch = pathname.match(/^\/v1\/skills\/([^/]+)\/resources$/);
      if (request.method === 'GET' && resourceMatch) {
        const result = store.getPublicSkill(decodePathSegment(resourceMatch[1]!, 'skill id'), url.searchParams.get('version') ?? undefined);
        if (result.revoked) throw new HttpError(410, 'skill_revoked', 'Skill version has been revoked');
        if (!result.record) throw new HttpError(404, 'skill_not_found', 'Qualified skill was not found');
        const path = url.searchParams.get('path');
        const file = result.record.bundle.manifest.files.find(item => item.path === path);
        if (!file) throw new HttpError(404, 'resource_not_found', 'Resource was not found');
        sendJson(response, 200, { id: result.record.summary.id, version: result.record.summary.version, digest: result.record.summary.digest, ...file, content: result.record.bundle.files[file.path] });
        return;
      }

      const skillMatch = pathname.match(/^\/v1\/skills\/([^/]+)$/);
      if (request.method === 'GET' && skillMatch) {
        const id = decodePathSegment(skillMatch[1]!, 'skill id');
        const version = url.searchParams.get('version') ?? undefined;
        for (const key of url.searchParams.keys()) {
          if (key !== 'version') throw new HttpError(400, 'invalid_query', `Unknown skill parameter: ${key}`);
        }
        const result = store.getPublicSkill(id, version);
        if (result.revoked) throw new HttpError(410, 'skill_revoked', 'Skill version has been revoked');
        if (!result.record) throw new HttpError(404, 'skill_not_found', 'Approved skill version was not found');
        const detail: SkillDetail = {
          skill: result.record.summary,
          manifest: result.record.bundle.manifest,
          content: result.record.bundle.files[result.record.bundle.manifest.entry]!,
          resources: Object.keys(result.record.bundle.files).filter(path => path !== result.record!.bundle.manifest.entry).sort(),
        };
        sendJson(response, 200, detail);
        return;
      }

      const bundleMatch = pathname.match(/^\/v1\/bundles\/([a-f0-9]{64})$/);
      if (request.method === 'GET' && bundleMatch) {
        const record = store.getApprovedByDigest(bundleMatch[1]!);
        if (!record) throw new HttpError(404, 'bundle_not_found', 'Approved bundle was not found');
        sendJson(response, 200, signPayload(record.bundle, keys.privateKey, keys.keyId));
        return;
      }

      if (request.method === 'POST' && pathname === '/v1/ads/decision') {
        const body = await readJson(request);
        const parsed = adRequestSchema.safeParse(body);
        if (!parsed.success) throw new HttpError(422, 'invalid_ad_request', errorMessage(parsed.error));
        const adRequest = parsed.data as AdRequest;
        if (adRequest.context !== 'normal' || isSensitiveCategory(adRequest.category)) {
          throw new HttpError(422, 'ad_suppressed', 'Advertising requires an explicitly normal, non-sensitive context');
        }
        if (adRequest.placement === 'web-preview') throw new HttpError(422, 'preview_not_billable', 'Use the authenticated creative preview endpoint');
        const requestHash = sha256(canonical(adRequest));
        const existing = store.getDecisionByRequestId(adRequest.requestId);
        if (existing) {
          if (existing.requestHash !== requestHash) throw new HttpError(409, 'request_id_reused', 'requestId was already used for different ad inputs');
          if (existing.invalidatedAt) throw new HttpError(410, 'decision_invalidated', 'Ad decision has been permanently invalidated');
          if (existing.decision.expiresAt <= new Date().toISOString()) throw new HttpError(410, 'decision_expired', 'Ad decision has expired');
          sendJson(response, 200, existing.signed);
          return;
        }

        const excluded = new Set(adRequest.excludedCampaigns ?? []);
        const campaign = selectCampaign(store.listEligibleCampaigns(adRequest.category, excluded));
        const createdAt = new Date();
        const expiresAt = new Date(createdAt.getTime() + 10 * 60_000).toISOString();
        const decisionId = randomUUID();
        const token = issueDecisionToken(decisionId, expiresAt, keys.privateKey);
        const clickUrl = `${baseUrl()}/r/${encodeURIComponent(token)}`;
        const decision: AdDecision = campaign ? {
          decisionId,
          campaignId: campaign.id,
          creativeId: `campaign:${campaign.id}`,
          disclosure: '\u5e7f\u544a',
          text: campaign.text,
          url: clickUrl,
          expiresAt,
          token,
          house: false,
        } : {
          decisionId,
          campaignId: null,
          creativeId: 'skillflux-house-v1',
          disclosure: '\u5e7f\u544a',
          text: 'SkillFlux\uff1a\u6309\u9700\u53d1\u73b0\u5e76\u52a0\u8f7d\u7ecf\u5ba1\u6838\u7684 Skill\u3002',
          url: clickUrl,
          expiresAt,
          token,
          house: true,
        };
        const signed = signPayload(decision, keys.privateKey, keys.keyId);
        const stored = store.storeDecision({
          decision,
          signed,
          requestId: adRequest.requestId,
          requestHash,
          targetUrl: campaign?.url ?? baseUrl(),
          campaign,
          createdAt: createdAt.toISOString(),
        });
        sendJson(response, 200, stored.signed);
        return;
      }

      if (request.method === 'POST' && pathname === '/v1/events') {
        const body = await readJson(request);
        const parsed = eventSchema.safeParse(body);
        if (!parsed.success) throw new HttpError(422, 'invalid_event', errorMessage(parsed.error));
        let tokenPayload;
        try {
          tokenPayload = verifyDecisionToken(parsed.data.token, keys.publicKey);
        } catch {
          throw new HttpError(401, 'invalid_decision_token', 'Decision token is invalid');
        }
        if (!tokenPayload.uses.includes(parsed.data.type)) throw new HttpError(403, 'event_not_allowed', 'Decision token does not allow this event type');
        if (tokenPayload.expiresAt <= new Date().toISOString()) throw new HttpError(410, 'decision_expired', 'Ad decision has expired');
        const tokenHash = sha256(parsed.data.token);
        const stored = store.getDecisionByTokenHash(tokenHash);
        if (!stored || stored.decision.decisionId !== tokenPayload.decisionId) throw new HttpError(404, 'decision_not_found', 'Ad decision was not found');
        const result = store.recordEvent({
          eventId: parsed.data.eventId,
          tokenHash,
          decisionId: tokenPayload.decisionId,
          type: parsed.data.type,
          ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
        });
        sendJson(response, 200, { accepted: true, duplicate: result.duplicate });
        return;
      }

      const redirectMatch = pathname.match(/^\/r\/([^/]+)$/);
      if (request.method === 'GET' && redirectMatch) {
        const token = decodePathSegment(redirectMatch[1]!, 'decision token');
        let tokenPayload;
        try {
          tokenPayload = verifyDecisionToken(token, keys.publicKey);
        } catch {
          throw new HttpError(401, 'invalid_decision_token', 'Decision token is invalid');
        }
        if (!tokenPayload.uses.includes('click')) throw new HttpError(403, 'click_not_allowed', 'Decision token does not allow clicks');
        if (tokenPayload.expiresAt <= new Date().toISOString()) throw new HttpError(410, 'decision_expired', 'Ad decision has expired');
        const clicked = store.consumeClick(sha256(token));
        response.statusCode = 302;
        response.setHeader('Location', clicked.url);
        response.setHeader('Cache-Control', 'no-store');
        response.end();
        return;
      }

      if (pathname.startsWith('/v1/admin/')) assertAdmin(request, options.adminToken);

      if (request.method === 'POST' && (pathname === '/v1/inquiries' || pathname === '/v1/reports')) {
        const rate = limiter.consume(`${requestIp(request, trustedProxies)}:${pathname}:form`, 10, 60 * 60_000);
        if (!rate.allowed) throw new HttpError(429, 'rate_limited', 'Too many submissions', { 'Retry-After': String(rate.retryAfter) });
        const body = await readJson(request);
        if (pathname === '/v1/inquiries') {
          const parsed = inquirySchema.safeParse(body);
          if (!parsed.success) throw new HttpError(422, 'invalid_inquiry', errorMessage(parsed.error));
          sendJson(response, 201, { ...store.submitInquiry(parsed.data), accepted: true });
        } else {
          const parsed = reportSchema.safeParse(body);
          if (!parsed.success) throw new HttpError(422, 'invalid_report', errorMessage(parsed.error));
          sendJson(response, 201, { ...store.submitReport(parsed.data), accepted: true });
        }
        return;
      }

      if (request.method === 'GET' && pathname === '/v1/admin/skills') {
        sendJson(response, 200, page(store.listSkills().map(record => ({ ...record.summary, qualification: record.summary.status === 'revoked' ? 'revoked' : store.isQualified(record) ? 'qualified' : 'needs-testing' })), url));
        return;
      }

      if (request.method === 'POST' && pathname === '/v1/admin/skills') {
        const body = await readJson(request);
        const parsed = submissionSchema.safeParse(body);
        if (!parsed.success) throw new HttpError(422, 'invalid_submission', errorMessage(parsed.error));
        const submission = parsed.data as Submission;
        if (!submission.release) throw new HttpError(422, 'release_metadata_required', 'Release notes, breaking flag, minimum client version and maintenance attribution are required');
        if (submission.permissions.shell || submission.permissions.network.length > 0 || submission.permissions.secrets.length > 0) {
          throw new HttpError(422, 'unsupported_permissions', 'This text-only registry rejects network, shell and secret capabilities');
        }
        const scan = scanSubmission(submission);
        const record = store.submitSkill(submission, scan);
        sendJson(response, 201, { skill: record.summary });
        return;
      }

      const reviewMatch = pathname.match(/^\/v1\/admin\/skills\/([^/]+)\/([^/]+)\/review$/);
      if (request.method === 'POST' && reviewMatch) {
        const id = decodePathSegment(reviewMatch[1]!, 'skill id');
        const version = decodePathSegment(reviewMatch[2]!, 'skill version');
        const body = await readJson(request);
        const parsed = reviewSchema.safeParse(body);
        if (!parsed.success) throw new HttpError(422, 'invalid_review', errorMessage(parsed.error));
        if (parsed.data.action === 'revoke' && !parsed.data.notes.trim()) {
          throw new HttpError(422, 'revocation_reason_required', 'Revocation requires a reason');
        }
        const record = store.reviewSkill(id, version, parsed.data.action, parsed.data.reviewer, parsed.data.notes);
        sendJson(response, 200, { skill: record.summary });
        return;
      }

      const evaluationMatch = pathname.match(/^\/v1\/admin\/skills\/([^/]+)\/([^/]+)\/evaluations$/);
      if (request.method === 'POST' && evaluationMatch) {
        const parsed = evaluationSchema.safeParse(await readJson(request));
        if (!parsed.success) throw new HttpError(422, 'invalid_evaluation', errorMessage(parsed.error));
        const evaluation = store.addEvaluation(decodePathSegment(evaluationMatch[1]!, 'skill id'), decodePathSegment(evaluationMatch[2]!, 'version'), parsed.data);
        sendJson(response, 201, { evaluation });
        return;
      }

      const adminSkillMatch = pathname.match(/^\/v1\/admin\/skills\/([^/]+)\/([^/]+)$/);
      if (request.method === 'GET' && adminSkillMatch) {
        sendJson(response, 200, store.adminSkillDetail(decodePathSegment(adminSkillMatch[1]!, 'skill id'), decodePathSegment(adminSkillMatch[2]!, 'version')));
        return;
      }

      if (request.method === 'GET' && pathname === '/v1/admin/campaigns') {
        const active = url.searchParams.get('status');
        const campaigns = store.listCampaigns().filter(campaign => !active || (active === 'active' ? campaign.active : active === 'paused' ? !campaign.active : true));
        const pagedUrl = new URL(url); pagedUrl.searchParams.delete('status');
        sendJson(response, 200, page(campaigns, pagedUrl));
        return;
      }

      if (request.method === 'POST' && pathname === '/v1/admin/campaigns') {
        const body = await readJson(request);
        const parsed = campaignInputSchema.safeParse(body);
        if (!parsed.success) throw new HttpError(422, 'invalid_campaign', errorMessage(parsed.error));
        const campaign = store.createCampaign(canonicalCampaignInput(parsed.data));
        sendJson(response, 201, { campaign });
        return;
      }

      const campaignMatch = pathname.match(/^\/v1\/admin\/campaigns\/([^/]+)$/);
      if (request.method === 'PATCH' && campaignMatch) {
        const id = decodePathSegment(campaignMatch[1]!, 'campaign id');
        const body = await readJson(request);
        const patch = campaignPatchSchema.safeParse(body);
        if (!patch.success) throw new HttpError(422, 'invalid_campaign_patch', errorMessage(patch.error));
        const merged = campaignInputFromExisting(store.getCampaign(id), patch.data);
        const validated = campaignInputSchema.safeParse(merged);
        if (!validated.success) throw new HttpError(422, 'invalid_campaign', errorMessage(validated.error));
        const campaign = store.updateCampaign(id, canonicalCampaignInput(validated.data));
        sendJson(response, 200, { campaign });
        return;
      }

      const previewMatch = pathname.match(/^\/v1\/admin\/campaigns\/([^/]+)\/preview$/);
      if (request.method === 'GET' && previewMatch) {
        const campaign = store.getCampaign(decodePathSegment(previewMatch[1]!, 'campaign id'));
        if (!campaign) throw new HttpError(404, 'campaign_not_found', 'Campaign was not found');
        sendJson(response, 200, { campaignId: campaign.id, disclosure: '广告', sponsor: campaign.sponsor, text: campaign.text, url: campaign.url, preview: true });
        return;
      }

      if (request.method === 'GET' && pathname === '/v1/admin/inquiries') { sendJson(response, 200, page(store.listInquiries(), url)); return; }
      const inquiryMatch = pathname.match(/^\/v1\/admin\/inquiries\/([^/]+)$/);
      if (request.method === 'PATCH' && inquiryMatch) {
        const parsed = inquiryPatchSchema.safeParse(await readJson(request));
        if (!parsed.success) throw new HttpError(422, 'invalid_inquiry_update', errorMessage(parsed.error));
        sendJson(response, 200, { inquiry: store.updateInquiry(decodePathSegment(inquiryMatch[1]!, 'inquiry id'), parsed.data) }); return;
      }
      if (request.method === 'GET' && pathname === '/v1/admin/reports') { sendJson(response, 200, page(store.listReports(), url)); return; }
      const reportMatch = pathname.match(/^\/v1\/admin\/reports\/([^/]+)$/);
      if (reportMatch && request.method === 'GET') {
        const report = store.getReport(decodePathSegment(reportMatch[1]!, 'report id'));
        if (!report) throw new HttpError(404, 'report_not_found', 'Report was not found');
        sendJson(response, 200, { report }); return;
      }
      if (reportMatch && request.method === 'PATCH') {
        const parsed = reportPatchSchema.safeParse(await readJson(request));
        if (!parsed.success) throw new HttpError(422, 'invalid_report_update', errorMessage(parsed.error));
        sendJson(response, 200, { report: store.resolveReport(decodePathSegment(reportMatch[1]!, 'report id'), parsed.data) }); return;
      }

      if (request.method === 'GET' && (pathname === '/v1/admin/metrics' || pathname === '/v1/admin/metrics.csv')) {
        const parameters = metricsParameters(url);
        const metrics = store.metricsByPeriod(parameters.from, parameters.to, parameters.campaignId, parameters.groupBy);
        if (pathname.endsWith('.csv')) {
          const columns = ['date', 'campaignId', 'name', 'decisions', 'impressions', 'clicks', 'spentCents', 'reports', 'clickedImpressions', 'ctr'] as const;
          const body = [columns.join(','), ...metrics.rows.map(row => columns.map(column => csvCell(row[column])).join(','))].join('\r\n') + '\r\n';
          response.statusCode = 200; response.setHeader('Content-Type', 'text/csv; charset=utf-8'); response.setHeader('Content-Disposition', 'attachment; filename="skillflux-metrics.csv"'); response.setHeader('Cache-Control', 'no-store'); response.end(body);
        } else sendJson(response, 200, metrics);
        return;
      }

      if (request.method === 'GET' && pathname === '/v1/admin/audit') {
        const action = url.searchParams.get('action');
        let items = store.auditItems().filter(item => !action || item.action === action);
        if (url.searchParams.has('from') || url.searchParams.has('to')) {
          const range = metricsParameters(url);
          items = items.filter(item => item.createdAt.slice(0, 10) >= range.from && item.createdAt.slice(0, 10) <= range.to);
        }
        sendJson(response, 200, page(items, url));
        return;
      }

      throw new HttpError(404, 'not_found', 'Route was not found');
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      if (error instanceof HttpError || error instanceof RegistryStoreError) {
        sendError(response, error);
        return;
      }
      sendError(response, new HttpError(500, 'internal_error', 'Internal server error'));
    }
  };

  server = http.createServer((request, response) => {
    void handler(request, response);
  });
  server.keepAliveTimeout = 5_000;
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.maxHeadersCount = 100;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  server.once('close', () => { clearInterval(retentionTimer); store.close(); });
  return server;
}
