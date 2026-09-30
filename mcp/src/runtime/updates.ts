import type { Host, SkillVersionSummary } from '../shared.js';
import { compareVersions } from '../shared.js';
import { readFileSync } from 'node:fs';
import type { ProjectLock } from './model.js';

export const UPDATE_CACHE_MS = 24 * 60 * 60 * 1000;
export const RUNTIME_VERSION: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

export function releaseCompatibility(release: SkillVersionSummary, host: Host, lock?: ProjectLock): 'compatible' | 'incompatible' | 'unknown' {
  if (!Array.isArray(release.hosts) || !release.release?.minClientVersion) return 'unknown';
  if (!release.hosts.includes(host) && !release.hosts.includes('generic')) return 'incompatible';
  for (const dependency of release.dependencies ?? []) {
    const selected = lock?.skills[dependency.id];
    if (selected?.pinned && selected.version !== dependency.version) return 'incompatible';
    for (const current of Object.values(lock?.skills ?? {})) {
      if (!current.direct || current.id === release.id) continue;
      if (current.dependencies.some(item => item.id === dependency.id && item.version !== dependency.version)) return 'incompatible';
    }
  }
  return compareVersions(RUNTIME_VERSION, release.release.minClientVersion) < 0 ? 'incompatible' : 'compatible';
}

export function orderedReleases(items: SkillVersionSummary[]): SkillVersionSummary[] {
  return [...items].sort((a, b) => compareVersions(b.version, a.version));
}
