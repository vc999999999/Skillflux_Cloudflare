# SkillFlux Web

Astro static website for the signed curated Skill Registry snapshot, source directory, use cases, editorial collections, setup guide, and operator console. This is the only active frontend workspace.

## Local development

Run from the repository root:

```bash
npm ci
npm run dev
```

The root launcher supervises the web app on `http://127.0.0.1:4321` and the development Registry on `http://127.0.0.1:8787`.

To run only the web workspace:

```bash
npm run dev --workspace @skillflux/web
```

In Astro development, an unset `PUBLIC_REGISTRY_URL` falls back to the loopback Registry. A production build must set it explicitly:

```bash
PUBLIC_REGISTRY_URL=https://api.example.com SITE_URL=https://example.com npm run build --workspace @skillflux/web
```

Use `PUBLIC_REGISTRY_URL=/` with `web/nginx.conf`; the nginx container proxies `/v1/`, `/r/`, and `/health` to the Registry container.

## Verification

```bash
npm run typecheck --workspace @skillflux/web
npm test --workspace @skillflux/web
npm run build --workspace @skillflux/web
python web/scripts/visual-check.py
```

The browser check expects both development services to be running. Set `SKILLFLUX_TEST_ADMIN_TOKEN` to include read-only console checks; the token is not written to disk by the script.

`scripts/console-integration-check.py` exercises submission, approval, withdrawal, Campaign creation, and pause through the real browser console. It refuses to run against the default `:8787` Registry unless explicitly overridden; point it at a disposable Registry data directory and non-default port.

## Public entry points

- `/directory/`: filter the source catalog.
- `/scenarios/` and `/collections/`: task guides and editorial collections.
- `/setup/`: source installation, project host selection and exact-version workflow.
- `/for-ai/`: existing plain-text, JSON and RSS endpoints with their data boundaries.
- `/submit/`: prepare a GitHub resource issue in the browser; the user reviews and publishes it on GitHub.

These pages also have `/en/` routes. `src/components/` owns reusable bilingual page layouts; `src/pages/` owns routes. Catalog data stays in `data/`, public assets in `public/`, and content scripts in `scripts/`. Root `src/`, `data/`, `public/` and duplicate Astro configuration were retired after workspace migration. See [the cleanup record](../docs/frontend-redesign.md).
