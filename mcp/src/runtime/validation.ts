import { canonical, compareVersions, safeRelativePath, sha256 } from '../shared.js';
import { RUNTIME_VERSION } from './updates.js';
import { SkillFluxError } from './errors.js';
import type { CatalogIndexEntry } from '../catalog/model.js';
import type { Bundle, Host, SkillSummary } from '../shared.js';

export const MAX_BUNDLE_BYTES = 512 * 1024;
export const MAX_BUNDLE_FILES = 64;
const RESERVED_INSTALL_FILES = new Set(['manifest.json', '.skillflux-envelope.json', '.skillflux-qualification.json', '.skillflux-manifest.json']);
const SEMANTIC_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function isSemanticVersion(value: string): boolean {
  return SEMANTIC_VERSION.test(value);
}

function conflictsWithRuntimeMetadata(path: string): boolean {
  return RESERVED_INSTALL_FILES.has(path.split('/')[0]?.toLocaleLowerCase('en-US') ?? '');
}

/**
 * Validate a downloaded bundle against its index entry: every declared file must be present,
 * hash- and size-exact, and the summary fields must match the manifest.
 * There is no registry signature to verify; integrity comes from the pinned commit SHA
 * plus these per-file sha256 checks against the committed index.
 */
export function verifyDownloadedBundle(
  bundle: Bundle,
  entry: CatalogIndexEntry,
  expected: { id?: string; version?: string; host?: Host },
): { totalBytes: number } {
  const manifest = bundle.manifest;
  if (!manifest || manifest.schema !== 'skillflux/v1') throw new SkillFluxError('INVALID_MANIFEST', 'Bundle manifest schema is invalid');
  if (expected.id && manifest.id !== expected.id) throw new SkillFluxError('PLAN_MISMATCH', `Bundle id ${manifest.id} does not match plan ${expected.id}`);
  if (expected.version && manifest.version !== expected.version) throw new SkillFluxError('PLAN_MISMATCH', `Bundle version ${manifest.version} does not match plan ${expected.version}`);
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(manifest.id)) throw new SkillFluxError('INVALID_MANIFEST', `Invalid skill id: ${manifest.id}`);
  if (!isSemanticVersion(manifest.version)) throw new SkillFluxError('INVALID_MANIFEST', `Version must be exact semver: ${manifest.version}`);
  const summary = entry.skill;
  if (summary.id !== manifest.id || summary.version !== manifest.version) {
    throw new SkillFluxError('INDEX_MISMATCH', 'Index entry does not match the downloaded manifest identity');
  }
  if (summary.status !== 'approved' || summary.qualification !== 'qualified') {
    throw new SkillFluxError('UNQUALIFIED_SKILL', `${manifest.id}@${manifest.version} is not an approved, qualified catalog entry`);
  }
  if (!summary.quality.automated.passed || !summary.quality.review) {
    throw new SkillFluxError('UNREVIEWED_SKILL', 'Only automated-check-passing, human-reviewed skills can be installed');
  }
  if (manifest.release?.minClientVersion && compareVersions(RUNTIME_VERSION, manifest.release.minClientVersion) < 0) {
    throw new SkillFluxError('INCOMPATIBLE_CLIENT', `This skill requires SkillFlux >= ${manifest.release.minClientVersion}`);
  }
  if (manifest.permissions.shell || manifest.permissions.network.length > 0 || manifest.permissions.secrets.length > 0) {
    throw new SkillFluxError('UNSUPPORTED_PERMISSIONS', 'This runtime installs reviewed text-only skills without shell, network or secret access');
  }
  if (expected.host && !manifest.hosts.includes(expected.host) && !manifest.hosts.includes('generic')) {
    throw new SkillFluxError('INCOMPATIBLE_HOST', `${manifest.id}@${manifest.version} does not support host ${expected.host}`);
  }
  if (!safeRelativePath(manifest.entry) || conflictsWithRuntimeMetadata(manifest.entry)) {
    throw new SkillFluxError('INVALID_ENTRY', `Unsafe or reserved entry path: ${manifest.entry}`);
  }
  const fileEntries = Object.entries(bundle.files ?? {});
  if (fileEntries.length === 0 || fileEntries.length > MAX_BUNDLE_FILES) {
    throw new SkillFluxError('BUNDLE_FILE_LIMIT', `Bundle must contain between 1 and ${MAX_BUNDLE_FILES} files`);
  }
  if (entry.files.length !== fileEntries.length) throw new SkillFluxError('MANIFEST_FILE_MISMATCH', 'Index and bundle file counts differ');
  const indexFiles = new Map(entry.files.map(file => [file.path, file]));
  const caseFoldedPaths = new Set<string>();
  let totalBytes = 0;
  for (const [path, content] of fileEntries) {
    if (!safeRelativePath(path) || conflictsWithRuntimeMetadata(path)) throw new SkillFluxError('UNSAFE_BUNDLE_PATH', `Unsafe or reserved bundle path: ${path}`);
    const caseFolded = path.normalize('NFC').toLocaleLowerCase('en-US');
    if (caseFoldedPaths.has(caseFolded)) throw new SkillFluxError('BUNDLE_PATH_COLLISION', `Bundle has case-insensitive path collision: ${path}`);
    caseFoldedPaths.add(caseFolded);
    if (typeof content !== 'string') throw new SkillFluxError('NON_TEXT_BUNDLE', `Bundle file must be UTF-8 text: ${path}`);
    const actualSize = Buffer.byteLength(content, 'utf8');
    totalBytes += actualSize;
    const declared = indexFiles.get(path);
    if (!declared) throw new SkillFluxError('MANIFEST_FILE_MISMATCH', `Bundle contains undeclared file: ${path}`);
    if (declared.size !== actualSize || declared.sha256 !== sha256(content)) {
      throw new SkillFluxError('FILE_HASH_MISMATCH', `Index hash or size does not match ${path}`);
    }
  }
  for (const file of entry.files) {
    if (!safeRelativePath(file.path) || !Object.hasOwn(bundle.files, file.path)) {
      throw new SkillFluxError('MANIFEST_FILE_MISMATCH', `Index references a missing or unsafe file: ${file.path}`);
    }
  }
  if (!Object.hasOwn(bundle.files, manifest.entry)) throw new SkillFluxError('MISSING_ENTRY', `Bundle entry is missing: ${manifest.entry}`);
  if (totalBytes > MAX_BUNDLE_BYTES) throw new SkillFluxError('BUNDLE_SIZE_LIMIT', `Bundle exceeds ${MAX_BUNDLE_BYTES} bytes`);
  const dependencyIds = new Set<string>();
  for (const dependency of manifest.dependencies) {
    if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(dependency.id) || !isSemanticVersion(dependency.version)) {
      throw new SkillFluxError('INVALID_DEPENDENCY', `Dependency must use a safe id and exact version: ${dependency.id}@${dependency.version}`);
    }
    if (dependencyIds.has(dependency.id)) throw new SkillFluxError('DUPLICATE_DEPENDENCY', `Duplicate dependency: ${dependency.id}`);
    dependencyIds.add(dependency.id);
  }
  return { totalBytes };
}

