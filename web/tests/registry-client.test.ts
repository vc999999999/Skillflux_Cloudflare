import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type RequestListener, type Server } from "node:http";
import { buildApiUrl, buildSearchPath, fetchCsv, fetchJson, formatBytes, formatInstallCommand, isObject, isPageResponse, normalizeRegistryUrl, safeExternalUrl, validateCampaign } from "../src/lib/registry-client";
import type { CampaignInput } from "../src/lib/registry-types";

describe("registry client URL construction", () => {
  it("supports the same-origin Docker proxy base", () => {
    expect(normalizeRegistryUrl(" / ")).toBe("/");
    expect(buildApiUrl("/", "/v1/search?q=test")).toBe("/v1/search?q=test");
  });

  it("supports absolute and path-prefixed registry bases", () => {
    expect(buildApiUrl("https://api.example.com/", "/health")).toBe("https://api.example.com/health");
    expect(buildApiUrl("/registry-api/", "/v1/search")).toBe("/registry-api/v1/search");
  });

  it("rejects credentials, unsafe schemes and remote cleartext APIs", () => {
    for (const input of ["javascript:alert(1)", "//evil.example", "https://name:secret@api.example", "http://api.example", "https://api.example?token=secret"]) {
      expect(() => normalizeRegistryUrl(input)).toThrow();
    }
    expect(normalizeRegistryUrl("http://127.0.0.1:8787/")).toBe("http://127.0.0.1:8787");
    expect(() => buildApiUrl("https://api.example", "//evil.example")).toThrow();
    expect(() => buildApiUrl("https://api.example", "/v1/../other")).toThrow();
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("https://name:secret@example.com")).toBeNull();
  });

  it("encodes filters without inventing optional values", () => {
    const path = buildSearchPath({ q: "设计 research", host: "codex", sort: "newest", limit: 12, offset: 24 });
    const url = new URL(path, "https://local.test");
    expect(url.pathname).toBe("/v1/search");
    expect(url.searchParams.get("q")).toBe("设计 research");
    expect(url.searchParams.get("host")).toBe("codex");
    expect(url.searchParams.get("category")).toBeNull();
    expect(url.searchParams.get("offset")).toBe("24");
  });
});

describe("registry presentation helpers", () => {
  it("creates the exact versioned CLI install command", () => {
    expect(formatInstallCommand("research-synthesis", "1.2.3")).toBe("skillflux install research-synthesis@1.2.3");
    expect(formatInstallCommand("research-synthesis", "1.2.3-rc.1+build.2")).toBe("skillflux install research-synthesis@1.2.3-rc.1+build.2");
    expect(() => formatInstallCommand("test; echo leaked", "1.0.0")).toThrow();
    expect(() => formatInstallCommand("test", "1.0.0$(id)")).toThrow();
  });

  it("formats byte counts without fabricated precision", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.closeAllConnections(); server.close(error => error ? reject(error) : resolve());
  })));
});

async function serve(handler: RequestListener) {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP test address");
  return "http://127.0.0.1:" + address.port;
}

