export function siteUrl(env: Env, request: Request): string {
  return (env.SITE_URL ?? new URL(request.url).origin).replace(/\/$/, "");
}

export function githubAuthorizeUrl(env: Env, request: Request, state: string): string {
  if (!env.GITHUB_CLIENT_ID) {
    throw new Error("GITHUB_CLIENT_ID is not configured");
  }
  const redirectUri = `${siteUrl(env, request)}/api/auth/callback/github`;
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "read:user user:email",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeGitHubCode(
  env: Env,
  request: Request,
  code: string,
): Promise<{ access_token: string }> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    throw new Error("GitHub OAuth is not configured");
  }

  const redirectUri = `${siteUrl(env, request)}/api/auth/callback/github`;
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed (${response.status})`);
  }

  const payload = (await response.json()) as { access_token?: string; error?: string };
  if (!payload.access_token) {
    throw new Error(payload.error ?? "Missing GitHub access token");
  }
  return { access_token: payload.access_token };
}

export async function fetchGitHubUser(accessToken: string): Promise<{
  id: number;
  login: string;
  email?: string | null;
}> {
  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "User-Agent": "skillflux-registry",
    },
  });
  if (!userResponse.ok) {
    throw new Error(`GitHub user fetch failed (${userResponse.status})`);
  }
  const user = (await userResponse.json()) as { id: number; login: string; email?: string | null };

  if (!user.email) {
    const emailsResponse = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "User-Agent": "skillflux-registry",
      },
    });
    if (emailsResponse.ok) {
      const emails = (await emailsResponse.json()) as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const primary = emails.find((entry) => entry.primary && entry.verified);
      user.email = primary?.email ?? emails[0]?.email ?? null;
    }
  }

  return user;
}

export function encodeOAuthState(sessionId: string): string {
  return btoa(JSON.stringify({ sessionId, ts: Date.now() }));
}

export function decodeOAuthState(state: string): { sessionId: string } | null {
  try {
    const parsed = JSON.parse(atob(state)) as { sessionId?: string };
    if (!parsed.sessionId) return null;
    return { sessionId: parsed.sessionId };
  } catch {
    return null;
  }
}
