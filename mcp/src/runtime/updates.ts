import type { Host, SkillVersionSummary } from '../shared.js';
import { compareVersions } from '../shared.js';
import { readFileSync } from 'node:fs';
import type { ProjectLock, UpdatePolicyMode } from './model.js';
import { SkillFluxError } from './errors.js';

export const UPDATE_CACHE_MS = 24 * 60 * 60 * 1000;
export const RUNTIME_VERSION: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

export function parseUpdatePolicy(value: unknown): UpdatePolicyMode {
  if (value === undefined || value === 'manual') return 'manual';
  if (value === 'follow-compatible') return value;
  throw new SkillFluxError('INVALID_UPDATE_POLICY', 'Update policy must be manual or follow-compatible');
}

/** Stable versions only; 0.x releases follow patches within the same minor. */
export function followsCompatibleLine(from: string, to: string): boolean {
  const core = (value: string) => value.split('+')[0];
  if (core(from).includes('-') || core(to).includes('-')) return false;
  const previous = core(from).split('.');
  const next = core(to).split('.');
  return previous[0] === next[0] && (previous[0] !== '0' || previous[1] === next[1]);
}

export function releaseCompatibility(release: SkillVersionSummary, host: Host, lock?: ProjectLock): 'compatible' | 'incompatible' | 'unknown' {
  if (!Array.isArray(release.hosts)) return 'unknown';
  if (!release.hosts.includes(host) && !release.hosts.includes('generic')) return 'incompatible';
  for (const dependency of release.dependencies ?? []) {
    const selected = lock?.skills[dependency.id];
    if (selected?.pinned && selected.version !== dependency.version) return 'incompatible';
    for (const current of Object.values(lock?.skills ?? {})) {
      if (!current.direct || current.id === release.id) continue;
      if (current.dependencies.some(item => item.id === dependency.id && item.version !== dependency.version)) return 'incompatible';
    }
  }
  // A release without an explicit minimum client version is treated as compatible;
  // the check only rejects releases that demand a newer client.
  if (release.release?.minClientVersion && compareVersions(RUNTIME_VERSION, release.release.minClientVersion) < 0) return 'incompatible';
  return 'compatible';
}

export function orderedReleases(items: SkillVersionSummary[]): SkillVersionSummary[] {
  return [...items].sort((a, b) => compareVersions(b.version, a.version));
}
