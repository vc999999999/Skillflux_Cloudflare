import { readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { canonical, sha256, safeRelativePath } from '../shared.js';
import { SkillFluxError } from '../runtime/errors.js';
import { catalogManifestSchema, reviewSidecarSchema } from './schemas.js';
import { scanFiles, scanPermissions } from './scan.js';
import {
  CATALOG_INDEX_FILE,
  CATALOG_INDEX_SCHEMA,
  CATALOG_MANIFEST_FILE,
  CATALOG_REVIEW_FILE,
  type CatalogIndex,
  type CatalogIndexEntry,
  type CatalogManifest,
  type CatalogQualification,
  type ReviewSidecar,
  type SkillVersionDirectory,
} from './model.js';

const SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const CATEGORY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Content hash of the review target: manifest (declarative fields only) + content files, excluding assessment evidence. */
export function versionContentHash(manifest: CatalogManifest, files: Record<string, string>): string {
  return sha256(canonical({ manifest, files }));
}

export async function readVersionDirectory(directory: string): Promise<SkillVersionDirectory> {
  const manifestPath = join(directory, CATALOG_MANIFEST_FILE);
  const reviewPath = join(directory, CATALOG_REVIEW_FILE);
  const manifestJson = JSON.parse(await readFile(manifestPath, 'utf8'));
  const reviewJson = JSON.parse(await readFile(reviewPath, 'utf8'));
  const manifest = catalogManifestSchema.parse(manifestJson) as CatalogManifest;
  const review = reviewSidecarSchema.parse(reviewJson) as ReviewSidecar;

  const files: Record<string, string> = {};
  const walk = async (relativeDir: string): Promise<void> => {
    for (const entry of await readdir(join(directory, relativeDir), { withFileTypes: true })) {
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(relative);
        continue;
      }
      if (!entry.isFile()) throw new SkillFluxError('UNSAFE_CATALOG_PATH', `Non-regular file in ${directory}: ${relative}`);
      if (relative === CATALOG_MANIFEST_FILE || relative === CATALOG_REVIEW_FILE || relative === CATALOG_INDEX_FILE) continue;
      if (!safeRelativePath(relative)) throw new SkillFluxError('UNSAFE_CATALOG_PATH', `Unsafe file name in ${directory}: ${relative}`);
      files[relative] = await readFile(join(directory, relative), 'utf8');
    }
  };
  await walk('');
  if (!Object.hasOwn(files, manifest.entry)) {
    throw new SkillFluxError('MISSING_ENTRY', `${manifest.id}@${manifest.version}: entry file ${manifest.entry} is missing from ${directory}`);
  }
  const computed = versionContentHash(manifest, files);
  if (review.evaluation.contentHash !== computed) {
    throw new SkillFluxError('REVIEW_BINDING_MISMATCH', `${manifest.id}@${manifest.version}: skillflux.review.json evaluation contentHash does not match the version directory content. Rerun 'skillflux catalog build' after content changes.`);
  }
  if (manifest.id !== directoryBasename(join(directory, '..')) || manifest.version !== directoryBasename(directory)) {
    throw new SkillFluxError('DIRECTORY_MISMATCH', `${manifest.id}@${manifest.version} must live at skills/<category>/${manifest.id}/${manifest.version}`);
  }
  return { skillId: manifest.id, version: manifest.version, directory, manifest, review, files };
}

function directoryBasename(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? '';
}

export interface BuildResult {
  index: CatalogIndex;
  warnings: string[];
  output: string;
}

