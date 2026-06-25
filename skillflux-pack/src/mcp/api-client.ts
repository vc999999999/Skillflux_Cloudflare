import { apiBaseUrl, isFixtureMode, readConfig, writeConfig } from "../lib/config.js";

export type AuthStatus = "unauthenticated" | "pending" | "needs_payment" | "active" | "expired";

export interface AuthStatusResult {
  status: AuthStatus;
  plan?: string;
  expiresAt?: string;
  loginUrl?: string;
  userCode?: string;
  pollAfterSeconds?: number;
  message?: string;
  deviceToken?: string;
}

export interface DeviceStartResult {
  loginUrl: string;
  deviceSessionId: string;
  userCode: string;
  expiresAt: string;
  pollAfterSeconds: number;
}

export interface CheckoutResult {
  checkoutUrl: string;
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  message?: string;
  code?: string;
}

async function apiFetch<T>(
  path: string,
  init: RequestInit & { token?: string } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (init.token) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers,
  });

  const body = (await response.json()) as ApiEnvelope<T> | T;

  if (
    typeof body === "object" &&
    body !== null &&
    "ok" in body &&
    (body as ApiEnvelope<T>).ok === false
  ) {
    const failure = body as ApiEnvelope<T>;
    throw new Error(failure.message ?? failure.code ?? `API ${path} failed`);
  }

  if (!response.ok) {
    throw new Error(`API ${path} failed (${response.status})`);
  }

  if (typeof body === "object" && body !== null && "ok" in body && "data" in body) {
    return (body as ApiEnvelope<T>).data as T;
  }

  return body as T;
}

export async function startDeviceSession(
  deviceId: string,
  agent: string,
): Promise<DeviceStartResult> {
  return apiFetch<DeviceStartResult>("/device/start", {
    method: "POST",
    body: JSON.stringify({ deviceId, agent }),
  });
}

export async function pollDeviceStatus(
  deviceSessionId: string,
): Promise<AuthStatusResult> {
  return apiFetch<AuthStatusResult>("/device/status", {
    method: "POST",
    body: JSON.stringify({ deviceSessionId }),
  });
}

export async function fetchAuthStatusWithToken(token: string): Promise<AuthStatusResult> {
  return apiFetch<AuthStatusResult>("/device/status", {
    method: "POST",
    token,
    body: JSON.stringify({}),
  });
}

export async function createCheckout(
  token: string,
  product = "deluxe-pack",
): Promise<CheckoutResult> {
  return apiFetch<CheckoutResult>("/checkout", {
    method: "POST",
    token,
    body: JSON.stringify({ product }),
  });
}

export async function fetchPack(token: string) {
  return apiFetch("/pack", { method: "GET", token });
}

export async function fetchSkill(token: string, id: string, version?: string) {
  const query = version ? `?version=${encodeURIComponent(version)}` : "";
  return apiFetch(`/skill/${encodeURIComponent(id)}${query}`, { method: "GET", token });
}

export async function resolveAuthStatus(): Promise<AuthStatusResult> {
  const config = await readConfig();

  if (isFixtureMode()) {
    return {
      status: "active",
      plan: "fixture",
      message: "Fixture mode — local bundled catalog without API.",
    };
  }

  if (!config) {
    return { status: "unauthenticated", message: "Run `npx skillflux install` first." };
  }

  if (config.deviceToken) {
    const result = await fetchAuthStatusWithToken(config.deviceToken);
    return {
      ...result,
      message: result.message ?? `Auth status: ${result.status}.`,
    };
  }

  if (config.deviceSessionId) {
    const result = await pollDeviceStatus(config.deviceSessionId);
    if (result.deviceToken) {
      config.deviceToken = result.deviceToken;
      delete config.deviceSessionId;
      await writeConfig(config);
    }
    return result;
  }

  return { status: "unauthenticated", message: "Call auth.start to begin browser login." };
}

export async function beginAuthFlow(): Promise<AuthStatusResult> {
  const config = await readConfig();
  if (!config) {
    throw new Error("SkillFlux is not installed. Run `npx skillflux install` first.");
  }

  if (isFixtureMode()) {
    return {
      status: "active",
      plan: "fixture",
      message: "Fixture mode skips browser login.",
    };
  }

  const started = await startDeviceSession(config.deviceId, config.agent);
  config.deviceSessionId = started.deviceSessionId;
  await writeConfig(config);

  return {
    status: "pending",
    loginUrl: started.loginUrl,
    userCode: started.userCode,
    pollAfterSeconds: started.pollAfterSeconds,
    message: "Open the login URL in your browser to authorize this device.",
  };
}

export async function beginCheckout(product?: string): Promise<CheckoutResult> {
  const config = await readConfig();
  if (!config?.deviceToken) {
    throw new Error("Login required before checkout.");
  }
  if (isFixtureMode()) {
    return {
      checkoutUrl: "https://skillflux.cn/pack?utm_source=fixture",
    };
  }
  return createCheckout(config.deviceToken, product);
}
