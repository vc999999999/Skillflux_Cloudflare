import { absoluteUrl } from './content';
import { getPublication, skillPath, type Publication } from './publication';
import { scenarios } from './scenarios';


export function discoveryIndex(publication: Publication = getPublication()) {
  return {
    qualificationNote: 'Source listings, complete candidate collection and editorial articles are not installation approvals. Curated releases require separate safety checks and human evaluation.',
    freshness: 'Static build snapshot, not live installation authority. The local SkillFlux runtime checks current eligibility and revocations before installation and loading; offline loads disclose unknown current status.',
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
    'Install @skillflux/mcp from npm, then run init in the target project to create the SkillFlux entry point and local MCP configuration. MCP installation requires explicit local init consent with --preauthorize-reviewed-text; without it, the user can install through the CLI.',
    'Explicitly invoke SkillFlux, then search the locally cached GitHub catalog, plan exact versions and dependencies, and install. Installation downloads and verifies every declared file in each planned release from a pinned GitHub commit, including supporting resources and licenses. npm supplies the local tools; GitHub supplies skill content.',
    'load re-verifies local packages and returns the selected entry, dependency instructions and requested resources in the current turn. The host AI uses these instructions to perform the task. SkillFlux does not execute the skill scripts itself.',
    'check-updates reports status without installing updates; ordinary cached results have a 24-hour lifetime. Users may explicitly enable follow-compatible through the local CLI or init. Subsequent load calls check for and apply reviewed, stable, compatible releases before returning content. Pins, local edits and breaking changes block automatic replacement. Manual MCP update still requires an approved exact-version plan.',
    'Automatic following updates GitHub skill content, not the npm client. It has no background scheduler or real-time push while the client is stopped. Offline loads disclose unknown current catalog status.',
    `Setup: ${absoluteUrl('/install/')}`, `Quality: ${absoluteUrl('/quality/')}`, '');
  return lines.join('\n');
}