export async function buildCatalogIndex(catalogRoot: string, options: { output?: string } = {}): Promise<BuildResult> {
  const skillsRoot = resolve(catalogRoot, 'skills');
  const rootInfo = await stat(skillsRoot).catch(() => null);
  if (!rootInfo?.isDirectory()) throw new SkillFluxError('CATALOG_NOT_FOUND', `No skills/ directory under ${catalogRoot}`);
  const warnings: string[] = [];
  const entries: CatalogIndexEntry[] = [];

  // Layout: skills/<category>/<id>/<version>/ — the category directory must match
  // the manifest's declared category, grouping the catalog by capability area.
  const categories = (await readdir(skillsRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
  if (!categories.length) throw new SkillFluxError('CATALOG_EMPTY', `No category directories under ${skillsRoot}`);
  for (const category of categories) {
    if (!CATEGORY_PATTERN.test(category)) throw new SkillFluxError('INVALID_CATEGORY', `Category directory must be kebab-case: ${category}`);
    const categoryRoot = join(skillsRoot, category);
    for (const skillId of (await readdir(categoryRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)) {
      if (!SKILL_ID_PATTERN.test(skillId)) throw new SkillFluxError('INVALID_SKILL_ID', `Skill directory must be kebab-case: ${category}/${skillId}`);
      const versionsRoot = join(categoryRoot, skillId);
      const versions = (await readdir(versionsRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name);
      for (const version of versions) {
        if (!VERSION_PATTERN.test(version)) throw new SkillFluxError('INVALID_VERSION', `Version directory must be semver: ${category}/${skillId}/${version}`);
        const loaded = await readVersionDirectory(join(versionsRoot, version));
        if (loaded.manifest.category !== category) {
          throw new SkillFluxError('CATEGORY_MISMATCH', `${skillId}@${version} declares category "${loaded.manifest.category}" but lives under skills/${category}/`);
        }
      const scan = scanFiles(loaded.files);
      const permissionFailures = scanPermissions(loaded.manifest.permissions);
      scan.failures.push(...permissionFailures);
      if (permissionFailures.length) scan.quality.automated.checks.push('declarative-permissions-only');
      if (!scan.quality.automated.passed || scan.failures.length) {
        scan.quality.automated.passed = false;
        throw new SkillFluxError('AUTOMATED_SCAN_FAILED', `${skillId}@${version} failed automated checks: ${scan.failures.join('; ')}`);
      }
      const qualification = deriveQualification(loaded, scan.quality.automated.passed);
      entries.push({
        skill: {
          id: loaded.manifest.id,
          version: loaded.manifest.version,
          name: loaded.manifest.name,
          description: loaded.manifest.description,
          category: loaded.manifest.category,
          tags: loaded.manifest.tags,
          hosts: loaded.manifest.hosts,
          publisher: loaded.manifest.publisher,
          license: loaded.manifest.license,
          status: loaded.review.status,
          digest: versionContentHash(loaded.manifest, loaded.files),
          size: scan.totalBytes,
          entry: loaded.manifest.entry,
          permissions: loaded.manifest.permissions,
          dependencies: loaded.manifest.dependencies,
          createdAt: loaded.manifest.createdAt,
          ...(loaded.manifest.release ? { release: loaded.manifest.release } : {}),
          qualification,
          quality: {
            automated: scan.quality.automated,
            review: { reviewer: loaded.review.reviewer, reviewedAt: loaded.review.reviewedAt, notes: loaded.review.notes },
            evaluation: publicEvaluation(loaded),
          },
        },
        files: scan.files,
      });
      if (qualification !== 'qualified') {
        warnings.push(`${skillId}@${version} qualification is ${qualification}`);
      }
      }
    }
  }

  entries.sort((a, b) => a.skill.id.localeCompare(b.skill.id) || (a.skill.version < b.skill.version ? 1 : -1));
  validateDependencies(entries);
  const index: CatalogIndex = { schema: CATALOG_INDEX_SCHEMA, generatedAt: new Date().toISOString(), skills: entries };
  const output = resolve(options.output ?? catalogRoot, CATALOG_INDEX_FILE);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(index, null, 2)}\n`);
  return { index, warnings, output };
}

function publicEvaluation(loaded: SkillVersionDirectory): CatalogIndexEntry['skill']['quality']['evaluation'] {
  const evaluation = loaded.review.evaluation;
  return {
    evaluationId: sha256(canonical({ id: loaded.skillId, version: loaded.version, tester: evaluation.tester, testedAt: evaluation.testedAt })).slice(0, 32),
    contentHash: evaluation.contentHash,
    testedAt: evaluation.testedAt,
    summary: evaluation.publicSummary,
    hosts: evaluation.hostChecks.map(check => check.host),
    purposePassed: evaluation.purpose.passed,
    boundaryPassed: evaluation.boundary.passed,
  };
}

function deriveQualification(loaded: SkillVersionDirectory, automatedPassed: boolean): CatalogQualification {
  if (loaded.review.status === 'revoked') return 'revoked';
  const evaluation = loaded.review.evaluation;
  const evaluationPasses = evaluation.kind === 'human'
    && evaluation.purpose.passed && evaluation.boundary.passed
    && evaluation.hostChecks.length > 0
    && evaluation.hostChecks.every(check => check.installed && check.read)
    && loaded.manifest.hosts.every(host => evaluation.hostChecks.some(check => check.host === host));
  if (loaded.review.status === 'approved' && automatedPassed && evaluationPasses) return 'qualified';
  return 'needs-testing';
}

function validateDependencies(entries: CatalogIndexEntry[]): void {
  const byId = new Map<string, CatalogIndexEntry[]>();
  for (const entry of entries) {
    const list = byId.get(entry.skill.id) ?? [];
    list.push(entry);
    byId.set(entry.skill.id, list);
  }
  const qualified = new Set(entries.filter(entry => entry.skill.qualification === 'qualified').map(entry => `${entry.skill.id}@${entry.skill.version}`));
  const visit = (id: string, version: string, seen: Set<string>): void => {
    const key = `${id}@${version}`;
    if (seen.has(key)) throw new SkillFluxError('DEPENDENCY_CYCLE', `Dependency cycle includes ${key}`);
    seen.add(key);
    const entry = entries.find(candidate => candidate.skill.id === id && candidate.skill.version === version);
    if (!entry) throw new SkillFluxError('DEPENDENCY_MISSING', `${key} is referenced as a dependency but does not exist in the catalog`);
    if (!qualified.has(key)) throw new SkillFluxError('DEPENDENCY_NOT_QUALIFIED', `${key} is a dependency but is not qualified`);
    for (const dependency of entry.skill.dependencies) visit(dependency.id, dependency.version, seen);
    seen.delete(key);
  };
  for (const entry of entries) {
    if (entry.skill.qualification !== 'qualified') continue;
    for (const dependency of entry.skill.dependencies) visit(dependency.id, dependency.version, new Set());
  }
}

export async function checkCatalogIndex(catalogRoot: string): Promise<{ ok: true; index: CatalogIndex } | { ok: false; reason: string }> {
  const committed = JSON.parse(await readFile(join(catalogRoot, CATALOG_INDEX_FILE), 'utf8'));
  const scratch = join(catalogRoot, '.skillflux-index-check.tmp');
  const rebuilt = await buildCatalogIndex(catalogRoot, { output: scratch });
  await rm(scratch, { recursive: true, force: true });
  // Compare content, not generatedAt/checkedAt timestamps.
  const normalize = (index: CatalogIndex) => JSON.stringify({ ...index, generatedAt: undefined, skills: index.skills.map(entry => ({ ...entry, skill: { ...entry.skill, quality: { ...entry.skill.quality, automated: { ...entry.skill.quality.automated, checkedAt: undefined } } } })) });
  const a = normalize(rebuilt.index);
  const b = normalize(committed);
  if (a !== b) return { ok: false, reason: 'index.json does not match skills/ directory content. Rerun skillflux catalog build and commit the result.' };
  return { ok: true, index: committed };
}
