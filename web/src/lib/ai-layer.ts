// The agent-facing layer: a task index, a claims ledger and compact Markdown
// twins of skill and source pages. Agents arrive with a task, need statements
// they can cite with their evidence, and pay per token, so everything here is
// structured, attributed and short. Nothing is written that the HTML pages and
// /data/ do not also carry.
import { CHECKER_VERSION } from '@skillflux/bench/checks';
import { absoluteUrl, getIndexableSites, type Site } from './content';
import { getSiteCopy, translateCategory } from './i18n';
import { keyFinding, shortSha, type SkillView } from './skill-data';
import { getIndexableSkillViews } from './skills';
import { getSourceAudit, getSourceAudits } from './source-audits';
import { scorecard } from './source-audit-data';
import { alternativesFor, pct, rankSites, sampleScore } from './source-compare';
import { USE_CASES } from './use-cases';

// Skill categories map onto the use cases sources are tagged with.
const CATEGORY_TASK: Record<string, string> = {
  documents: 'writing', engineering: 'coding', design: 'design', mobile: 'mobile',
  productivity: 'planning', writing: 'writing', media: 'video',
};

export const AGENT_RULES = [
  'Cite a number with its subject, date and evidence URL; the commit or audit id on that page identifies the measurement.',
  'A health check or source sample reads files only. Do not present it as evidence that a skill works or helps.',
  'Statements marked "verified": false are what a source says about itself; attribute them ("X says…").',
  'A directory listing is not an endorsement. Install a skill by following its author\'s instructions at sourceUrl.',
];

export const skillPath = (view: SkillView) => `/skills/${view.skill.id}/`;
export const sourcePath = (site: Site) => `/resource/${site.resourceSlug}/`;
const sourceUrlOf = (view: SkillView) => `${view.skill.source.repo}/tree/${view.skill.source.commitSha}${view.skill.source.path ? `/${view.skill.source.path}` : ''}`;

function skillEntry(view: SkillView) {
  return {
    id: view.skill.id,
    name: view.skill.displayName.en,
    author: view.skill.author.name,
    summary: view.skill.summary.en,
    sourceUrl: sourceUrlOf(view),
    commitSha: view.skill.source.commitSha,
    license: view.skill.license.spdx ?? (view.skill.license.file ? 'see license file' : null),
    health: { checker: view.health?.checkerVersion ?? null, changedAt: view.health?.changedAt ?? null, pass: view.counts.pass, warn: view.counts.warn, fail: view.counts.fail, flags: view.health?.flags ?? [] },
    benchmark: view.result ? { runId: view.result.run.runId, verdict: view.result.skill.pooled.comparison.verdict } : null,
    finding: keyFinding(view, 'en'),
    report: absoluteUrl(skillPath(view)),
    markdown: absoluteUrl(`/skills/${view.skill.id}.md`),
    evidence: absoluteUrl(`/data/skills/${view.skill.id}.json`),
  };
}

function sourceEntry(site: Site) {
  const audit = getSourceAudit(site.slug);
  const score = sampleScore(audit);
  return {
    slug: site.slug,
    name: getSiteCopy(site, 'en').name,
    url: site.canonicalUrl,
    type: translateCategory(site.category, site.category, 'en'),
    purpose: site.editorial?.primaryCapability.en ?? null,
    bestFor: site.editorial?.bestFor.map(item => item.en) ?? [],
    limitations: site.editorial?.limitations.map(item => item.en) ?? [],
    sample: audit ? {
      auditedAt: audit.auditedAt, commitSha: audit.listing.commitSha, sampled: audit.summary.sampled, checked: audit.summary.checked,
      cleanShare: score, failingAnyCheck: audit.summary.failingAnyCheck, missingTrigger: audit.summary.missingTrigger, noLicense: audit.summary.noLicense,
      evidence: absoluteUrl(`/data/source-audits/${site.slug}.json`),
    } : null,
    page: absoluteUrl(sourcePath(site)),
    markdown: absoluteUrl(`/resource/${site.resourceSlug}.md`),
  };
}

export type TaskDoc = ReturnType<typeof taskDoc>;

