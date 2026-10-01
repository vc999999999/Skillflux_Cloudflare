import { readFileSync } from 'node:fs';
import defaultSnapshot from '../../data/registry-publication.json';
import { canonical, sha256, safeRelativePath, type Bundle, type SkillSummary } from '../../../mcp/src/shared';
import { latestSkills } from './publication-search';

export interface PublishedSkill { skill: SkillSummary; bundle: Bundle }
export type PublishedManifest = Bundle['manifest'] & { files: Array<{ path: string; sha256: string; size: number }> };
export interface PublicationStatusEntry {
  id: string; version: string; name: string; digest: string; status: string;
  qualification: 'qualified' | 'needs-testing' | 'revoked'; createdAt: string; reason?: string;
}
export interface PublicationSnapshot {
  schema: 'skillflux-publication/v2';
  repo: string | null;
  commitSha: string | null;
  fetchedAt: string | null;
  items: PublishedSkill[];
  statuses?: PublicationStatusEntry[];
}
export interface PublicationStatus {
  id: string; version: string; name: string; digest: string; status: string;
  qualification: 'qualified' | 'needs-testing' | 'revoked'; createdAt: string; reason?: string;
  release?: { notes: string; breaking: boolean; minClientVersion: string; maintainedAt: string; maintainedBy: string };
}
export interface Publication {
  snapshot: PublicationSnapshot; items: PublishedSkill[]; latest: PublishedSkill[]; statuses: PublicationStatus[];
}

/**
 * Validate a publication snapshot synced from the GitHub catalog repository.
 * Integrity here comes from the synced commit SHA plus per-file sha256 checks —
 * there is no registry signature anymore. All qualification and evidence
 * binding checks apply to every published version.
 */
/** Matches the catalog builder's versionContentHash: sha256(canonical({manifest, files})). */
function catalogContentHash(bundle: { manifest: PublishedManifest; files: Record<string, string> }): string {
  const { files: _fileRecords, ...manifest } = bundle.manifest;
  return sha256(canonical({ manifest, files: bundle.files }));
}

export function validatePublication(value: unknown): Publication {
  const snapshot = value as PublicationSnapshot;
  if (!snapshot || snapshot.schema !== 'skillflux-publication/v2' || !Array.isArray(snapshot.items)) throw new Error('Invalid SkillFlux publication snapshot');
  if (snapshot.repo === null && snapshot.commitSha === null && snapshot.items.length === 0 && snapshot.fetchedAt === null && !snapshot.statuses?.length) {
    return { snapshot, items: [], latest: [], statuses: [] };
  }
  if (!snapshot.repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(snapshot.repo) || !/^[0-9a-f]{40}$/.test(snapshot.commitSha ?? '') || !snapshot.fetchedAt || !Number.isFinite(Date.parse(snapshot.fetchedAt))) {
    throw new Error('Publication is missing its catalog repository, commit SHA or fetch time');
  }
  const items: PublishedSkill[] = [];
  const identities = new Set<string>();
  for (const entry of snapshot.items) {
    const identity = `${entry.skill?.id}@${entry.skill?.version}`;
    if (identities.has(identity)) throw new Error(`Duplicate publication version: ${identity}`);
    identities.add(identity);
    const { skill, bundle } = entry as { skill: SkillSummary; bundle: { manifest: PublishedManifest; files: Record<string, string> } };
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill?.id) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(skill?.version)) throw new Error(`Invalid published identity: ${identity}`);
    if (skill.status !== 'approved' || skill.qualification !== 'qualified'
      || !skill.quality?.automated?.passed || !skill.quality.review) throw new Error(`Unqualified content in public snapshot: ${identity}`);
    if (!bundle || bundle.manifest.id !== skill.id || bundle.manifest.version !== skill.version || catalogContentHash(bundle) !== skill.digest) throw new Error(`Publication content does not match its catalog digest: ${identity}`);
    const evidence = skill.quality.evaluation;
    if (!evidence?.evaluationId || evidence.contentHash !== catalogContentHash(bundle) || !evidence.purposePassed || !evidence.boundaryPassed || !evidence.summary.trim() || !Number.isFinite(Date.parse(evidence.testedAt))
      || !skill.hosts.length || !skill.hosts.every(host => evidence.hosts.includes(host))) throw new Error(`Publication lacks matching usage-test evidence: ${identity}`);
    for (const field of ['id', 'version', 'name', 'description', 'category', 'tags', 'hosts', 'publisher', 'license', 'entry', 'permissions', 'dependencies', 'createdAt', 'release'] as const) {
      if (canonical(skill[field] ?? null) !== canonical(bundle.manifest[field as keyof typeof bundle.manifest] ?? null)) throw new Error(`Publication summary differs from manifest ${field}: ${identity}`);
    }
    if (Object.keys(bundle.files).length !== bundle.manifest.files.length || !bundle.files[skill.entry]) throw new Error(`Incomplete publication files: ${identity}`);
    for (const file of bundle.manifest.files) if (!safeRelativePath(file.path) || typeof bundle.files[file.path] !== 'string' || sha256(bundle.files[file.path]!) !== file.sha256 || Buffer.byteLength(bundle.files[file.path]!, 'utf8') !== file.size) throw new Error(`Publication file hash mismatch: ${identity}`);
    items.push(entry);
  }
  // Prefer the synced status track (which includes revoked and needs-testing
  // versions); fall back to deriving it from the published items.
  const statuses: PublicationStatus[] = snapshot.statuses?.length
    ? snapshot.statuses
    : items.map(item => ({
        id: item.skill.id,
        version: item.skill.version,
        name: item.skill.name,
        digest: item.skill.digest,
        status: item.skill.status,
        qualification: 'qualified' as const,
        createdAt: item.skill.createdAt,
        ...(item.skill.release ? { release: item.skill.release } : {}),
      }));
  if (snapshot.statuses?.length) {
    for (const status of snapshot.statuses) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(status.id) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(status.version)
        || !['approved', 'revoked', 'needs-testing'].includes(status.status) || !['qualified', 'needs-testing', 'revoked'].includes(status.qualification)) {
        throw new Error('Malformed version in public status index');
      }
      if (status.qualification === 'qualified' && !items.some(item => item.skill.id === status.id && item.skill.version === status.version && item.skill.digest === status.digest)) {
        throw new Error('Qualified status is missing its published content');
      }
    }
  }
  const latestIds = new Set(latestSkills(items.map(item => item.skill)).map(item => `${item.id}@${item.version}`));
  return { snapshot, items, latest: items.filter(item => latestIds.has(`${item.skill.id}@${item.skill.version}`)), statuses };
}

export function getPublication(): Publication {
  const path = process.env.SKILLFLUX_PUBLICATION_PATH;
  return validatePublication(path ? JSON.parse(readFileSync(path, 'utf8')) : defaultSnapshot);
}

export function skillPath(id: string, version?: string): string {
  return `/skills/${encodeURIComponent(id)}/${version ? `versions/${encodeURIComponent(version)}/` : ''}`;
}
