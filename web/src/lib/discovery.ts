import { absoluteUrl } from './content';
import { getPublication, skillPath, type Publication } from './publication';
import { scenarios } from './scenarios';


export function discoveryIndex(publication: Publication = getPublication()) {
  return {
    qualificationNote: 'Source listings and editorial articles are not usage-test approvals. Curated releases require separate safety checks and human evaluation.',
    freshness: 'Static build snapshot, not live installation authority. npm/MCP verifies current eligibility and revocations before installation and loading.',
    curated: {
      repo: publication.snapshot.repo, snapshotAt: publication.snapshot.fetchedAt,
      skills: publication.latest.map(({ skill }) => ({ ...skill, url: absoluteUrl(skillPath(skill.id)), versionUrl: absoluteUrl(skillPath(skill.id, skill.version)) })),
      versions: publication.statuses.map(status => ({ ...status, url: absoluteUrl(skillPath(status.id, status.version)) })),
    },
    scenarios: scenarios.map(scenario => ({ slug: scenario.slug, title: scenario.title, description: scenario.summary, updatedAt: scenario.updatedAt, url: absoluteUrl(`/scenarios/${scenario.slug}/`), englishUrl: absoluteUrl(`/en/scenarios/${scenario.slug}/`) })),
  };
}

export function renderDiscoveryText(full = false, publication: Publication = getPublication()): string {
  const index = discoveryIndex(publication);
  const lines = ['', '## Reading boundaries', index.qualificationNote, index.freshness,
    'This static site offers discoverable HTML and machine-readable indexes. It does not guarantee search/AI inclusion, training use, ranking or model recommendations.',
    '', '## 场景与选型 / Scenarios & selection',
    ...index.scenarios.map(scenario => `- ${scenario.title.zh} / ${scenario.title.en}: ${scenario.description.zh} ${scenario.url}`),
    '', '## 精品 Skill / Curated releases', `Snapshot: ${index.curated.snapshotAt ?? 'Not synchronized'}`,
    `Catalog repository: ${index.curated.repo ?? 'Not configured'}`,
    ...(index.curated.skills.length ? [] : ['No qualified releases in this static snapshot. Development samples are not published as human-tested skills.']),
  ];
  for (const skill of index.curated.skills) {
    lines.push(`### ${skill.name} (${skill.id}@${skill.version})`, skill.description, `URL: ${skill.url}`, `Exact release: ${skill.versionUrl}`, `Hosts: ${skill.hosts.join(', ')}`, `Maintainer: ${skill.release?.maintainedBy ?? skill.publisher}`, `License: ${skill.license}`, `Digest: ${skill.digest}`, `Tested: ${skill.quality.evaluation?.testedAt}`, `Public test summary: ${skill.quality.evaluation?.summary}`, '');
    if (full) {
      lines.push(`Release notes: ${skill.release?.notes ?? 'Not recorded for this historical release'}`, `Breaking change: ${skill.release?.breaking ?? 'Not recorded'}`, `Minimum client: ${skill.release?.minClientVersion ?? 'Not recorded'}`, `Dependencies: ${skill.dependencies.map(item => `${item.id}@${item.version}`).join(', ') || 'None'}`, '');
    }
  }
  lines.push('## Public release states', ...index.curated.versions.map(version => `- ${version.id}@${version.version}: ${version.qualification}${version.reason ? ` — ${version.reason}` : ''}; ${version.url}`), '', '## Local project workflow',
    'Install the SkillFlux npm entry and local MCP server using the setup guide. Explicitly invoke SkillFlux to search a locally cached catalog index; authorize an exact-version installation plan before files are downloaded at a pinned catalog commit.',
    'check-updates is read-only. Normal update notices are cached for 24 hours; revocation checks have a separate freshness policy. A pinned version is not silently upgraded. Offline or stopped clients cannot receive real-time push notifications.',
    `Setup: ${absoluteUrl('/install/')}`, `Quality: ${absoluteUrl('/quality/')}`, '');
  return lines.join('\n');
}
