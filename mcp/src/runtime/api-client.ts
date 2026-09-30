import type {
  AdRequest,
  ApiError,
  Bundle,
  PublicKeyInfo,
  Revocations,
  SearchResponse,
  Signed,
  SkillDetail,
  SkillVersionSummary,
  QualificationProof,
} from '../shared.js';
import { SkillFluxError } from './errors.js';
import type { SearchOptions } from './model.js';

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export function normalizeRegistryUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new SkillFluxError('INVALID_REGISTRY_URL', `Invalid registry URL: ${input}`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new SkillFluxError('INVALID_REGISTRY_URL', 'Registry URL cannot contain credentials, query parameters or fragments');
  }
  if (parsed.pathname !== '' && parsed.pathname !== '/') throw new SkillFluxError('INVALID_REGISTRY_URL', 'Registry URL must be an origin without a path prefix');
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && LOOPBACK_NAMES.has(parsed.hostname))) {
    throw new SkillFluxError('INSECURE_REGISTRY_URL', 'Registry must use HTTPS; HTTP is allowed only for a loopback address');
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/$/, '');
}

export class RegistryClient {
  readonly baseUrl: string;
  readonly origin: string;
  readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 15_000) {
    this.baseUrl = normalizeRegistryUrl(baseUrl);
    this.origin = new URL(this.baseUrl).origin;
    this.timeoutMs = timeoutMs;
  }

  async getKey(): Promise<PublicKeyInfo> {
    return this.request<PublicKeyInfo>('GET', '/v1/keys');
  }

  async search(options: SearchOptions = {}): Promise<SearchResponse> {
    const params = new URLSearchParams();
    if (options.query) params.set('q', options.query);
    if (options.category) params.set('category', options.category);
    if (options.host) params.set('host', options.host);
    params.set('sort', options.sort ?? 'relevance');
    params.set('limit', String(options.limit ?? 12));
    params.set('offset', String(options.offset ?? 0));
    return this.request<SearchResponse>('GET', `/v1/search?${params.toString()}`);
  }

  async getSkill(id: string, version?: string): Promise<SkillDetail> {
    const suffix = version ? `?version=${encodeURIComponent(version)}` : '';
    return this.request<SkillDetail>('GET', `/v1/skills/${encodeURIComponent(id)}${suffix}`);
  }

  async getBundle(digest: string): Promise<Signed<Bundle>> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new SkillFluxError('INVALID_DIGEST', `Invalid bundle digest: ${digest}`);
    return this.request<Signed<Bundle>>('GET', `/v1/bundles/${digest}`);
  }

  async getVersions(id: string): Promise<SkillVersionSummary[]> {
    const items: SkillVersionSummary[] = [];
    for (let offset = 0; offset < 10_000; offset += 100) {
      const page = await this.request<{ items: SkillVersionSummary[]; total: number }>('GET', `/v1/skills/${encodeURIComponent(id)}/versions?offset=${offset}&limit=100`);
      if (!Array.isArray(page.items) || !Number.isSafeInteger(page.total) || page.total < 0 || page.items.some(item => item.id !== id)) {
        throw new SkillFluxError('INVALID_REGISTRY_RESPONSE', 'Registry version list is invalid');
      }
      items.push(...page.items);
      if (items.length >= page.total) return items;
      if (!page.items.length) break;
    }
    throw new SkillFluxError('INCOMPLETE_VERSION_LIST', 'Registry version list is incomplete; latest version is unknown');
  }

  async getRevocations(): Promise<Signed<Revocations>> {
    return this.request<Signed<Revocations>>('GET', '/v1/revocations');
  }

  async getQualification(digest: string): Promise<Signed<QualificationProof>> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new SkillFluxError('INVALID_DIGEST', `Invalid qualification digest: ${digest}`);
    return this.request('GET', `/v1/qualifications/${digest}`);
  }

  async decideAd(body: AdRequest): Promise<Signed<import('../shared.js').AdDecision>> {
    return this.request('POST', '/v1/ads/decision', body);
  }

  async emitEvent(body: { token: string; type: 'impression' | 'hide' | 'report'; eventId: string; reason?: string }): Promise<{ accepted: true; duplicate: boolean }> {
    return this.request('POST', '/v1/events', body);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const target = new URL(path, `${this.baseUrl}/`);
    if (target.origin !== this.origin) throw new SkillFluxError('CROSS_ORIGIN_REJECTED', 'Registry request escaped the configured origin');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(target, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status >= 300 && response.status < 400) {
        throw new SkillFluxError('REDIRECT_REJECTED', `Registry redirects are not accepted: ${target.pathname}`);
      }
      const contentType = response.headers.get('content-type') ?? '';
      const declaredLength = Number(response.headers.get('content-length') ?? '0');
      if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new SkillFluxError('REGISTRY_RESPONSE_TOO_LARGE', `Registry response exceeds ${MAX_RESPONSE_BYTES} bytes`);
      const bytes = await readLimitedBody(response, MAX_RESPONSE_BYTES);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      let payload: unknown;
      try {
        payload = contentType.includes('application/json') ? JSON.parse(text) : text;
      } catch {
        throw new SkillFluxError('INVALID_REGISTRY_RESPONSE', `Registry returned an unreadable response for ${target.pathname}`);
      }
      if (!response.ok) {
        const apiError = payload as Partial<ApiError>;
        const message = apiError?.error?.message ?? `Registry returned HTTP ${response.status}`;
        const code = apiError?.error?.code ?? `HTTP_${response.status}`;
        throw new SkillFluxError(code, message, { status: response.status });
      }
      if (!contentType.includes('application/json')) throw new SkillFluxError('INVALID_REGISTRY_RESPONSE', 'Registry response must be JSON');
      return payload as T;
    } catch (error) {
      if (error instanceof SkillFluxError) throw error;
      if ((error as Error).name === 'AbortError') throw new SkillFluxError('REGISTRY_TIMEOUT', `Registry request timed out: ${target.pathname}`);
      throw new SkillFluxError('REGISTRY_UNAVAILABLE', `Registry request failed: ${(error as Error).message}`);
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
        throw new SkillFluxError('REGISTRY_RESPONSE_TOO_LARGE', `Registry response exceeds ${limit} bytes`);
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
