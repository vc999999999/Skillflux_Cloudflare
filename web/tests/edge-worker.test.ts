import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';

type AssetBinding = { fetch(request: Request): Promise<Response> };
type TestWorker = { fetch(request: Request, env: { ASSETS: AssetBinding }): Promise<Response> };
let worker: TestWorker;

beforeAll(async () => {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL('../edge/worker.ts', import.meta.url))],
    write: false, bundle: true, format: 'cjs', platform: 'neutral', target: 'es2022',
    define: {
      __SEO_REDIRECTS__: JSON.stringify({ '/setup/': '/install/' }),
      __SEO_PAGES__: JSON.stringify(['/', '/install/', '/registry/', '/registry/page/2/', '/404.html'])
    }
  });
  const module: { exports: { default?: TestWorker } } = { exports: {} };
  new Function('module', compiled.outputFiles[0]!.text)(module);
  if (!module.exports.default) throw new Error('Worker bundle has no default handler');
  worker = module.exports.default;
});

function assets() {
  const fetch = vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname === '/404/') {
      return new Response(request.method === 'HEAD' ? null : '<h1>Page not found</h1>', {
        headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=0, must-revalidate' }
      });
    }
    if (url.pathname === '/missing/') return new Response('Missing page', { status: 404 });
    return new Response('Existing page', { headers: { 'Content-Type': 'text/html' } });
  });
  return { fetch, env: { ASSETS: { fetch } } };
}

describe('production edge routing', () => {
  it.each(['skillflux.app', 'www.skillflux.app', 'skillflux.cn', 'www.skillflux.cn'])('sends public HTTP on %s to the primary HTTPS domain', async host => {
    for (const path of ['/registry/', '/install/', '/setup/?utm_source=docs']) {
      const { fetch, env } = assets();
      const response = await worker.fetch(new Request(`http://${host}${path}`), env);
      expect(response.status).toBe(308);
      expect(response.headers.get('Location')).toBe(`https://skillflux.app${path}`);
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it.each(['www.skillflux.app', 'skillflux.cn', 'www.skillflux.cn'])('redirects %s to the primary domain without fetching assets', async host => {
    const { fetch, env } = assets();
    const response = await worker.fetch(new Request(`https://${host}/directory/?q=agent`), env);
    expect(response.status).toBe(308);
    expect(response.headers.get('Location')).toBe('https://skillflux.app/directory/?q=agent');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])('keeps local HTTP development working on %s', async host => {
    const { fetch, env } = assets();
    const response = await worker.fetch(new Request(`http://${host}:4321/install/`), env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Existing page');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(['/404', '/404/', '/404.html'])('serves %s as a real 404 without the asset redirect or soft 404', async path => {
    const { fetch, env } = assets();
    const response = await worker.fetch(new Request(`https://skillflux.app${path}?test=1`), env);
    expect(response.status).toBe(404);
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, follow');
    expect(response.headers.get('Location')).toBeNull();
    expect(response.headers.get('Content-Type')).toBe('text/html');
    expect(await response.text()).toBe('<h1>Page not found</h1>');
    expect(new URL(fetch.mock.calls[0]![0].url).pathname).toBe('/404/');
  });

  it('keeps error HEAD responses bodyless and ordinary missing pages at 404', async () => {
    const { env } = assets();
    const head = await worker.fetch(new Request('https://skillflux.app/404/', { method: 'HEAD' }), env);
    expect(head.status).toBe(404);
    expect(await head.text()).toBe('');
    const missing = await worker.fetch(new Request('https://skillflux.app/missing/'), env);
    expect(missing.status).toBe(404);
    expect(missing.headers.get('X-Robots-Tag')).toBe('noindex, follow');
    expect(await missing.text()).toBe('Missing page');
  });

  it('preserves legacy, extension, trailing-slash and existing-page pagination redirects', async () => {
    for (const [from, to] of [
      ['/setup/?utm_source=docs', '/install/?utm_source=docs'],
      ['/install', '/install/'],
      ['/install/index.html', '/install/'],
      ['/registry/?page=2&utm_source=docs', '/registry/page/2/?utm_source=docs']
    ]) {
      const { fetch, env } = assets();
      const response = await worker.fetch(new Request(`https://skillflux.app${from}`), env);
      expect(response.status).toBe(301);
      expect(response.headers.get('Location')).toBe(`https://skillflux.app${to}`);
      expect(fetch).not.toHaveBeenCalled();
    }
  });

});
