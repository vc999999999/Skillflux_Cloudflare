import { encodeOAuthState, githubAuthorizeUrl, siteUrl } from "../../../lib/oauth-github.js";
import { getDeviceSessionById, sessionExpired, markSessionExpired } from "../../../lib/sessions.js";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const sessionId = context.request.url
    ? new URL(context.request.url).searchParams.get("session")
    : null;

  if (!sessionId) {
    return new Response("Missing session parameter.", { status: 400 });
  }

  const session = await getDeviceSessionById(context.env.DB, sessionId);
  if (!session) {
    return new Response("Unknown or expired device session.", { status: 404 });
  }
  if (sessionExpired(session)) {
    await markSessionExpired(context.env.DB, session.id);
    return new Response("Device session expired.", { status: 410 });
  }

  if (!context.env.GITHUB_CLIENT_ID) {
    if (context.env.SKILLFLUX_FIXTURE_MODE === "1") {
      const origin = siteUrl(context.env, context.request);
      return Response.redirect(
        `${origin}/api/auth/callback/fixture?session=${encodeURIComponent(sessionId)}`,
        302,
      );
    }
    return new Response("GitHub OAuth is not configured.", { status: 501 });
  }

  const state = encodeOAuthState(sessionId);
  const url = githubAuthorizeUrl(context.env, context.request, state);
  return Response.redirect(url, 302);
};
