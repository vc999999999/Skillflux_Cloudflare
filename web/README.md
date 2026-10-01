# SkillFlux Web

Astro static website for the curated skill catalog snapshot (synced from the GitHub catalog repository), source directory, use cases, editorial collections, and the setup guide. This is the only active frontend workspace.

## Local development

Run from the repository root:

```bash
npm ci
npm run dev
```

The web app serves on `http://127.0.0.1:4321`. There is no local backend; curated content comes from the synced publication snapshot (`data/registry-publication.json`). To sync real catalog content:

```bash
npm run publication:sync --workspace @skillflux/web -- --repo vc999999999/skillflux-catalog
SITE_URL=https://skillflux.cn npm run build --workspace @skillflux/web
```

## Verification

```bash
npm run typecheck --workspace @skillflux/web
npm test --workspace @skillflux/web
npm run build --workspace @skillflux/web
python web/scripts/public-ui-check.py
```

The browser check only exercises the built static site; it performs no production writes.

## Public entry points

- `/directory/`: filter the source catalog.
- `/registry/` and `/skills/:id/`: curated skill pages from the catalog snapshot.
- `/scenarios/`: task guides.
- `/install/`: source installation, project host selection and exact-version workflow.
- `/for-ai/`: plain-text, JSON and RSS endpoints with their data boundaries.
- `/submit/`: prepare a GitHub resource issue in the browser; the user reviews and publishes it on GitHub.

These pages also have `/en/` routes. `src/components/` owns reusable bilingual page layouts; `src/pages/` owns routes. Catalog data stays in `data/`, public assets in `public/`, and content scripts in `scripts/`. See [the cleanup record](../docs/frontend-redesign.md) for the workspace migration history.
