import {
  decodeOAuthState,
  exchangeGitHubCode,
  fetchGitHubUser,
  siteUrl,
} from "../../../lib/oauth-github.js";
import { bindUserToSession, getDeviceSessionById, sessionExpired, markSessionExpired } from "../../../lib/sessions.js";
import { upsertGitHubUser } from "../../../lib/users.js";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const origin = siteUrl(context.env, context.request);
  const doneUrl = `${origin}/device?done=1`;

  if (error) {
    return Response.redirect(`${origin}/device?error=${encodeURIComponent(error)}`, 302);
  }

  if (!code || !stateRaw) {
    return new Response("Missing OAuth code or state.", { status: 400 });
  }

  const state = decodeOAuthState(stateRaw);
  if (!state) {
    return new Response("Invalid OAuth state.", { status: 400 });
  }

  const session = await getDeviceSessionById(context.env.DB, state.sessionId);
  if (!session) {
    return new Response("Device session not found.", { status: 404 });
  }
  if (sessionExpired(session)) {
    await markSessionExpired(context.env.DB, session.id);
    return new Response("Device session expired.", { status: 410 });
  }

  try {
    const token = await exchangeGitHubCode(context.env, context.request, code);
    const githubUser = await fetchGitHubUser(token.access_token);
    const user = await upsertGitHubUser(context.env.DB, githubUser);
    await bindUserToSession(context.env.DB, session.id, user.id);
    return Response.redirect(doneUrl, 302);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return Response.redirect(`${origin}/device?error=${encodeURIComponent(message)}`, 302);
  }
};
