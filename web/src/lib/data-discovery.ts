// The data half of llms.txt, llms-full.txt and index.json: what SkillFlux
// measured, the results, and how to cite them. Plain text an agent can quote.
import { CHECK_REGISTRY, CHECKER_VERSION } from '@skillflux/bench/checks';
import { ENDPOINTS, SITE } from '../config';
import { absoluteUrl } from './content';
import { DATASET, datasetModified } from './dataset';
import { CURRENT_METHODOLOGY } from './methodology';
import { aggregateFindings, keyFinding, shortSha, type SkillView } from './skill-data';
import { getIndexableSkillViews, getRuns } from './skills';

const reportUrl = (view: SkillView) => absoluteUrl(`/skills/${view.skill.id}/`);

export const CITATION_RULES = [
  'Quote numbers with their context: the skill, the commit or run id, the date, n, and the 95% interval.',
  'Say "no detectable difference" when a report says so; do not turn it into "does not work" or "works".',
  'A health check reads files only. Do not cite it as evidence that a skill helps on a task.',
  'Link the skill report page; the run id and commit on that page identify the exact measurement.',
];

export function renderDataText(full = false): string {
  const views = getIndexableSkillViews();
  const benchmarked = views.filter(view => view.result);
  const runs = getRuns().filter(run => run.status === 'published');
  const flagged = views.filter(view => (view.health?.flags.length ?? 0) > 0).length;
  const lines = [
    '# SkillFlux',
    '',
    SITE.description,
    '',
    `Data updated: ${datasetModified()}`,
    `Skills health-checked: ${views.length}`,
    `Skills benchmarked: ${benchmarked.length}`,
    `Published benchmark runs: ${runs.length}`,
    `License of measurements: ${DATASET.licenseName} (${DATASET.license})`,
    '',
    '## What SkillFlux measures',
    `- Static health check: each listed skill is pinned to a Git commit and checked against ${CHECK_REGISTRY.length} rules (frontmatter, size, broken links, bundled scripts, network calls, destructive commands, secrets, risky instructions, license, maintenance). Checker ${CHECKER_VERSION}. ${flagged} of ${views.length} skills carry at least one descriptive flag.`,
    '- Benchmark: the same tasks run in Claude Code headless mode with and without the skill installed, repeated N times, graded by deterministic scripts. Reports give pass rates with Wilson 95% intervals and the difference with a Newcombe 95% interval; a direction is claimed only when that interval excludes zero.',
    `- Methodology v${CURRENT_METHODOLOGY.version} (immutable): ${absoluteUrl(`/methodology/v${CURRENT_METHODOLOGY.version}/`)}`,
    '',
    `## Findings across ${views.length} health-checked skills (${datasetModified()})`,
    ...aggregateFindings(views).map(item => `- ${item.count} of ${item.total} skills ${item.en}.`),
    '',
    '## How to cite',
    ...CITATION_RULES.map(rule => `- ${rule}`),
    `- Format: SkillFlux (<date>). <Skill> benchmark, run <run id>, methodology v1. <report URL>`,
    '',
  ];
  if (runs.length) {
    const latest = runs[0]!;
    lines.push('## Latest benchmark run', `- ${latest.runId} (${latest.publishedAt}): ${latest.skills.length} skills, ${latest.totals.trials} trials, ${latest.environment.modelRequested}, Claude Code ${latest.environment.claudeCodeVersion}. ${absoluteUrl(`/runs/${latest.runId}/`)}`, '');
  }
  lines.push('## Benchmarked skills');
  if (benchmarked.length) for (const view of benchmarked) lines.push(`- ${view.skill.displayName.en}: ${keyFinding(view, 'en')} ${reportUrl(view)}`);
  else lines.push('- None published yet. Every listed skill below has a static health check.');
  lines.push('', '## Health-checked skills');
  for (const view of views) {
    const flags = view.health?.flags.length ? `; flags: ${view.health.flags.join(', ')}` : '';
    lines.push(full
      ? `- ${view.skill.displayName.en} (${view.skill.author.name}; ${view.skill.license.spdx ?? (view.skill.license.file ? 'own license file' : 'no license found')}; commit ${shortSha(view.skill.source.commitSha)}): ${view.skill.summary.en} Health: ${view.counts.pass} pass, ${view.counts.warn} warn, ${view.counts.fail} fail${flags}. ${reportUrl(view)}`
      : `- ${view.skill.displayName.en}: ${view.counts.pass} pass, ${view.counts.warn} warn, ${view.counts.fail} fail${flags}. ${reportUrl(view)}`);
  }
  lines.push('', '## Data downloads',
    `- Manifest with sha256 checksums: ${absoluteUrl('/data/index.json')}`,
    `- Skills (JSON/CSV): ${absoluteUrl('/data/skills.json')} · ${absoluteUrl('/data/skills.csv')}`,
    `- Health checks (JSON/CSV): ${absoluteUrl('/data/health.json')} · ${absoluteUrl('/data/health.csv')}`,
    `- Benchmark trials (CSV): ${absoluteUrl('/data/trials.csv')}`,
    `- Dataset page: ${absoluteUrl('/data/')}`,
    '');
  return lines.join('\n');
}