function taskDoc(slug: string) {
  const label = USE_CASES[slug]!;
  const skills = getIndexableSkillViews().filter(view => CATEGORY_TASK[view.skill.category] === slug)
    .sort((a, b) => Number(Boolean(b.result)) - Number(Boolean(a.result)) || a.counts.fail - b.counts.fail || b.counts.pass - a.counts.pass || a.skill.id.localeCompare(b.skill.id));
  const sources = rankSites(getIndexableSites().filter(site => site.editorial?.useCases.includes(slug)));
  return {
    schema: 'skillflux-ai-task/v1',
    task: slug,
    label: label.en,
    url: absoluteUrl(`/ai/tasks/${slug}.json`),
    ordering: {
      skills: 'Benchmarked first, then fewer failing checks, then more passing checks. Health checks read files only.',
      sources: 'Sources with a SkillFlux sample first, by cleanShare (sampled entries with no failing check, a "when to use" description and a license); others by name.',
    },
    rules: AGENT_RULES,
    skills: skills.map(skillEntry),
    sources: sources.map(sourceEntry),
  };
}

export function aiTasks(): TaskDoc[] {
  return Object.keys(USE_CASES).map(taskDoc).filter(doc => doc.skills.length + doc.sources.length > 0);
}

export function aiTaskIndex() {
  return {
    schema: 'skillflux-ai-task-index/v1',
    description: 'Start here when you have a task. Each task file lists checked skills and skill sources for it, with evidence URLs and citation rules.',
    rules: AGENT_RULES,
    tasks: aiTasks().map(doc => ({ task: doc.task, label: doc.label, skills: doc.skills.length, sources: doc.sources.length, url: doc.url })),
  };
}

export type Claim = {
  id: string;
  subject: string;
  subjectUrl: string;
  statement: string;
  verified: boolean;
  method: 'static-health-check' | 'source-sample' | 'web-search';
  observedAt: string;
  evidenceUrl: string;
  commitSha?: string;
};

/** Every statement SkillFlux publishes about a skill or source, with its evidence. */
export function claimsLedger(): Claim[] {
  const claims: Claim[] = [];
  for (const view of getIndexableSkillViews()) {
    if (!view.health) continue;
    claims.push({
      id: `skill:${view.skill.id}:health`,
      subject: view.skill.displayName.en,
      subjectUrl: absoluteUrl(skillPath(view)),
      statement: `At commit ${shortSha(view.skill.source.commitSha)}, static health check ${view.health.checkerVersion} recorded ${view.counts.pass} pass, ${view.counts.warn} warn and ${view.counts.fail} fail${view.health.flags.length ? `; flags: ${view.health.flags.join(', ')}` : ''}.`,
      verified: true, method: 'static-health-check', observedAt: view.health.changedAt,
      evidenceUrl: absoluteUrl(`/data/skills/${view.skill.id}.json`), commitSha: view.skill.source.commitSha,
    });
  }
  const sites = new Map(getIndexableSites().map(site => [site.slug, site]));
  for (const audit of getSourceAudits()) {
    const site = sites.get(audit.siteSlug);
    if (!site) continue;
    const lines = scorecard(audit).map(line => `${line.count}/${line.of} ${line.en}`).join('; ');
    claims.push({
      id: `source:${site.slug}:sample`,
      subject: getSiteCopy(site, 'en').name,
      subjectUrl: absoluteUrl(sourcePath(site)),
      statement: `A seeded sample of ${audit.summary.sampled} from ${audit.listing.candidates} entries at commit ${shortSha(audit.listing.commitSha)} (checker ${audit.checkerVersion}): ${lines}.`,
      verified: true, method: 'source-sample', observedAt: audit.auditedAt,
      evidenceUrl: absoluteUrl(`/data/source-audits/${site.slug}.json`), commitSha: audit.listing.commitSha,
    });
  }
  for (const site of sites.values()) {
    for (const [index, claim] of (site.claims ?? []).entries()) {
      claims.push({
        id: `source:${site.slug}:claim-${index + 1}`,
        subject: getSiteCopy(site, 'en').name,
        subjectUrl: absoluteUrl(sourcePath(site)),
        statement: claim.en,
        verified: false, method: 'web-search', observedAt: claim.observedAt, evidenceUrl: claim.sourceUrl,
      });
    }
  }
  return claims;
}

const bullet = (items: string[]) => items.map(item => `- ${item}`);

