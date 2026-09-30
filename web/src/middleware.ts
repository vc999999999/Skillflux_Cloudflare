import { defineMiddleware } from 'astro:middleware';
import { getLegacyRedirects, getRedirectTarget } from './lib/seo-routes';
import { isFacetedUrl } from './lib/indexing';

const redirects = getLegacyRedirects();
export const onRequest = defineMiddleware(async (context, next) => {
  // Production is static: the same rules run in the generated edge Worker or
  // nginx. In development this middleware makes HTTP behavior match deployment.
  if (!import.meta.env.DEV) return next();
  const target = getRedirectTarget(context.url.pathname, redirects);
  if (target) return context.redirect(target + context.url.search, 301);
  const response = await next();
  if (!isFacetedUrl(context.url) || !response.headers.get('Content-Type')?.includes('text/html')) return response;
  const html = (await response.text()).replace(/(<meta\s+name="robots"\s+content=")[^"]+/, '$1noindex, follow');
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, follow');
  headers.set('Cache-Control', 'no-store');
  return new Response(html, { status: response.status, headers });
});
