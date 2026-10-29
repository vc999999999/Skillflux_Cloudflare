#!/usr/bin/env node
// SkillFlux bench: import skills, run the L1 health check, run and publish
// L2 benchmarks. Run `tsx src/cli.ts help` for usage.
import { parseArgs } from 'node:util';

const usage = `Usage: bench <command> [options]

  import <github-url>   Write draft skill records for every SKILL.md in a repository
      --sha <commit>        Pin this commit (default: current default-branch head)
      --path <dir>          Only this skill directory (repeatable)
      --site <slug>         Directory source slug in web/data/sites.json (required)
      --category <slug>     Skill category (required)
      --author <name>       Author display name (default: repository owner)
      --limit <n>           Import at most n skills

  health                Run the L1 static health check for every non-delisted skill
      --only <id>           Only this skill (repeatable)
      --offline             Use cached snapshots and last recorded repository facts
      --force               Rewrite records even when the result is unchanged

  lint-tasks            Validate task specs and prove each grader can tell pass from fail
      --only <skillId>      Only this skill's tasks (repeatable)

  run                   Run the L2 benchmark (Claude Code headless; run inside Docker)
      --skills <id,...>     Skills to run (default: every skill with tasks)
      --model <id>          Model id passed to claude --model (required)
      --repeats <n>         Repetitions per task and arm (default 5)
      --concurrency <n>     Parallel trials (default 2)
      --budget-usd <n>      Stop scheduling new trials past this total cost (required)
      --seed <n>            Order seed (default 42)
      --claude-bin <path>   claude executable (default: claude, or SKILLFLUX_CLAUDE_BIN)
      --allow-host          Permit running outside a container (not for published runs)
      --dry-run             Use the deterministic fake claude for an end-to-end check

  publish <run-dir>     Summarize a finished run into web/data/benchmarks/runs/<runId>.json
      --supersedes <runId>  This run corrects an earlier one
`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      sha: { type: 'string' }, path: { type: 'string', multiple: true }, site: { type: 'string' },
      category: { type: 'string' }, author: { type: 'string' }, limit: { type: 'string' },
      only: { type: 'string', multiple: true }, offline: { type: 'boolean' }, force: { type: 'boolean' },
      skills: { type: 'string' }, model: { type: 'string' }, repeats: { type: 'string' }, concurrency: { type: 'string' },
      'budget-usd': { type: 'string' }, seed: { type: 'string' }, 'claude-bin': { type: 'string' },
      'allow-host': { type: 'boolean' }, 'dry-run': { type: 'boolean' }, supersedes: { type: 'string' },
    },
  });
  switch (command) {
    case 'import': {
      const repo = positionals[0];
      if (!repo || !values.site || !values.category) throw new Error('import needs <github-url>, --site and --category');
      const { importRepo } = await import('./import.js');
      const ids = await importRepo({ repo, sha: values.sha, paths: values.path, sourceSiteSlug: values.site, category: values.category, author: values.author, limit: values.limit ? Number(values.limit) : undefined });
      console.log(ids.length ? `Wrote ${ids.length} draft record(s):\n${ids.map(id => `  ${id}`).join('\n')}` : 'No new skills found.');
      return;
    }
    case 'health': {
      const { runHealth } = await import('./health/run-health.js');
      await runHealth({ only: values.only, offline: values.offline, force: values.force });
      return;
    }
    case 'lint-tasks': {
      const { lintTasks } = await import('./tasks.js');
      const failures = await lintTasks(values.only);
      if (failures.length) { for (const failure of failures) console.error(`✗ ${failure}`); process.exitCode = 1; }
      else console.log('All task specs are valid and their graders discriminate.');
      return;
    }
    case 'run': {
      const { runBenchmark } = await import('./runner/run.js');
      if (!values['dry-run'] && (!values.model || !values['budget-usd'])) throw new Error('run needs --model and --budget-usd');
      const dir = await runBenchmark({
        skills: values.skills?.split(',').map(item => item.trim()).filter(Boolean),
        model: values.model ?? 'fake-model',
        repeats: Number(values.repeats ?? 5),
        concurrency: Number(values.concurrency ?? 2),
        budgetUsd: Number(values['budget-usd'] ?? 1),
        seed: Number(values.seed ?? 42),
        claudeBin: values['claude-bin'] ?? process.env.SKILLFLUX_CLAUDE_BIN,
        allowHost: Boolean(values['allow-host']),
        dryRun: Boolean(values['dry-run']),
      });
      console.log(`Run written to ${dir}`);
      return;
    }
    case 'publish': {
      const dir = positionals[0];
      if (!dir) throw new Error('publish needs <run-dir>');
      const { publishRun } = await import('./publish.js');
      const path = await publishRun(dir, { supersedes: values.supersedes ?? null });
      console.log(`Published ${path}`);
      return;
    }
    default:
      console.log(usage);
      if (command && command !== 'help') process.exitCode = 1;
  }
}

main().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
