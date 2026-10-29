import { defineMiddleware } from 'astro:middleware';
import { getGoneRoutes, getLegacyRedirects } from './lib/seo-routes';
import { GONE_HEADERS, renderGonePage, resolveRoute } from './lib/route-rules';
import { isFacetedUrl } from './lib/indexing';

const redirects = getLegacyRedirects();
const gone = getGoneRoutes();
export const onRequest = defineMiddleware(async (context, next) => {
  // Production is static: the same rules run in the generated edge Worker.
  // In development this middleware makes HTTP behavior match deployment.
  if (!import.meta.env.DEV) return next();
  const decision = resolveRoute(context.url.pathname, redirects, gone);
  if (decision?.kind === 'redirect') return context.redirect(decision.location + context.url.search, 301);
  if (decision?.kind === 'gone') return new Response(renderGonePage(), { status: 410, headers: GONE_HEADERS });
  const response = await next();
  if (!isFacetedUrl(context.url) || !response.headers.get('Content-Type')?.includes('text/html')) return response;
  const html = (await response.text()).replace(/(<meta\s+name="robots"\s+content=")[^"]+/, '$1noindex, follow');
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, follow');
  headers.set('Cache-Control', 'no-store');
  return new Response(html, { status: response.status, headers });
});