export function dataDiscoveryIndex() {
  const views = getIndexableSkillViews();
  const runs = getRuns();
  return {
    data: {
      license: DATASET.license,
      manifest: absoluteUrl('/data/index.json'),
      methodology: absoluteUrl(`/methodology/v${CURRENT_METHODOLOGY.version}/`),
      updatedAt: datasetModified(),
      citationRules: CITATION_RULES,
    },
    skills: views.map(view => ({
      id: view.skill.id,
      name: view.skill.displayName.en,
      author: view.skill.author.name,
      category: view.skill.category,
      commitSha: view.skill.source.commitSha,
      license: view.skill.license.spdx,
      health: { pass: view.counts.pass, warn: view.counts.warn, fail: view.counts.fail, flags: view.health?.flags ?? [] },
      benchmark: view.result ? { runId: view.result.run.runId, verdict: view.result.skill.pooled.comparison.verdict, passRateWith: view.result.skill.pooled.with.passRate, passRateWithout: view.result.skill.pooled.without.passRate } : null,
      keyFinding: keyFinding(view, 'en'),
      url: reportUrl(view),
      data: absoluteUrl(`/data/skills/${view.skill.id}.json`),
    })),
    runs: runs.map(run => ({ runId: run.runId, status: run.status, publishedAt: run.publishedAt, url: absoluteUrl(`/runs/${run.runId}/`), data: absoluteUrl(`/data/runs/${run.runId}.json`) })),
  };
}

export function renderAgentsMd(): string {
  const views = getIndexableSkillViews();
  const runs = getRuns().filter(run => run.status === 'published');
  return [
    '<!-- Generated by the same build as llms.txt and /data/. Do not edit by hand. -->',
    '',
    '# SkillFlux AGENTS.md',
    '',
    `> ${SITE.description}`,
    '',
    'Entry point for agents that read or cite SkillFlux. English lives at `/`, Chinese at `/zh/`; keep one language per answer.',
    '',
    `Data updated: ${datasetModified()} · ${views.length} skills health-checked · ${views.filter(view => view.result).length} benchmarked · ${runs.length} runs published`,
    '',
    '## What SkillFlux is — and is not',
    '',
    '- It **measures skills**: a static health check of every listed skill at a pinned commit, and controlled with/without benchmarks in Claude Code for selected skills. Results are open data under CC BY 4.0.',
    '- It **lists skill sources**: marketplaces, vendor collections and repositories. A listing is not a test result or an endorsement.',
    '- It does **not** distribute or install skills. For installation, follow the skill author\'s own instructions.',
    '',
    '## Reading order',
    '',
    `1. ${absoluteUrl('/ai/tasks/index.json')} — if you have a task: pick it, then read its file for candidate skills and sources with evidence.`,
    `2. ${absoluteUrl('/llms.txt')} — what is measured, every skill's headline result, and citation rules.`,
    `3. ${absoluteUrl('/data/claims.json')} — every published statement with its evidence URL; \`verified: false\` marks what a source says about itself.`,
    `4. ${absoluteUrl('/data/index.json')} — manifest of every data file with sha256; prefer the JSON/CSV over scraping HTML.`,
    `5. ${absoluteUrl('/skills/')}<id>.md and ${absoluteUrl('/resource/')}<slug>.md — compact Markdown of each report and source page (also linked from each HTML page as rel="alternate").`,
    `6. ${absoluteUrl(`/methodology/v${CURRENT_METHODOLOGY.version}/`)} — the exact method behind every number.`,
    '',
    '## Citation rules',
    '',
    ...CITATION_RULES.map(rule => `- ${rule}`),
    '',
    '## Routing',
    '',
    '- "Does skill X work / help?": open its report. If it has a benchmark, quote the key finding with n, interval, model, date and run id. If it has only a health check, say it has not been benchmarked.',
    '- "Which skill should I use for Y?": filter `/data/skills.json` by category; prefer benchmarked skills with a positive verdict, and say how many were compared.',
    '- "Is skill X safe?": quote the health check flags and their meaning; flags describe contents (for example bundled scripts) and are not verdicts.',
    '- "Where do I find skills?": use the directory (`/directory/`) and link the original source.',
    '- "Is source X (a marketplace, list or repository) any good?": read `/resource/<slug>.md`. If it has a SkillFlux sample, quote the counts with the audit date and commit; if not, say it was not sampled. Attribute any unverified statement to its source.',
    '- "X vs Y" or "alternatives to X": use `/compare/<a>-vs-<b>/` and `/alternatives/<slug>/`; their ordering method is stated on each page.',
    '',
    '## Endpoints',
    '',
    ...ENDPOINTS.map(endpoint => `- ${absoluteUrl(endpoint.path)}: ${endpoint.description}`),
    '',
    '## Boundaries',
    '',
    '- Results hold for the tested commit, host (Claude Code), model and tasks.',
    '- Pages and data are build-time snapshots; dates on each record bound freshness.',
    '- Corrections and disputes go through GitHub issues; published runs are never edited, only superseded.',
    '',
  ].join('\n');
}