export function skillMarkdown(view: SkillView): string {
  const entry = skillEntry(view);
  const failing = view.health?.checks.filter(check => check.status === 'fail' || check.status === 'warn') ?? [];
  return [
    `# ${entry.name}`,
    '',
    `> ${entry.summary}`,
    '',
    `- Author: ${entry.author}`,
    `- Source at the checked commit: ${entry.sourceUrl}`,
    `- License: ${entry.license ?? 'none found'}`,
    `- Category: ${view.category.label.en}`,
    '',
    '## Result',
    '',
    entry.finding,
    '',
    `- Health check (checker ${entry.health.checker ?? '—'}, result changed ${entry.health.changedAt ?? '—'}): ${entry.health.pass} pass, ${entry.health.warn} warn, ${entry.health.fail} fail`,
    `- Flags (descriptive, not verdicts): ${entry.health.flags.join(', ') || 'none'}`,
    `- Benchmark: ${entry.benchmark ? `run ${entry.benchmark.runId}, ${entry.benchmark.verdict}` : 'not benchmarked'}`,
    ...(failing.length ? ['', '## Checks that did not pass', '', ...bullet(failing.map(check => `${check.id} (${check.status}): ${check.detail}`))] : []),
    '',
    '## The author\'s description (quoted from SKILL.md)',
    '',
    `> ${view.skill.upstreamDescription.replace(/\n+/g, ' ')}`,
    '',
    '## Evidence and citation',
    '',
    `- Report: ${entry.report}`,
    `- Full record (JSON): ${entry.evidence}`,
    `- Method: ${absoluteUrl('/methodology/v1/')}`,
    ...bullet(AGENT_RULES),
    '',
  ].join('\n');
}

export function sourceMarkdown(site: Site): string {
  const entry = sourceEntry(site);
  const copy = getSiteCopy(site, 'en');
  const audit = getSourceAudit(site.slug);
  const alternatives = alternativesFor(site, 4);
  return [
    `# ${entry.name}`,
    '',
    `> ${site.editorial?.summary.en ?? copy.summary}`,
    '',
    `- URL: ${entry.url}`,
    `- Type: ${entry.type} · ${copy.type}`,
    `- Main purpose: ${entry.purpose ?? '—'}`,
    `- Use cases: ${(site.editorial?.useCases ?? []).map(item => USE_CASES[item]?.en ?? item).join(', ')}`,
    `- Language: ${site.language.join(', ')} · Pricing: ${site.pricing}`,
    '',
    '## Best for',
    '',
    ...bullet(entry.bestFor),
    '',
    '## Limitations',
    '',
    ...bullet(entry.limitations),
    '',
    '## SkillFlux sample check',
    '',
    ...(audit ? [
      `Audited ${audit.auditedAt} at commit ${audit.listing.commitSha} with checker ${audit.checkerVersion}; seeded sample of ${audit.summary.sampled} from ${audit.listing.candidates} entries. Clean share: ${entry.sample?.cleanShare === null || entry.sample?.cleanShare === undefined ? '—' : pct(entry.sample.cleanShare)}.`,
      '',
      ...bullet(scorecard(audit).map(line => `${line.count}/${line.of} ${line.en}`)),
      '',
      `Evidence: ${entry.sample!.evidence}`,
    ] : [/^https:\/\/github\.com\//.test(site.canonicalUrl) ? 'Not sampled yet.' : `Not sampled: this is a website, and SkillFlux samples only sources it can pin to a commit (checker ${CHECKER_VERSION}).`]),
    ...(site.claims?.length ? ['', '## Unverified statements (attribute them)', '', ...bullet(site.claims.map(claim => `${claim.en} (${claim.sourceUrl}, observed ${claim.observedAt})`))] : []),
    '',
    '## SkillFlux note',
    '',
    site.editorial?.skillFluxNote.en ?? '',
    '',
    '## Alternatives',
    '',
    ...bullet(alternatives.map(other => `${getSiteCopy(other, 'en').name}: ${other.editorial?.primaryCapability.en ?? ''} ${absoluteUrl(`/resource/${other.resourceSlug}.md`)}`)),
    '',
    `Page: ${entry.page}`,
    '',
    ...bullet(AGENT_RULES),
    '',
  ].join('\n');
}
