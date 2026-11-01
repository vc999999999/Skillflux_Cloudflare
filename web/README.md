# @skillflux/web

Astro static site for SkillFlux: skill reports, benchmark leaderboard, methodology, open dataset, the source directory and skill deep-dives. English at `/`, Chinese at `/zh/`.

```bash
npm run dev --workspace @skillflux/web     # http://127.0.0.1:4321
npm run build --workspace @skillflux/web   # validate → astro build → SEO gate → worker bundle
npm test --workspace @skillflux/web
```

## Routes

- `/skills/`, `/skills/<id>/`: skill index and per-skill reports (health check, benchmark, how to cite).
- `/benchmarks/`, `/runs/`, `/runs/<runId>/`: leaderboard and immutable benchmark runs.
- `/methodology/`, `/methodology/v1/`: versioned method.
- `/data/` and `/data/*.json|csv`: open dataset with a sha256 manifest at `/data/index.json`.
- `/directory/`, `/resource/<slug>/`, `/source-type/`, `/tag/`, `/agents/`: the source directory; source pages carry the SkillFlux sample check.
- `/alternatives/<slug>/`, `/compare/<a>-vs-<b>/`, `/best/<topic>/`: comparisons built from editorial data and source audits.
- `/insights/`, `/guides/`, `/scenarios/`: editorial content.
- `/llms.txt`, `/llms-full.txt`, `/AGENTS.md`, `/index.json`, RSS feeds: machine entry points.
- `/ai/tasks/index.json`, `/ai/tasks/<task>.json`, `/data/claims.json`, `/skills/<id>.md`, `/resource/<slug>.md`: the agent layer (task index, claims with evidence, Markdown twins).

Pages in both languages are single route files under `src/pages/[...lang]/` using `langStaticPaths()`.

## Data

`src/lib/skills.ts` loads `data/skills`, `data/health` and `data/benchmarks/runs`, and `src/lib/source-audits.ts` loads `data/source-audits`, at build time and validates them with `src/lib/skill-data.ts`. `scripts/validate-data.ts` runs the same checks. `scripts/seo-build.ts` checks canonical, hreflang, JSON-LD and report structure on the built HTML, then writes the sitemaps.
