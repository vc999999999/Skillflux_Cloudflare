import { readFileSync } from 'node:fs';
import defaultSnapshot from '../../data/registry-publication.json';
import { bundleDigest, contentHash, canonical, sha256, safeRelativePath, verifyPayload, type Bundle, type PublicKeyInfo, type Signed, type SkillSummary } from '../../../mcp/src/shared';
import { latestSkills } from './publication-search';

export interface PublishedSkill { skill: SkillSummary; bundle: Bundle }
export interface PublicationPage {
  items: PublishedSkill[]; total: number; offset: number; limit: number;
  generatedAt: string; expiresAt: string; revision: string;
}
export interface PublicationSnapshot {
  schema: 'skillflux-publication/v1'; registry: string | null; fetchedAt: string | null;
  key: PublicKeyInfo | null; pages: Signed<PublicationPage>[];
  statusPages?: Signed<PublicationStatusPage>[];
}
export interface PublicationStatus {
  id: string; version: string; name: string; digest: string; status: string;
  qualification: 'qualified' | 'needs-testing' | 'revoked'; createdAt: string; reason?: string;
  release?: { notes: string; breaking: boolean; minClientVersion: string; maintainedAt: string; maintainedBy: string };
}
export interface PublicationStatusPage {
  items: PublicationStatus[]; total: number; offset: number; limit: number;
  generatedAt: string; expiresAt: string; revision: string;
}
export interface Publication {
  snapshot: PublicationSnapshot; items: PublishedSkill[]; latest: PublishedSkill[]; statuses: PublicationStatus[];
}

export function validatePublication(value: unknown): Publication {
  const snapshot = value as PublicationSnapshot;
  if (!snapshot || snapshot.schema !== 'skillflux-publication/v1' || !Array.isArray(snapshot.pages)) throw new Error('Invalid SkillFlux publication snapshot');
  if (snapshot.registry === null && snapshot.key === null && snapshot.pages.length === 0 && snapshot.fetchedAt === null && !snapshot.statusPages?.length) return { snapshot, items: [], latest: [], statuses: [] };
  if (!snapshot.key || !snapshot.registry || !snapshot.fetchedAt || !Number.isFinite(Date.parse(snapshot.fetchedAt))) throw new Error('Publication is missing its registry, trusted key or fetch time');
  const origin = new URL(snapshot.registry);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname))) throw new Error('Publication registry must use HTTPS');
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('Publication registry must be a plain origin');
  const items: PublishedSkill[] = [];
  const identities = new Set<string>();
  let total: number | undefined, revision: string | undefined;
  for (const envelope of snapshot.pages) {
    const page = verifyPayload(envelope, snapshot.key);
    if (!Array.isArray(page.items) || page.offset !== items.length || !Number.isSafeInteger(page.total) || page.total < 0 || page.total > 10000 || !Number.isSafeInteger(page.limit) || page.limit < 1 || page.items.length > page.limit || typeof page.revision !== 'string' || !page.revision) throw new Error('Invalid publication pagination');
    if (total !== undefined && (total !== page.total || revision !== page.revision)) throw new Error('Registry changed during publication; sync again');
    total = page.total; revision = page.revision;
    for (const entry of page.items) {
      const identity = `${entry.skill?.id}@${entry.skill?.version}`;
      if (identities.has(identity)) throw new Error(`Duplicate publication version: ${identity}`);
      identities.add(identity);
      const { skill, bundle } = entry;
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill?.id) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(skill?.version)) throw new Error(`Invalid published identity: ${identity}`);
      if (skill.status !== 'approved' || (skill as SkillSummary & { qualification?: string }).qualification !== 'qualified'
        || !skill.quality?.automated?.passed || !skill.quality.review) throw new Error(`Unqualified content in public snapshot: ${identity}`);
      if (!bundle || bundle.manifest.id !== skill.id || bundle.manifest.version !== skill.version || bundleDigest(bundle) !== skill.digest) throw new Error(`Publication content does not match its signed digest: ${identity}`);
      const evidence = skill.quality.evaluation;
      if (!evidence?.evaluationId || evidence.contentHash !== contentHash(bundle) || !evidence.purposePassed || !evidence.boundaryPassed || !evidence.summary.trim() || !Number.isFinite(Date.parse(evidence.testedAt))
        || !skill.hosts.length || !skill.hosts.every(host => evidence.hosts.includes(host))) throw new Error(`Publication lacks matching usage-test evidence: ${identity}`);
      for (const field of ['name', 'description', 'category', 'tags', 'hosts', 'publisher', 'license', 'entry', 'permissions', 'dependencies', 'createdAt', 'release'] as const) {
        if (canonical(skill[field] ?? null) !== canonical(bundle.manifest[field] ?? null)) throw new Error(`Publication summary differs from bundle ${field}: ${identity}`);
      }
      if (Object.keys(bundle.files).length !== bundle.manifest.files.length || !bundle.files[skill.entry]) throw new Error(`Incomplete publication files: ${identity}`);
      for (const file of bundle.manifest.files) if (!safeRelativePath(file.path) || typeof bundle.files[file.path] !== 'string' || sha256(bundle.files[file.path]!) !== file.sha256 || Buffer.byteLength(bundle.files[file.path]!, 'utf8') !== file.size) throw new Error(`Publication file hash mismatch: ${identity}`);
      items.push(entry);
    }
  }
  if (total === undefined || total !== items.length) throw new Error('Incomplete publication snapshot');
  const statuses: PublicationStatus[] = [];
  let statusTotal: number | undefined;
  for (const envelope of snapshot.statusPages ?? []) {
    const page = verifyPayload(envelope, snapshot.key);
    if (page.revision !== revision || page.offset !== statuses.length || !Array.isArray(page.items)
      || !Number.isSafeInteger(page.total) || page.total < 0 || page.total > 10000
      || (statusTotal !== undefined && page.total !== statusTotal)) throw new Error('Inconsistent publication status pages');
    statusTotal = page.total;
    for (const item of page.items) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(item.version)
        || !['approved', 'revoked'].includes(item.status) || !['qualified', 'needs-testing', 'revoked'].includes(item.qualification)) throw new Error('Private or malformed version in public status index');
      if (statuses.some(previous => previous.id === item.id && previous.version === item.version)) throw new Error('Duplicate public version status');
      statuses.push(item);
    }
  }
  if (statusTotal !== undefined && statuses.length !== statusTotal) throw new Error('Incomplete publication statuses');
  if (snapshot.statusPages) {
    for (const item of items) if (!statuses.some(status => status.id === item.skill.id && status.version === item.skill.version && status.digest === item.skill.digest && status.status === 'approved' && status.qualification === 'qualified')) throw new Error('Published version is missing matching qualification status');
    for (const status of statuses) if (status.qualification === 'qualified' && !items.some(item => item.skill.id === status.id && item.skill.version === status.version && item.skill.digest === status.digest)) throw new Error('Qualified status is missing its published content');
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