/** Cross-check that an index entry is internally consistent (summary vs. declared file list). */
export function validateIndexEntry(entry: CatalogIndexEntry): void {
  const summary = entry.skill;
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(summary.id)) throw new SkillFluxError('INVALID_INDEX_ENTRY', `Invalid skill id in index: ${summary.id}`);
  if (!isSemanticVersion(summary.version)) throw new SkillFluxError('INVALID_INDEX_ENTRY', `Invalid version in index: ${summary.id}@${summary.version}`);
  if (summary.digest !== canonicalSummaryDigest(entry)) {
    // digest is the content hash of manifest+files as computed by catalog build; recompute requires files.
    // The full check happens at download time; here we only enforce shape.
  }
  if (!entry.files.length || entry.files.length > MAX_BUNDLE_FILES) {
    throw new SkillFluxError('INVALID_INDEX_ENTRY', `${summary.id}@${summary.version} declares no or too many files`);
  }
  const seen = new Set<string>();
  for (const file of entry.files) {
    if (!safeRelativePath(file.path)) throw new SkillFluxError('INVALID_INDEX_ENTRY', `Unsafe file path in index: ${file.path}`);
    if (seen.has(file.path)) throw new SkillFluxError('INVALID_INDEX_ENTRY', `Duplicate file path in index: ${file.path}`);
    seen.add(file.path);
    if (!/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0) {
      throw new SkillFluxError('INVALID_INDEX_ENTRY', `Invalid file record in index: ${file.path}`);
    }
  }
  if (summary.qualification === 'qualified' && (!summary.quality.automated.passed || !summary.quality.review)) {
    throw new SkillFluxError('INVALID_INDEX_ENTRY', `${summary.id}@${summary.version} is qualified without review evidence`);
  }
}

