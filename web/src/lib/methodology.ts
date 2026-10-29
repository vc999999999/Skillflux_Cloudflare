// Published methodology versions. A version's text never changes after
// publication; a change in method is a new version, and results always link
// to the version they were produced under.
export interface MethodologyVersion { version: string; publishedAt: string; status: 'current' | 'superseded'; changes: { en: string; zh: string } }

export const METHODOLOGY_VERSIONS: MethodologyVersion[] = [
  { version: '1', publishedAt: '2026-10-29', status: 'current', changes: { en: 'First published version.', zh: '首个发布版本。' } },
];

export const CURRENT_METHODOLOGY = METHODOLOGY_VERSIONS.find(item => item.status === 'current')!;
