"""Exercise the built public site with native Python Playwright. No production writes."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:4440')
    parser.add_argument('--output', default='/tmp/skillflux-public-ui')
    parser.add_argument('--inspect', action='store_true')
    parser.add_argument('--channel', default='chrome', help='Installed Chromium channel; use chromium for the bundled Playwright browser')
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    evidence = {'base': args.base, 'checks': [], 'screenshots': [], 'errors': []}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, **({} if args.channel == 'chromium' else {'channel': args.channel}))
        try:
            context = browser.new_context(viewport={'width': 1440, 'height': 1000})
            context.route('https://static.cloudflareinsights.com/**', lambda route: route.abort())
            page = context.new_page()
            page.on('pageerror', lambda error: evidence['errors'].append(str(error)))
            page.goto(args.base + '/', wait_until='networkidle')
            print(json.dumps({'title': page.title(), 'headings': page.locator('h1,h2').all_text_contents(), 'buttons': page.get_by_role('button').all_text_contents(), 'navigation': page.locator('header nav a').all_text_contents()}, ensure_ascii=False))
            screenshot = str(output / 'home-desktop.png')
            page.screenshot(path=screenshot, full_page=True)
            evidence['screenshots'].append(screenshot)
            if args.inspect:
                return

            payload = context.request.get(args.base + '/index.json').json()
            source_count = len(payload['sites'])
            curated_count = len(payload['curated']['skills'])
            evidence.update({'sources': source_count, 'curated': curated_count})
            page.goto(args.base + '/directory/?q=anthropics', wait_until='networkidle')
            print(json.dumps({'directory_controls': page.locator('button').all_text_contents(), 'visible_sources': page.locator('[data-site-row]:visible').all_text_contents()}, ensure_ascii=False))
            expect(page.locator('[data-directory-search]')).to_have_value('anthropics')
            assert page.locator('[data-site-row]:visible').count() > 0
            page.locator('[data-directory-search]').fill('no-such-source-34289')
            expect(page.locator('[data-directory-empty]')).to_be_visible()
            assert parse_qs(urlparse(page.url).query)['q'] == ['no-such-source-34289']
            page.locator('[data-directory-reset]:visible').first.click()
            expect(page.locator('[data-site-row]:visible')).to_have_count(source_count)
            first_facet = page.locator('[data-category-filter]:not([data-category-filter="all"])').first
            facet_value = first_facet.get_attribute('data-category-filter')
            first_facet.click()
            assert parse_qs(urlparse(page.url).query)['category'] == [facet_value]
            assert all(value == facet_value for value in page.locator('[data-site-row]:visible').evaluate_all('(rows) => rows.map(row => row.dataset.category)'))
            assert 'category=' in page.locator('[data-language-link][lang="en"]').get_attribute('href')
            page.reload(wait_until='networkidle')
            expect(page.locator(f'[data-category-filter="{facet_value}"]')).to_have_attribute('aria-pressed', 'true')
            page.locator('[data-language-link][lang="en"]').click()
            page.wait_for_load_state('networkidle')
            assert '/en/directory/' in page.url and 'category=' in page.url
            page.locator('[data-directory-reset]:visible').first.click()
            page.go_back(wait_until='networkidle')
            expect(page.locator(f'[data-category-filter="{facet_value}"]')).to_have_attribute('aria-pressed', 'true')
            evidence['checks'].append('directory search, empty, clear, facets, URL reload, language and back navigation')

            page.goto(args.base + '/registry/', wait_until='networkidle')
            print(json.dumps({'registry_controls': page.locator('button,select').all_text_contents(), 'cards': page.locator('[data-skill-id]').count()}, ensure_ascii=False))
            expect(page.locator('[data-skill-id]')).to_have_count(curated_count)
            page.locator('[data-skill-filters] input[name="q"]').fill('zzqxv987654321zzq')
            page.locator('[data-skill-filters] button[type="submit"]').click()
            expect(page.locator('[data-skill-empty]')).to_be_visible()
            assert 'q=' in page.locator('[data-language-link][lang="en"]').get_attribute('href')
            page.locator('[data-skill-filters] button[type="reset"]').click()
            expect(page.locator('[data-skill-id]:visible')).to_have_count(min(curated_count, 12))
            if curated_count > 12:
                page.locator('[data-skill-next]').click()
                assert parse_qs(urlparse(page.url).query)['page'] == ['2']
                page.go_back(wait_until='networkidle')
                expect(page.locator('[data-skill-prev]')).to_be_disabled()
            evidence['checks'].append('curated search, reset, count, empty and pagination when populated')

            if curated_count:
                page.locator('[data-skill-id] h3 a').first.click()
                page.wait_for_load_state('networkidle')
                expect(page.locator('.skill-file')).not_to_have_count(0)
                expect(page.locator('.skill-file[open] pre')).to_be_visible()
                page.context.grant_permissions(['clipboard-read', 'clipboard-write'])
                page.locator('[data-copy-text]').first.click()
                expect(page.locator('[data-copy-feedback]')).to_be_visible()
                assert 'skillflux install' in page.evaluate('navigator.clipboard.readText()')
                evidence['checks'].append('populated exact release, original text and clipboard command')

            routes = ['/', '/en/', '/directory/', '/en/directory/', '/registry/', '/en/registry/', '/scenarios/', '/en/scenarios/', '/setup/', '/en/setup/', '/quality/', '/privacy/', '/terms/', '/advertise/', '/contact/', '/report/', '/404.html', '/en/404/', '/guides/', '/insights/']
            routes += ['/for-ai/', '/en/for-ai/']
            for section in ['scenarios']:
                routes += [urlparse(item[key]).path for item in payload[section] for key in ['url', 'englishUrl']]
            routes += [urlparse(item['versionUrl']).path for item in payload['curated']['skills']]
            for width in [1440, 768, 390, 320]:
                page.set_viewport_size({'width': width, 'height': 920})
                for route in routes:
                    response = page.goto(args.base + route, wait_until='networkidle')
                    assert response and response.status == 200, (route, response.status if response else None)
                    expect(page.locator('h1')).to_have_count(1)
                    expect(page.locator('main#main-content')).to_have_count(1)
                    assert page.evaluate('window.__skillflux_xss === undefined'), f'Untrusted content executed at {route}'
                    if not page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1'):
                        page.screenshot(path=str(output / 'overflow.png'), full_page=True)
                        print(json.dumps(page.locator('body *').evaluate_all('(nodes) => nodes.filter(n => n.getBoundingClientRect().right > document.documentElement.clientWidth + 1).map(n => ({tag:n.tagName, cls:n.className, width:n.getBoundingClientRect().width, text:n.textContent.slice(0,100)}))'), ensure_ascii=False), flush=True)
                        raise AssertionError(f'Horizontal overflow at {width}px {route}')
                    for raw in page.locator('script[type="application/ld+json"]').all_text_contents():
                        json.loads(raw)
                page.goto(args.base + '/', wait_until='networkidle')
                screenshot = str(output / f'home-{width}.png')
                page.screenshot(path=screenshot, full_page=True)
                evidence['screenshots'].append(screenshot)
            evidence['checks'].append(f'{len(routes)} routes at desktop/tablet/390px/320px: main, h1, no overflow and JSON-LD')

            page.goto(args.base + '/', wait_until='networkidle')
            page.keyboard.press('Tab')
            expect(page.locator('.skip-link')).to_be_focused()
            page.evaluate('document.activeElement.blur()')
            page.set_viewport_size({'width': 390, 'height': 920})
            page.locator('.sf-menu-toggle').click()
            expect(page.locator('.sf-menu-toggle')).to_have_attribute('aria-expanded', 'true')
            expect(page.locator('#sf-mobile-nav')).to_be_visible()
            page.locator('#sf-mobile-nav a').first.click()
            page.wait_for_load_state('networkidle')
            assert '/directory/' in page.url
            evidence['checks'].append('keyboard skip link and mobile navigation toggle work')

            nojs = browser.new_context(java_script_enabled=False, viewport={'width': 1280, 'height': 900})
            static_page = nojs.new_page()
            for route in ['/directory/', '/en/directory/']:
                static_page.goto(args.base + route, wait_until='networkidle')
                expect(static_page.locator('[data-site-row]:visible')).to_have_count(source_count)
                expect(static_page.locator('main#main-content')).to_have_count(1)
            for route in ['/registry/', '/en/registry/']:
                static_page.goto(args.base + route, wait_until='networkidle')
                expect(static_page.locator('[data-skill-id]:visible')).to_have_count(curated_count)
            for item in payload['curated']['skills']:
                static_page.goto(args.base + urlparse(item['versionUrl']).path, wait_until='networkidle')
                expect(static_page.locator('.skill-file[open] pre')).to_be_visible()
            static_page.goto(args.base + '/scenarios/', wait_until='networkidle')
            for item in payload['scenarios']:
                assert item['title']['zh'] in static_page.locator('main').inner_text()
            evidence['checks'].append('JavaScript disabled: all source rows, curated cards/text and scenarios remain server-rendered')
            nojs.close()

            all_links = set()
            for route in ['/', '/en/', '/directory/', '/scenarios/', '/registry/', '/for-ai/']:
                page.goto(args.base + route, wait_until='networkidle')
                for href in page.locator('a[href]').evaluate_all('(links) => links.map(link => link.href)'):
                    if href.startswith(args.base):
                        all_links.add(href.split('#')[0])
            for link in sorted(all_links):
                response = context.request.get(link)
                assert response.ok, f'Broken public navigation: {response.status} {link}'
            evidence['checks'].append(f'{len(all_links)} internal navigation links return successful responses')
            assert not evidence['errors'], evidence['errors']
            print(json.dumps(evidence, ensure_ascii=False, indent=2))
        finally:
            browser.close()


if __name__ == '__main__':
    main()
