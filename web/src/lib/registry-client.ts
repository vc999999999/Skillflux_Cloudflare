import type { CampaignInput, PageResponse } from "./registry-types";
export const DEVELOPMENT_REGISTRY_URL = "http://127.0.0.1:8787";
export const CAMPAIGN_TEXT_LIMIT = 280;
export type ClientLocale = "zh" | "en";
const lang = (): ClientLocale => typeof document !== "undefined" && document.documentElement.lang.startsWith("en") ? "en" : "zh";
const message = (zh: string, en: string, locale = lang()) => locale === "en" ? en : zh;

export function normalizeRegistryUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/") && !trimmed.startsWith("//") && !/[\\?#\s]/.test(trimmed)) return trimmed === "/" ? "/" : trimmed.replace(/\/+$/, "");
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new Error(message("Registry 地址必须是 HTTPS 地址或站内路径。", "Registry must use HTTPS or a same-origin path.")); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash || /[\\\s]/.test(trimmed)) throw new Error(message("Registry 仅允许 HTTPS；HTTP 仅用于本机开发，不可含账号、查询或片段。", "Use HTTPS; HTTP is allowed only on loopback. Credentials, queries and fragments are not allowed."));
  return url.toString().replace(/\/+$/, "");
}
export function buildApiUrl(base: string, path: string): string {
  const normalizedBase = normalizeRegistryUrl(base);
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /[\x00-\x1f]/.test(path) || path.split("?")[0]!.split("/").some(segment => segment === ".." || segment === ".")) throw new Error(message("API 路径无效。", "Invalid API path."));
  return normalizedBase === "/" ? path : `${normalizedBase}${path}`;
}
export function buildSearchPath(filters: { q?: string; category?: string; host?: string; sort?: string; limit?: number; offset?: number }): string {
  const params = new URLSearchParams({ q: filters.q ?? "", sort: filters.sort ?? "relevance", limit: String(filters.limit ?? 12), offset: String(filters.offset ?? 0) });
  if (filters.category) params.set("category", filters.category);
  if (filters.host) params.set("host", filters.host);
  return `/v1/search?${params}`;
}
export function formatInstallCommand(id: string, version: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) throw new Error(message("Skill ID 或版本格式无效。", "Invalid skill ID or version."));
  return `skillflux install ${id}@${version}`;
}
export class RegistryError extends Error {
  constructor(message: string, public status = 0, public code = "CLIENT_ERROR") { super(message); this.name = "RegistryError"; }
}
function apiErrorMessage(status: number, code: string, detail: string, locale: ClientLocale): string {
  const known: Record<number, [string, string]> = {
    401: ["管理员凭据无效或已过期，请重新连接。", "Operator credentials are invalid or expired. Reconnect."],
    403: ["当前操作没有授权。", "This operation is not authorized."],
    404: ["记录不存在或已不可用。", "The record was not found or is no longer available."],
    409: ["记录状态已变化或内容重复，请刷新后重试。", "The record changed or already exists. Refresh and retry."],
    429: ["请求过于频繁，请稍后重试。", "Too many requests. Try again later."]
  };
  const pair = known[status];
  const title = pair ? message(pair[0], pair[1], locale) : status >= 500 ? message("Registry 暂时无法完成请求，请稍后重试。", "The registry could not complete this request. Try again later.", locale) : message("请求未被接受，请检查填写内容。", "The request was rejected. Check the supplied values.", locale);
  return `${title}${detail ? ` ${detail}` : ""}${code ? ` (${code})` : ""}`;
}
export interface FetchOptions { timeoutMs?: number; locale?: ClientLocale; validate?: (value: unknown) => boolean }
export async function fetchJson<T>(base: string, path: string, init?: RequestInit, options: FetchOptions = {}): Promise<T> {
  const locale = options.locale ?? lang();
  if (!normalizeRegistryUrl(base)) throw new RegistryError(message("尚未配置 Registry API。暂时无法提交或查询。", "Registry API is not configured. Submission and live queries are unavailable.", locale));
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 15000);
  const abort = () => controller.abort(init?.signal?.reason);
  if (init?.signal?.aborted) abort();
  init?.signal?.addEventListener("abort", abort, { once: true });
  try {
    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");
    if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(buildApiUrl(base, path), { ...init, headers, signal: controller.signal, credentials: "omit", redirect: "error", cache: "no-store" });
    let body: unknown;
    try { body = await response.json(); } catch { throw new RegistryError(response.ok ? message("Registry 返回了无效 JSON。", "Registry returned invalid JSON.", locale) : apiErrorMessage(response.status, "HTTP_ERROR", "", locale), response.status, "INVALID_RESPONSE"); }
    if (!response.ok) {
      const error = isObject(body) && isObject(body.error) ? body.error : {};
      const code = typeof error.code === "string" ? error.code : "HTTP_ERROR";
      throw new RegistryError(apiErrorMessage(response.status, code, typeof error.message === "string" ? error.message : "", locale), response.status, code);
    }
    if (!isObject(body) || (options.validate && !options.validate(body))) throw new RegistryError(message("Registry 响应格式不完整，请刷新重试。", "Registry response is incomplete. Refresh and retry.", locale), response.status, "INVALID_RESPONSE");
    return body as T;
  } catch (error) {
    if (error instanceof RegistryError) throw error;
    if (controller.signal.aborted) {
      if (!timedOut) throw error;
      throw new RegistryError(message("请求超时，内容已保留，请重试。", "Request timed out. Your input is preserved; try again.", locale), 0, "TIMEOUT");
    }
    throw new RegistryError(message("无法连接 Registry，请检查网络和 API 地址后重试。", "Could not connect to the registry. Check the network and API address, then retry.", locale), 0, "NETWORK_ERROR");
  } finally { clearTimeout(timer); init?.signal?.removeEventListener("abort", abort); }
}
export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export async function fetchCsv(base: string, path: string, init: RequestInit, options: FetchOptions = {}): Promise<Blob> {
  const controller = new AbortController(), locale = options.locale ?? lang();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 15000);
  const abort = () => controller.abort();
  if (init.signal?.aborted) abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  try {
    const headers = new Headers(init.headers); headers.set("Accept", "text/csv");
    const response = await fetch(buildApiUrl(base,path), { ...init, headers, signal: controller.signal, credentials: "omit", redirect: "error", cache: "no-store" });
    if (!response.ok) throw new RegistryError(apiErrorMessage(response.status,"CSV_ERROR","",locale),response.status,"CSV_ERROR");
    if (!response.headers.get("Content-Type")?.includes("text/csv")) throw new RegistryError(message("导出响应不是 CSV，未保存文件。","The export was not CSV. No file was saved.",locale),response.status,"INVALID_RESPONSE");
    return await response.blob();
  } catch(error) {
    if (error instanceof RegistryError) throw error;
    if (controller.signal.aborted && !timedOut) throw error;
    throw new RegistryError(timedOut ? message("CSV 导出超时，请重试。","CSV export timed out. Try again.",locale) : message("CSV 导出连接失败，请重试。","CSV export failed to connect. Try again.",locale));
  } finally { clearTimeout(timer); init.signal?.removeEventListener("abort",abort); }
}
export function isPageResponse(value: unknown): value is PageResponse<unknown> {
  return isObject(value) && Array.isArray(value.items) && [value.total, value.offset, value.limit].every(item => Number.isSafeInteger(item) && Number(item) >= 0);
}
export function safeExternalUrl(value: string): string | null {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function validateCampaign(input: CampaignInput, committedCents = 0): string | null {
  if (!input.name.trim() || input.name.length > 120 || !input.sponsor.trim() || input.sponsor.length > 120 || !input.text.trim() || input.text.length > CAMPAIGN_TEXT_LIMIT || /[\r\n]/.test(input.text)) return message("名称与赞助方必填且最多 120 字符；广告文案为单行，最多 280 字符。", "Name and sponsor are required and limited to 120 characters; ad copy must be a single line up to 280 characters.");
  if (!safeExternalUrl(input.url)) return message("广告目标必须使用不含账号的 HTTPS 地址。", "Ad destination must use HTTPS without credentials.");
  if (![input.budgetCents, input.cpcCents, input.dailyCap].every(value => Number.isSafeInteger(value) && value >= 0) || input.cpcCents > 100000000 || input.dailyCap > 10000000) return message("预算、CPC、日上限须为非负整数；CPC 上限 100,000,000 分，UTC 日分配上限 10,000,000。", "Use non-negative integers; maximum CPC is 100,000,000 cents and daily UTC allocation cap is 10,000,000.");
  if (input.active && (!input.cpcCents || !input.dailyCap || input.budgetCents < input.cpcCents)) return message("启用活动的 CPC 与日上限必须大于零，预算须覆盖一次点击。","Active campaigns need positive CPC and daily cap, with enough budget for one click.");
  if (input.budgetCents < committedCents) return message("预算不能低于已花费与预留金额之和。", "Budget cannot be below total spent plus reserved funds.");
  const starts = Date.parse(input.startsAt), ends = Date.parse(input.endsAt);
  if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) return message("结束时间必须晚于开始时间。", "End time must be after start time.");
  return null;
}
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