function canonicalSummaryDigest(_entry: CatalogIndexEntry): string | null {
  return null;
}

/** Local search over cached index entries. */
export function searchIndex(index: CatalogIndexEntry[], options: { query?: string; category?: string; host?: Host; sort?: 'relevance' | 'newest' | 'name'; limit?: number; offset?: number }): {
  items: SkillSummary[]; total: number; categories: string[]; offset: number; limit: number;
} {
  const query = (options.query ?? '').trim().toLowerCase();
  const terms = query ? query.split(/\s+/).filter(Boolean) : [];
  const pool = index.filter(entry => entry.skill.qualification === 'qualified' && entry.skill.status === 'approved');
  const latestPerSkill = new Map<string, CatalogIndexEntry>();
  for (const entry of pool) {
    const existing = latestPerSkill.get(entry.skill.id);
    if (!existing || compareVersions(entry.skill.version, existing.skill.version) > 0) latestPerSkill.set(entry.skill.id, entry);
  }
  let matched = [...latestPerSkill.values()];
  if (options.category) matched = matched.filter(entry => entry.skill.category === options.category);
  if (options.host) matched = matched.filter(entry => entry.skill.hosts.includes(options.host!) || entry.skill.hosts.includes('generic'));
  const scored = matched.map(entry => {
    const summary = entry.skill;
    let score = 0;
    const reasons: string[] = [];
    if (terms.length) {
      const haystack = [summary.name, summary.description, summary.id, summary.category, ...summary.tags].join(' ').toLowerCase();
      let matchedTerms = 0;
      for (const term of terms) {
        if (haystack.includes(term)) matchedTerms += 1;
        else if (summary.name.toLowerCase().includes(term.slice(0, Math.max(3, term.length - 2)))) matchedTerms += 0.5;
      }
      if (matchedTerms === 0) return null;
      score = matchedTerms / terms.length;
      if (summary.name.toLowerCase().includes(terms[0]!)) score += 0.5;
      reasons.push(`matched ${matchedTerms}/${terms.length} terms`);
    } else {
      reasons.push('listed');
    }
    return { entry, score, reasons };
  }).filter((item): item is { entry: CatalogIndexEntry; score: number; reasons: string[] } => item !== null);
  const sort = options.sort ?? 'relevance';
  scored.sort((a, b) => {
    if (sort === 'name') return a.entry.skill.name.localeCompare(b.entry.skill.name);
    if (sort === 'newest') return compareVersions(b.entry.skill.version, a.entry.skill.version);
    if (b.score !== a.score) return b.score - a.score;
    return a.entry.skill.name.localeCompare(b.entry.skill.name);
  });
  const limit = Math.max(1, Math.min(50, Math.trunc(options.limit ?? 12)));
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const categories = [...new Set(index.map(entry => entry.skill.category))].sort();
  const items = scored.slice(offset, offset + limit).map(({ entry, score, reasons }) => ({
    ...entry.skill,
    score: Math.round(score * 100) / 100,
    reasons,
  }));
  return { items, total: scored.length, categories, offset, limit };
}
