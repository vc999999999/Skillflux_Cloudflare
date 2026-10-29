# @skillflux/bench

Tooling behind the SkillFlux dataset: imports skills at pinned commits, runs the static health check (L1), and runs and publishes Claude Code benchmarks (L2). The method is documented at [skillflux.app/methodology/v1/](https://skillflux.app/methodology/v1/).

## Data it writes

| Path | Written by | Edited by hand |
| --- | --- | --- |
| `web/data/skills/<id>.json` | `bench import` (drafts) | yes: summary, category, tags, status |
| `web/data/health/<id>.json` | `bench health` | no |
| `web/data/benchmarks/runs/<runId>.json` | `bench publish` | never; corrections supersede |
| `bench/runs/<runId>/` | `bench run` (gitignored; transcripts) | no |

## L1: health check

```bash
GITHUB_TOKEN=$(gh auth token) npm run bench -- import https://github.com/<owner>/<repo> --site <sites.json slug> --category <slug>
GITHUB_TOKEN=$(gh auth token) npm run health
```

A skill becomes public when its record has a real bilingual summary and `status: "listed"`. `npm run validate` (and the site build) checks every record. Health records change only when a result changes, so the weekly workflow produces a pull request only when something did.

## L2: benchmark

Tasks live in `bench/tasks/<skillId>/<taskId>/` (`task.json`, `fixtures/`, `reference/`, `grade.mjs`). Rebuild binary fixtures with `python3 bench/tasks/_build/build_fixtures.py`. Before a task is used:

```bash
npm run bench -- lint-tasks   # reference must pass, empty workspace must fail
npm run bench -- run --dry-run --skills anthropics-skills-xlsx --repeats 2   # fake claude, no cost
```

A real run happens only inside the container (see `docker/Dockerfile`) and needs `ANTHROPIC_API_KEY`:

```bash
docker build -f bench/docker/Dockerfile --build-arg CLAUDE_CODE_VERSION=<exact version> -t skillflux-bench .
docker run --rm -e ANTHROPIC_API_KEY -v "$PWD":/repo -w /repo skillflux-bench \
  npm run bench -- run --model <model id> --repeats 5 --budget-usd 150
npm run bench -- publish bench/runs/<runId>
```

Check the flags in `src/runner/claude.ts` against `claude --help` for the pinned version before a first run. Review transcripts before attaching them to a release.