describe("registry HTTP requests", () => {
  it("sends JSON and memory credentials only in headers to an actual HTTP endpoint", async () => {
    const received: { body?: string; authorization?: string; url?: string } = {};
    const base = await serve((request, response) => {
      received.authorization = request.headers.authorization; received.url = request.url;
      let body = ""; request.on("data", chunk => { body += chunk; });
      request.on("end", () => { received.body = body; response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ accepted: true, id: "saved-1" })); });
    });
    const input = { requestId: "request-id-1", message: "preserve this inquiry" };
    const response = await fetchJson(base, "/v1/inquiries", { method: "POST", headers: new Headers({ Authorization: "Bearer test-only" }), body: JSON.stringify(input) }, { validate: value => isObject(value) && value.accepted === true });
    expect(response).toEqual({ accepted: true, id: "saved-1" });
    expect(received).toEqual({ authorization: "Bearer test-only", url: "/v1/inquiries", body: JSON.stringify(input) });
  });

  it("does not turn an API rejection or an invalid success body into a success", async () => {
    const base = await serve((request, response) => {
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/rejected") { response.statusCode = 422; response.end(JSON.stringify({ error: { code: "consent_required", message: "Consent is required" } })); }
      else response.end(JSON.stringify({ message: "not an acceptance record" }));
    });
    await expect(fetchJson(base, "/rejected", undefined, { locale: "en" })).rejects.toThrow(/request was rejected.*Consent is required.*consent_required/);
    await expect(fetchJson(base, "/malformed", undefined, { locale: "en", validate: value => isObject(value) && value.accepted === true && typeof value.id === "string" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(isPageResponse({ items: [], total: 0, offset: 0, limit: 10 })).toBe(true);
    expect(isPageResponse({ items: [], total: "0", offset: 0, limit: 10 })).toBe(false);
  });

  it("enforces a timeout and surfaces a localized retry message", async () => {
    const base = await serve((_request, _response) => { /* Deliberately stalled endpoint. */ });
    await expect(fetchJson(base, "/stalled", undefined, { timeoutMs: 20, locale: "en" })).rejects.toMatchObject({ code: "TIMEOUT", message: expect.stringContaining("input is preserved") });
  });

  it("propagates user cancellation instead of claiming a connection failure", async () => {
    const base = await serve((_request, _response) => {});
    const controller = new AbortController();
    const pending = fetchJson(base, "/stalled", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects redirection instead of forwarding operator authorization", async () => {
    let destinationRequested = false;
    const destination = await serve((_request, response) => { destinationRequested = true; response.end("{}"); });
    const base = await serve((_request, response) => { response.statusCode = 302; response.setHeader("Location", destination + "/secret"); response.end(); });
    await expect(fetchJson(base, "/redirect", { headers: { Authorization: "Bearer test-only" } })).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(destinationRequested).toBe(false);
  });

  it("exports actual CSV and rejects HTML masquerading as an export", async () => {
    const base = await serve((request, response) => {
      response.setHeader("Content-Type", request.url === "/metrics.csv" ? "text/csv; charset=utf-8" : "text/html");
      response.end(request.url === "/metrics.csv" ? "date,clicks\r\n2026-09-06,3\r\n" : "<html>sign in</html>");
    });
    expect(await (await fetchCsv(base, "/metrics.csv", {})).text()).toBe("date,clicks\r\n2026-09-06,3\r\n");
    await expect(fetchCsv(base, "/login", {})).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("campaign editor validation", () => {
  const campaign: CampaignInput = { name: "Editorial campaign", sponsor: "Product studio", text: "A useful product for researchers.", url: "https://example.com/product", categories: ["research"], active: true, budgetCents: 5000, cpcCents: 25, dailyCap: 200, startsAt: "2026-09-06T00:00:00.000Z", endsAt: "2026-10-06T00:00:00.000Z" };
  it("uses the same 280-character single-line limit as the registry", () => {
    expect(validateCampaign({ ...campaign, text: "界".repeat(280) })).toBeNull();
    expect(validateCampaign({ ...campaign, text: "界".repeat(281) })).not.toBeNull();
    expect(validateCampaign({ ...campaign, text: "line one\nline two" })).not.toBeNull();
  });
  it("validates committed funds, active caps, safe destinations and dates", () => {
    expect(validateCampaign(campaign, 5001)).not.toBeNull();
    expect(validateCampaign({ ...campaign, cpcCents: 0 })).not.toBeNull();
    expect(validateCampaign({ ...campaign, dailyCap: 0 })).not.toBeNull();
    expect(validateCampaign({ ...campaign, active: false, cpcCents: 0, dailyCap: 0, budgetCents: 0 })).toBeNull();
    expect(validateCampaign({ ...campaign, endsAt: campaign.startsAt })).not.toBeNull();
    expect(validateCampaign({ ...campaign, url: "http://example.com" })).not.toBeNull();
  });
});
