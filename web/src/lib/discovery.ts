import { absoluteUrl } from './content';
import { scenarios } from './scenarios';

export function discoveryIndex() {
  return {
    qualificationNote: 'Source listings and editorial articles are not test results. Listing means a source exists and is reachable; it does not mean every skill in it was tested.',
    freshness: 'Static build snapshot. External repositories can change after the page date; the original source is authoritative for live status.',
    scenarios: scenarios.map(scenario => ({ slug: scenario.slug, title: scenario.title, description: scenario.summary, updatedAt: scenario.updatedAt, url: absoluteUrl(`/scenarios/${scenario.slug}/`), chineseUrl: absoluteUrl(`/zh/scenarios/${scenario.slug}/`) })),
  };
}

export function renderDiscoveryText(_full = false): string {
  const index = discoveryIndex();
  const lines = ['', '## Reading boundaries', index.qualificationNote, index.freshness,
    'This static site offers discoverable HTML and machine-readable indexes. It does not guarantee search/AI inclusion, training use, ranking or model recommendations.',
    '', '## Scenarios & selection',
    ...index.scenarios.map(scenario => `- ${scenario.title.en}: ${scenario.description.en} ${scenario.url}`),
    '', `Listing policy: ${absoluteUrl('/quality/')}`, ''];
  return lines.join('\n');
}
