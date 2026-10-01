import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Bundle, Host, SearchResponse, SkillVersionSummary } from '../shared.js';
import { canonical, compareVersions, safeRelativePath } from '../shared.js';
import type { CatalogIndex, CatalogIndexEntry } from '../catalog/model.js';
import { CatalogClient } from './catalog-client.js';
import { SkillFluxError } from './errors.js';
import {
  LOCK_SCHEMA,
  PLAN_SCHEMA,
  STATE_SCHEMA,
  type CreatePlanOptions,
  type InstallJournal,
  type InstallResult,
  type InstallationState,
  type InstalledPackage,
  type ListResult,
  type LoadedSkill,
  type LockEntry,
  type PlanPackage,
  type ProjectLock,
  type ResolutionPlan,
  type ResolutionPlanBody,
  type RuntimeConfig,
  type RuntimePaths,
  type RuntimePolicy,
  type SearchOptions,
  type TrustRecord,
  type UpdateCheckItem,
  type UpdateCheckResult,
} from './model.js';
import { orderedReleases, releaseCompatibility, RUNTIME_VERSION, UPDATE_CACHE_MS } from './updates.js';
import {
  loadRuntimeState,
  moveDirectoryAtomic,
  readInstalledPackage,
  readLock,
  readPlan,
  recoverJournal,
  sealPlan,
  verifyInstalledFiles,
  verifyPlanSeal,
  writeInstalledPackage,
  writeLockWithHistory,
  writePlan,
} from './project.js';
import {
  assertNoSymlinkPath,
  atomicWriteJson,
  isInside,
  readJson,
  readJsonIfExists,
  removeIfExists,
  withProjectLock,
} from './paths.js';
import { isSemanticVersion, searchIndex, validateIndexEntry, verifyDownloadedBundle } from './validation.js';

const PLAN_TTL_MS = 10 * 60 * 1000;
const MAX_DEPENDENCIES = 32;

interface CatalogState {
  index: CatalogIndex;
  commitSha: string;
  fetchedAt: string;
}

export class SkillFluxRuntime {
  readonly paths: RuntimePaths;
  readonly config: RuntimeConfig;
  private policyValue: RuntimePolicy;
  readonly trust: TrustRecord;
  readonly client: CatalogClient;

  private constructor(state: Awaited<ReturnType<typeof loadRuntimeState>>) {
    this.paths = state.paths;
    this.config = state.config;
    this.policyValue = state.policy;
    this.trust = state.trust;
    this.client = new CatalogClient(state.config.repo, { source: state.config.source });
  }

  static async open(projectRoot: string): Promise<SkillFluxRuntime> {
    const state = await loadRuntimeState(projectRoot);
    await withProjectLock(state.paths, async () => recoverJournal(state.paths));
    return new SkillFluxRuntime(state);
  }

  get policy(): Readonly<RuntimePolicy> {
    return this.policyValue;
  }

  async search(options: SearchOptions = {}): Promise<SearchResponse> {
    const query = sanitizeCapabilityQuery(options.query ?? '');
    const catalog = await this.getCatalog(false);
    return searchIndex(catalog.index.skills, {
      query,
      category: options.category?.slice(0, 80),
      host: options.host ?? this.config.host,
      sort: options.sort ?? 'relevance',
      limit: options.limit,
      offset: options.offset,
    });
  }

  async createPlan(skillId: string, options: CreatePlanOptions = {}): Promise<ResolutionPlan> {
    assertSkillId(skillId);
    const lock = await readLock(this.paths);
    const catalog = await this.getCatalog(true);
    const resolved = new Map<string, CatalogIndexEntry>();
    const visiting = new Set<string>();
    const visit = async (id: string, version: string | undefined, direct: boolean): Promise<void> => {
      const entry = findCatalogEntry(catalog.index, id, version);
      if (!entry) throw new SkillFluxError('SKILL_NOT_FOUND', `${id}${version ? `@${version}` : ''} was not found in the catalog`);
      validateIndexEntry(entry);
      validateEntryForInstall(entry, this.config.host);
      for (const dependency of entry.skill.dependencies) {
        if (!findCatalogEntry(catalog.index, dependency.id, dependency.version)) {
          throw new SkillFluxError('DEPENDENCY_MISSING', `${id} requires ${dependency.id}@${dependency.version}, which is not in the catalog`);
        }
      }
      const key = entry.skill.id;
      if (visiting.has(key)) throw new SkillFluxError('DEPENDENCY_CYCLE', `Dependency cycle includes ${key}`);
      const existing = resolved.get(key);
      if (existing && existing.skill.version !== entry.skill.version) {
        throw new SkillFluxError('DEPENDENCY_VERSION_CONFLICT', `${key} is required at both ${existing.skill.version} and ${entry.skill.version}`);
      }
      if (existing) return;
      if (resolved.size >= MAX_DEPENDENCIES + 1) throw new SkillFluxError('DEPENDENCY_LIMIT', `A plan cannot contain more than ${MAX_DEPENDENCIES} dependencies`);
      visiting.add(key);
      resolved.set(key, entry);
      for (const dependency of entry.skill.dependencies) await visit(dependency.id, dependency.version, false);
      visiting.delete(key);
      if (direct) resolved.delete(key), resolved.set(key, entry);
    };
    await visit(skillId, options.version ?? lock.skills[skillId]?.version, true);
    const rootEntry = resolved.get(skillId);
    if (!rootEntry) throw new SkillFluxError('SKILL_NOT_FOUND', `Unable to resolve ${skillId}`);
    const packages: PlanPackage[] = [...resolved.values()].map(entry => ({
      id: entry.skill.id,
      version: entry.skill.version,
      digest: entry.skill.digest,
      direct: entry.skill.id === skillId,
      name: entry.skill.name,
      publisher: entry.skill.publisher,
      permissions: entry.skill.permissions,
      dependencies: entry.skill.dependencies,
    }));
    const now = Date.now();
    const changes = packages.filter(item => lock.skills[item.id] && lock.skills[item.id].digest !== item.digest).map(item => ({
      id: item.id, from: lock.skills[item.id].version, to: item.version,
      notes: resolved.get(item.id)?.skill.release?.notes ?? 'Release notes are unavailable.',
      breaking: resolved.get(item.id)?.skill.release?.breaking ?? (compareVersions(item.version, lock.skills[item.id].version) > 0 && item.version.split('.')[0] !== lock.skills[item.id].version.split('.')[0]),
      pinned: lock.skills[item.id].pinned === true,
    }));
    for (const change of changes) {
      if (change.pinned) throw new SkillFluxError('VERSION_PINNED', `${change.id} is pinned at ${change.from}; explicitly unpin it before creating an upgrade plan`);
    }
    if (changes.length && !options.version) throw new SkillFluxError('EXACT_UPDATE_TARGET_REQUIRED', 'An update requires an explicitly selected exact target version');
    const body: ResolutionPlanBody = {
      schema: PLAN_SCHEMA,
      id: `plan_${randomUUID()}`,
      projectRoot: this.paths.root,
      repo: this.config.repo,
      host: this.config.host,
      rootSkillId: rootEntry.skill.id,
      rootSkillVersion: rootEntry.skill.version,
      packages,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + Math.max(30_000, Math.min(options.ttlMs ?? PLAN_TTL_MS, 60 * 60 * 1000))).toISOString(),
      intent: changes.length ? 'update' : 'install',
      baseLockRevision: lock.revision,
      changes,
    };
    await assertNoSymlinkPath(this.paths.root, this.paths.installation, false);
    const installation = await readJson<InstallationState>(this.paths.installation);
    assertPlanCompatibleWithLock(body, lock);
    buildNextLock(lock, body);
    const plan = sealPlan(body, installation.planSecret);
    await writePlan(this.paths, plan);
    return plan;
  }

  async installPlan(planId: string, actor: 'cli' | 'mcp' = 'cli'): Promise<InstallResult> {
    return this.executePlan(planId, actor, false);
  }

  async inspectPlan(planId: string): Promise<ResolutionPlan> {
    const plan = await readPlan(this.paths, planId);
    await assertNoSymlinkPath(this.paths.root, this.paths.installation, false);
    const installation = await readJson<InstallationState>(this.paths.installation);
    this.validatePlanBody(verifyPlanSeal(plan, installation.planSecret));
    return plan;
  }

  async installUpdatePlan(planId: string, actor: 'cli' | 'mcp' = 'cli'): Promise<InstallResult> {
    return this.executePlan(planId, actor, true);
  }

  private async executePlan(planId: string, actor: 'cli' | 'mcp', authorizeUpdate: boolean): Promise<InstallResult> {
    return withProjectLock(this.paths, async () => {
      await this.refreshPolicy();
      const plan = await readPlan(this.paths, planId);
      await assertNoSymlinkPath(this.paths.root, this.paths.installation, false);
      const installation = await readJson<InstallationState>(this.paths.installation);
      const body = verifyPlanSeal(plan, installation.planSecret);
      this.validatePlanBody(body);
      if (authorizeUpdate && body.intent !== 'update') throw new SkillFluxError('NOT_AN_UPDATE_PLAN', 'This plan does not contain a version update');
      if (!authorizeUpdate && body.intent === 'update') throw new SkillFluxError('UPDATE_CONFIRMATION_REQUIRED', 'Review the exact changes and explicitly execute this plan with update; install preauthorization does not authorize upgrades');
      if (actor === 'mcp' && !this.policyValue.preauthorizeReviewedText) {
        throw new SkillFluxError('LOCAL_PREAUTHORIZATION_REQUIRED', 'This project has not preauthorized MCP installation of reviewed text-only skills. Run the CLI install command or re-run init with --preauthorize-reviewed-text.');
      }
      const catalog = await this.getCatalog(true);
      const previous = await readLock(this.paths);
      if (body.baseLockRevision !== undefined && body.baseLockRevision !== previous.revision) throw new SkillFluxError('PLAN_STALE', 'Project lock changed after this plan was created; create and review a new plan');
      for (const item of body.packages) {
        const current = previous.skills[item.id];
        if (current && current.digest !== item.digest) {
          if (!authorizeUpdate) throw new SkillFluxError('UPDATE_CONFIRMATION_REQUIRED', 'Existing versions can only change through an explicitly confirmed update plan');
          if (current.pinned) throw new SkillFluxError('VERSION_PINNED', `${item.id} is pinned at ${current.version}; explicitly unpin it before upgrading`);
          await this.readAndVerifyInstalled(current, null, { localOnly: true });
        }
      }
      assertPlanCompatibleWithLock(body, previous);
      const transactionId = randomUUID();
      const stageRoot = join(this.paths.staging, transactionId);
      await assertNoSymlinkPath(this.paths.root, stageRoot, true);
      await mkdir(stageRoot, { recursive: true, mode: 0o700 });
      await assertNoSymlinkPath(this.paths.root, stageRoot, false);
      const verified = new Map<string, { pkg: InstalledPackage; target: string; reused: boolean }>();
      try {
        for (const item of body.packages) {
          const entry = findCatalogEntry(catalog.index, item.id, item.version);
          if (!entry) throw new SkillFluxError('SKILL_NOT_FOUND', `${item.id}@${item.version} is not in the current catalog index`);
          validateIndexEntry(entry);
          if (entry.skill.digest !== item.digest) throw new SkillFluxError('PLAN_MISMATCH', `Catalog digest for ${item.id}@${item.version} changed after plan creation`);
          if (entry.skill.status === 'revoked' || entry.skill.qualification === 'revoked') {
            throw new SkillFluxError('SKILL_REVOKED', `${item.id}@${item.version} was revoked`);
          }
          const current = previous.skills[item.id];
          const target = this.packageRoot(item.id, item.version);
          if (current?.digest === item.digest) {
            const installed = await this.readAndVerifyInstalled(current, null, { localOnly: true });
            assertPlanPackageMatchesBundle(item, installed);
            verified.set(item.id, { pkg: installed, target, reused: true });
            continue;
          }
          const bundle = await this.downloadBundle(catalog.commitSha, entry);
          assertPlanPackageMatchesBundle(item, bundle);
          const staged = join(stageRoot, item.id, item.version);
          await mkdir(staged, { recursive: true, mode: 0o700 });
          const pkg: InstalledPackage = {
            schema: STATE_SCHEMA,
            digest: item.digest,
            manifest: bundle.manifest,
            files: bundle.files,
            indexSha: catalog.commitSha,
            installedAt: new Date().toISOString(),
          };
          await writeInstalledPackage(this.paths, pkg, staged);
          await assertNoSymlinkPath(this.paths.root, this.paths.cache, false);
          await atomicWriteJson(join(this.paths.cache, `${item.digest}.json`), pkg);
          verified.set(item.id, { pkg, target, reused: false });
        }

        const next = buildNextLock(previous, body);
        const journal: InstallJournal = {
          schema: STATE_SCHEMA,
          operation: 'install',
          phase: 'prepared',
          transactionId,
          previousLock: previous,
          nextLock: next,
          stageRoot,
          createdAt: new Date().toISOString(),
        };
        await atomicWriteJson(this.paths.journal, journal);
        for (const item of body.packages) {
          const value = verified.get(item.id);
          if (!value || value.reused) continue;
          const staged = join(stageRoot, item.id, item.version);
          await assertNoSymlinkPath(this.paths.root, dirname(value.target), true);
          await mkdir(dirname(value.target), { recursive: true, mode: 0o700 });
          await assertNoSymlinkPath(this.paths.root, dirname(value.target), false);
          await assertNoSymlinkPath(this.paths.root, value.target, true);
          const moved = await moveDirectoryAtomic(staged, value.target);
          if (!moved) {
            const existing = await this.readAndVerifyInstalled({
              id: item.id,
              version: item.version,
              digest: item.digest,
              direct: item.direct,
              dependencies: item.dependencies,
              installedAt: new Date().toISOString(),
              publisher: item.publisher,
              name: item.name,
            }, null, { localOnly: true });
            if (existing.digest !== item.digest) throw new SkillFluxError('IMMUTABLE_VERSION_CONFLICT', `Existing package directory conflicts with ${item.id}@${item.version}`);
          }
        }
        await atomicWriteJson(this.paths.journal, { ...journal, phase: 'materialized' });
        await writeLockWithHistory(this.paths, previous, next);
        await rm(this.paths.journal, { force: true });
        await removeIfExists(stageRoot);
        await rm(join(this.paths.plans, `${planId}.json`), { force: true });
        const installed = body.packages.filter(item => !verified.get(item.id)?.reused).map(item => next.skills[item.id]);
        const reused = body.packages.filter(item => verified.get(item.id)?.reused).map(item => next.skills[item.id]);
        return {
          planId,
          rootSkill: { id: body.rootSkillId, version: body.rootSkillVersion },
          installed,
          reused,
          lockRevision: next.revision,
        };
      } catch (error) {
        const journal = await readJsonIfExists<InstallJournal>(this.paths.journal);
        if (!journal || journal.phase === 'prepared') {
          await removeIfExists(stageRoot);
          await rm(this.paths.journal, { force: true });
        }
        throw error;
      }
    });
  }

  async load(skillId: string, resources: string[] = []): Promise<LoadedSkill> {
    assertSkillId(skillId);
    for (const resource of resources) if (!safeRelativePath(resource)) throw new SkillFluxError('UNSAFE_RESOURCE_PATH', `Unsafe resource path: ${resource}`);
    const lock = await readLock(this.paths);
    const entry = lock.skills[skillId];
    if (!entry) throw new SkillFluxError('SKILL_NOT_INSTALLED', `${skillId} is not installed in this project`);
    const warnings: string[] = [];
    let catalogStatusKnown = true;
    let catalog: CatalogState;
    const cacheBefore = await readJsonIfExists<CatalogState & { repo?: string }>(this.paths.index);
    try {
      catalog = await this.getCatalog(true);
    } catch (error) {
      // A stale cached index may still be returned by the tolerant path; either way
      // the catalog fetch failed and current status must be disclosed as unknown.
      catalogStatusKnown = false;
      catalog = cacheBefore?.repo === this.config.repo && cacheBefore.index
        ? cacheBefore
        : { index: { schema: 'skillflux-catalog-index/v1', generatedAt: '', skills: [] }, commitSha: '', fetchedAt: '' };
      warnings.push(`Current catalog status is unknown: ${(error as Error).message}`);
    }
    const installed = await this.readAndVerifyInstalled(entry, catalog.index, { offlineTolerant: true });
    warnings.push(...installed.warnings ?? []);
    const currentEntry = catalogStatusKnown ? findCatalogEntry(catalog.index, entry.id, entry.version) : undefined;
    if (catalogStatusKnown && currentEntry && (currentEntry.skill.status === 'revoked' || currentEntry.skill.qualification === 'revoked')) {
      throw new SkillFluxError('SKILL_REVOKED', `${entry.id}@${entry.version} was revoked in the current catalog`);
    }
    if (catalogStatusKnown && currentEntry && currentEntry.skill.digest !== entry.digest) {
      warnings.push(`Catalog content hash for ${entry.id}@${entry.version} differs from the installed package; the catalog entry may have been republished. Verify before continuing to rely on the installed copy.`);
    }
    const selectedResources: Record<string, string> = {};
    for (const resource of [...new Set(resources)]) {
      if (!Object.hasOwn(installed.files, resource)) throw new SkillFluxError('RESOURCE_NOT_FOUND', `${resource} is not a declared resource of ${skillId}`);
      selectedResources[resource] = installed.files[resource];
    }
    const dependencies: LoadedSkill['dependencies'] = [];
    const seen = new Set<string>();
    const loadDependency = async (dependencyId: string, expectedVersion: string): Promise<void> => {
      if (seen.has(dependencyId)) return;
      seen.add(dependencyId);
      const dependency = lock.skills[dependencyId];
      if (!dependency || dependency.version !== expectedVersion) throw new SkillFluxError('LOCK_DEPENDENCY_MISMATCH', `${skillId} requires ${dependencyId}@${expectedVersion}`);
      const verifiedDep = await this.readAndVerifyInstalled(dependency, catalog.index, { offlineTolerant: true });
      warnings.push(...verifiedDep.warnings ?? []);
      for (const child of verifiedDep.manifest.dependencies) await loadDependency(child.id, child.version);
      dependencies.push({
        id: dependency.id,
        version: dependency.version,
        entry: verifiedDep.manifest.entry,
        content: verifiedDep.files[verifiedDep.manifest.entry],
      });
    };
    for (const dependency of installed.manifest.dependencies) await loadDependency(dependency.id, dependency.version);
    const result: LoadedSkill = {
      skill: { id: entry.id, version: entry.version, digest: entry.digest, name: entry.name, publisher: entry.publisher },
      manifest: installed.manifest,
      entry: { path: installed.manifest.entry, content: installed.files[installed.manifest.entry] },
      resources: selectedResources,
      dependencies,
      warnings,
    };
    try {
      result.update = (await this.checkUpdates(skillId, false)).items[0];
    } catch (error) {
      result.warnings.push(`Update availability is unknown: ${(error as Error).message}`);
    }
    return result;
  }

  async list(): Promise<ListResult> {
    const lock = await readLock(this.paths);
    return { projectRoot: this.paths.root, revision: lock.revision, skills: Object.values(lock.skills).sort((a, b) => a.id.localeCompare(b.id)) };
  }

  async checkUpdates(skillId?: string, force = true): Promise<UpdateCheckResult> {
    if (skillId) assertSkillId(skillId);
    const lock = await readLock(this.paths);
    const entries = skillId ? [lock.skills[skillId]] : Object.values(lock.skills);
    if (entries.some(entry => !entry)) throw new SkillFluxError('SKILL_NOT_INSTALLED', `${skillId} is not installed`);
    let catalog: CatalogState | null = null;
    let catalogWarning: string | undefined;
    try {
      catalog = await this.getCatalog(force);
    } catch (error) {
      catalogWarning = (error as Error).message;
    }
    const items: UpdateCheckItem[] = [];
    for (const entry of entries) {
      const warnings: string[] = [];
      if (catalogWarning) warnings.push(`Latest version is unknown; catalog check failed: ${catalogWarning}`);
      const releases: SkillVersionSummary[] = catalog
        ? catalog.index.skills.filter(item => item.skill.id === entry.id).map(item => ({
          id: item.skill.id, version: item.skill.version, name: item.skill.name, digest: item.skill.digest,
          status: item.skill.status, qualification: item.skill.qualification, reason: item.skill.quality.review?.notes,
          release: item.skill.release, hosts: item.skill.hosts, dependencies: item.skill.dependencies, createdAt: item.skill.createdAt,
        }))
        : [];
      const source: UpdateCheckItem['source'] = catalog ? 'catalog' : 'unavailable';
      const available = orderedReleases(releases.filter(item => item.qualification === 'qualified' && item.status === 'approved'));
      const latest = available[0];
      const compatible = available.find(item => releaseCompatibility(item, this.config.host, lock) === 'compatible');
      const currentRelease = releases.find(item => item.version === entry.version);
      const revoked = currentRelease?.qualification === 'revoked' || currentRelease?.status === 'revoked';
      const revocationStatus = revoked ? 'revoked' : catalog ? 'clear' : 'unknown';
      const compatibility = latest ? releaseCompatibility(latest, this.config.host, lock) : 'unknown';
      let status: UpdateCheckItem['status'] = 'unknown';
      if (revocationStatus === 'revoked') status = 'revoked';
      else if (catalog && revocationStatus === 'clear') {
        if (compatible && compareVersions(compatible.version, entry.version) > 0) status = 'update-available';
        else if (latest && compareVersions(latest.version, entry.version) > 0 && compatibility === 'incompatible') status = 'incompatible';
        else if (currentRelease?.qualification === 'qualified' && compatibility === 'compatible') status = 'current';
      }
      items.push({ id: entry.id, currentVersion: entry.version, latestVersion: latest?.version ?? null, latestCompatibleVersion: compatible?.version ?? null, status,
        pinned: entry.pinned === true, notes: latest?.release?.notes ?? null, breaking: latest?.release?.breaking ?? null, compatibility,
        revocationStatus, checkedAt: catalog?.fetchedAt ?? null, source, warnings });
    }
    return { projectRoot: this.paths.root, lockRevision: lock.revision, checkedAt: new Date().toISOString(), cacheTtlHours: 24, items };
  }

  /** Kept as a read-only compatibility entrypoint. Updating requires installUpdatePlan(planId). */
  async update(skillId?: string, _actor: 'cli' | 'mcp' = 'cli'): Promise<UpdateCheckResult> {
    return this.checkUpdates(skillId, true);
  }

  async setPinned(skillId: string, pinned: boolean): Promise<LockEntry> {
    assertSkillId(skillId);
    return withProjectLock(this.paths, async () => {
      const previous = await readLock(this.paths);
      if (!previous.skills[skillId]) throw new SkillFluxError('SKILL_NOT_INSTALLED', `${skillId} is not installed`);
      if ((previous.skills[skillId].pinned === true) === pinned) return previous.skills[skillId];
      const next = structuredClone(previous);
      next.skills[skillId].pinned = pinned;
      next.revision += 1;
      next.updatedAt = new Date().toISOString();
      await writeLockWithHistory(this.paths, previous, next);
      return next.skills[skillId];
    });
  }

  async rollback(skillId?: string, actor: 'cli' | 'mcp' = 'cli'): Promise<ProjectLock> {
    return withProjectLock(this.paths, async () => {
      await this.refreshPolicy();
      if (actor === 'mcp' && !this.policyValue.preauthorizeReviewedText) throw new SkillFluxError('LOCAL_PREAUTHORIZATION_REQUIRED', 'MCP rollback is not preauthorized for this project');
      const current = await readLock(this.paths);
      const files = (await readdir(this.paths.history)).filter(name => name.endsWith('.json')).sort().reverse();
      let desired: ProjectLock | null = null;
      for (const file of files) {
        const candidate = await readJson<ProjectLock>(join(this.paths.history, file));
        if (candidate.schema !== LOCK_SCHEMA) continue;
        if (!skillId || candidate.skills[skillId]?.version !== current.skills[skillId]?.version) {
          desired = candidate;
          break;
        }
      }
      if (!desired) throw new SkillFluxError('NO_ROLLBACK_AVAILABLE', skillId ? `No previous state exists for ${skillId}` : 'No previous project lock exists');
      const catalog = await this.getCatalog(true);
      for (const entry of Object.values(current.skills)) {
        if (desired.skills[entry.id]?.digest !== entry.digest) await this.readAndVerifyInstalled(entry, null, { localOnly: true });
        if (entry.pinned && desired.skills[entry.id]?.digest !== entry.digest) throw new SkillFluxError('VERSION_PINNED', `${entry.id} is pinned; explicitly unpin it before rolling back`);
      }
      for (const entry of Object.values(desired.skills)) await this.ensurePackageMaterialized(entry, catalog);
      for (const entry of Object.values(desired.skills)) entry.pinned = current.skills[entry.id]?.pinned ?? false;
      const next: ProjectLock = { ...desired, revision: current.revision + 1, updatedAt: new Date().toISOString() };
      const journal: InstallJournal = {
        schema: STATE_SCHEMA,
        operation: 'lock-restore',
        phase: 'materialized',
        transactionId: randomUUID(),
        previousLock: current,
        nextLock: next,
        createdAt: new Date().toISOString(),
      };
      await atomicWriteJson(this.paths.journal, journal);
      await writeLockWithHistory(this.paths, current, next);
      await rm(this.paths.journal, { force: true });
      return next;
    });
  }

  async remove(skillId: string, options: { force?: boolean; actor?: 'cli' | 'mcp' } = {}): Promise<{ removed: string[]; lockRevision: number }> {
    assertSkillId(skillId);
    if (options.actor === 'mcp' && options.force) throw new SkillFluxError('FORCE_NOT_ALLOWED', 'MCP callers cannot force removal of edited files');
    return withProjectLock(this.paths, async () => {
      const previous = await readLock(this.paths);
      if (!previous.skills[skillId]) throw new SkillFluxError('SKILL_NOT_INSTALLED', `${skillId} is not installed in this project`);
      if (!previous.skills[skillId].direct) throw new SkillFluxError('DEPENDENCY_IN_USE', `${skillId} is an installed dependency; remove its direct parent instead`);
      const candidate = structuredClone(previous);
      delete candidate.skills[skillId];
      const reachable = dependencyClosure(candidate.skills);
      const removedIds = Object.keys(previous.skills).filter(id => id === skillId || !reachable.has(id));
      for (const id of removedIds) {
        const entry = previous.skills[id];
        try {
          await this.readAndVerifyInstalled(entry, null, { localOnly: true });
        } catch (error) {
          if (!options.force) throw new SkillFluxError('LOCAL_EDITS_PRESERVED', `Refusing to remove ${id}; installed files changed. Use CLI --force to explicitly delete them.`, { cause: (error as Error).message });
        }
        delete candidate.skills[id];
      }
      const next: ProjectLock = { ...candidate, revision: previous.revision + 1, updatedAt: new Date().toISOString() };
      await writeLockWithHistory(this.paths, previous, next);
      for (const id of removedIds) {
        const entry = previous.skills[id];
        await removeIfExists(this.packageRoot(entry.id, entry.version));
      }
      return { removed: removedIds, lockRevision: next.revision };
    });
  }

  async privacyState(): Promise<{ anonymous: true; accountRequired: false; installationId: string; locale: string; repo: string; dataSent: string[]; dataNeverSent: string[] }> {
    await this.refreshPolicy();
    return {
      anonymous: true,
      accountRequired: false,
      installationId: 'stored locally and never exposed',
      locale: this.policyValue.locale,
      repo: this.config.repo,
      dataSent: ['catalog repository name'],
      dataNeverSent: ['installation id', 'search queries', 'account identity', 'project path', 'source code', 'file contents', 'secrets', 'full prompt', 'model answer'],
    };
  }

  async resetTrust(): Promise<void> {
    await rm(this.paths.trust, { force: true });
  }

  private async refreshPolicy(): Promise<void> {
    await assertNoSymlinkPath(this.paths.root, this.paths.policy, false);
    const policy = await readJson<RuntimePolicy>(this.paths.policy);
    if (policy.schema !== STATE_SCHEMA || typeof policy.preauthorizeReviewedText !== 'boolean' || typeof policy.locale !== 'string') throw new SkillFluxError('INVALID_LOCAL_POLICY', 'Project policy is invalid; refusing to use previous permissions');
    this.policyValue = policy;
  }

  /** Fetch (or reuse cached) catalog index; TTL 24h unless forced. */
  private async getCatalog(force: boolean, options: { staleTolerant?: boolean } = {}): Promise<CatalogState> {
    const cached = await readJsonIfExists<CatalogState & { repo?: string }>(this.paths.index);
    const cacheValid = cached?.repo === this.config.repo
      && cached.commitSha
      && Date.parse(cached.fetchedAt) > 0
      && Date.now() - Date.parse(cached.fetchedAt) < UPDATE_CACHE_MS;
    if (!force && cacheValid && cached) return cached;
    try {
      const fetched = await this.client.fetchIndex();
      for (const entry of fetched.index.skills) validateIndexEntry(entry);
      const state: CatalogState & { repo: string } = { ...fetched, repo: this.config.repo };
      await assertNoSymlinkPath(this.paths.root, this.paths.index, true);
      await atomicWriteJson(this.paths.index, state);
      return state;
    } catch (error) {
      if (options.staleTolerant && isConnectivityFailure(error) && cached) return cached;
      throw error;
    }
  }

  private async downloadBundle(commitSha: string, entry: CatalogIndexEntry): Promise<Bundle> {
    const manifest: Bundle['manifest'] = {
      schema: 'skillflux/v1',
      id: entry.skill.id,
      version: entry.skill.version,
      name: entry.skill.name,
      description: entry.skill.description,
      category: entry.skill.category,
      tags: entry.skill.tags,
      hosts: entry.skill.hosts,
      publisher: entry.skill.publisher,
      license: entry.skill.license,
      entry: entry.skill.entry,
      permissions: entry.skill.permissions,
      dependencies: entry.skill.dependencies,
      createdAt: entry.skill.createdAt,
      ...(entry.skill.release ? { release: entry.skill.release } : {}),
    };
    const files: Record<string, string> = {};
    for (const file of entry.files) {
      files[file.path] = await this.client.fetchFile(commitSha, `${entry.skill.category}/${entry.skill.id}/${entry.skill.version}/${file.path}`, file);
    }
    const bundle: Bundle = { manifest, files };
    verifyDownloadedBundle(bundle, entry, { id: entry.skill.id, version: entry.skill.version, host: this.config.host });
    return bundle;
  }

  private validatePlanBody(body: ResolutionPlanBody): void {
    if (body.schema !== PLAN_SCHEMA || body.projectRoot !== this.paths.root || body.repo !== this.config.repo || body.host !== this.config.host) {
      throw new SkillFluxError('PLAN_BINDING_MISMATCH', 'Plan is not bound to this project, catalog repository and host');
    }
    if (!Number.isFinite(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= Date.now()) throw new SkillFluxError('PLAN_EXPIRED', 'Resolution plan has expired');
    if (!body.packages.some(item => item.id === body.rootSkillId && item.version === body.rootSkillVersion && item.direct)) {
      throw new SkillFluxError('INVALID_PLAN', 'Resolution plan does not contain its direct root skill');
    }
    if (body.packages.length === 0 || body.packages.length > MAX_DEPENDENCIES + 1) throw new SkillFluxError('INVALID_PLAN', 'Resolution plan package count is invalid');
    const seen = new Set<string>();
    for (const item of body.packages) {
      assertSkillId(item.id);
      if (seen.has(item.id)) throw new SkillFluxError('INVALID_PLAN', `Duplicate package in plan: ${item.id}`);
      seen.add(item.id);
      if (!/^[a-f0-9]{64}$/.test(item.digest)) throw new SkillFluxError('INVALID_PLAN', `Invalid digest in plan: ${item.id}`);
      if (item.permissions.shell || item.permissions.network.length || item.permissions.secrets.length) throw new SkillFluxError('UNSUPPORTED_PERMISSIONS', `Plan requests unsupported permissions: ${item.id}`);
    }
  }

  private packageRoot(id: string, version: string): string {
    assertSkillId(id);
    if (!isSemanticVersion(version)) throw new SkillFluxError('INVALID_VERSION', `Invalid version: ${version}`);
    const target = resolve(this.paths.skills, id, version);
    if (!isInside(this.paths.skills, target)) throw new SkillFluxError('PATH_OUTSIDE_PROJECT', 'Package path escaped project skill directory');
    return target;
  }

  private async readAndVerifyInstalled(entry: LockEntry, catalog: CatalogIndex | null, options: { offlineTolerant?: boolean; localOnly?: boolean } = {}): Promise<InstalledPackage> {
    const root = this.packageRoot(entry.id, entry.version);
    const rootInfo = await lstat(root).catch(() => null);
    if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new SkillFluxError('PACKAGE_NOT_FOUND', `Installed package directory is missing or unsafe: ${entry.id}@${entry.version}`);
    await assertNoSymlinkPath(this.paths.root, root, false);
    const pkg = await readInstalledPackage(root);
    if (pkg.digest !== entry.digest) throw new SkillFluxError('INSTALL_METADATA_MISMATCH', `Installed metadata does not match lock for ${entry.id}`);
    await verifyInstalledFiles(root, pkg);
    if (catalog && !options.localOnly) {
      const entryInIndex = catalog.skills.find(item => item.skill.id === entry.id && item.skill.version === entry.version);
      if (entryInIndex && (entryInIndex.skill.status === 'revoked' || entryInIndex.skill.qualification === 'revoked')) {
        throw new SkillFluxError('SKILL_REVOKED', `${entry.id}@${entry.version} was revoked`);
      }
    }
    return pkg;
  }

  private async ensurePackageMaterialized(entry: LockEntry, catalog: CatalogState): Promise<void> {
    try {
      await this.readAndVerifyInstalled(entry, catalog.index);
      return;
    } catch (error) {
      if ((error as SkillFluxError).code !== 'PACKAGE_NOT_FOUND') throw error;
    }
    const cachedPath = join(this.paths.cache, `${entry.digest}.json`);
    await assertNoSymlinkPath(this.paths.root, cachedPath, true);
    const cached = await readJsonIfExists<InstalledPackage>(cachedPath);
    if (!cached || cached.schema !== STATE_SCHEMA || cached.digest !== entry.digest) throw new SkillFluxError('ROLLBACK_ARTIFACT_MISSING', `Verified cached artifact is unavailable for ${entry.id}@${entry.version}`);
    const indexEntry = findCatalogEntry(catalog.index, entry.id, entry.version);
    if (indexEntry && (indexEntry.skill.status === 'revoked' || indexEntry.skill.qualification === 'revoked')) {
      throw new SkillFluxError('SKILL_REVOKED', `${entry.id}@${entry.version} was revoked`);
    }
    const stage = join(this.paths.staging, `rollback-${randomUUID()}`);
    await assertNoSymlinkPath(this.paths.root, stage, true);
    await mkdir(stage, { recursive: true, mode: 0o700 });
    await assertNoSymlinkPath(this.paths.root, stage, false);
    await writeInstalledPackage(this.paths, cached, stage);
    const target = this.packageRoot(entry.id, entry.version);
    await assertNoSymlinkPath(this.paths.root, dirname(target), true);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await assertNoSymlinkPath(this.paths.root, dirname(target), false);
    await assertNoSymlinkPath(this.paths.root, target, true);
    if (!await moveDirectoryAtomic(stage, target)) {
      await removeIfExists(stage);
      await this.readAndVerifyInstalled(entry, catalog.index);
    }
  }
}

function findCatalogEntry(index: CatalogIndex, id: string, version?: string): CatalogIndexEntry | undefined {
  const versions = index.skills.filter(entry => entry.skill.id === id);
  if (!versions.length) return undefined;
  if (!version) return versions.reduce((best, entry) => compareVersions(entry.skill.version, best.skill.version) > 0 ? entry : best);
  return versions.find(entry => entry.skill.version === version);
}

function validateEntryForInstall(entry: CatalogIndexEntry, host: Host): void {
  if (entry.skill.status !== 'approved' || entry.skill.qualification !== 'qualified') {
    throw new SkillFluxError('UNQUALIFIED_SKILL', `${entry.skill.id}@${entry.skill.version} is not approved and qualified`);
  }
  if (!entry.skill.hosts.includes(host) && !entry.skill.hosts.includes('generic')) {
    throw new SkillFluxError('INCOMPATIBLE_HOST', `${entry.skill.id} does not support ${host}`);
  }
  if (entry.skill.release?.minClientVersion && compareVersions(RUNTIME_VERSION, entry.skill.release.minClientVersion) < 0) {
    throw new SkillFluxError('INCOMPATIBLE_CLIENT', `${entry.skill.id} requires SkillFlux >= ${entry.skill.release.minClientVersion}; current client is ${RUNTIME_VERSION}`);
  }
  if (entry.skill.permissions.shell || entry.skill.permissions.network.length || entry.skill.permissions.secrets.length) {
    throw new SkillFluxError('UNSUPPORTED_PERMISSIONS', `${entry.skill.id} is not a reviewed text-only skill`);
  }
}

function sanitizeCapabilityQuery(input: string): string {
  const normalized = input.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized.length > 500) throw new SkillFluxError('QUERY_TOO_LONG', 'Capability query must be 500 characters or fewer and must not contain source or prompt content');
  return normalized;
}

function assertSkillId(id: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(id)) throw new SkillFluxError('INVALID_SKILL_ID', `Invalid skill id: ${id}`);
}

function assertPlanCompatibleWithLock(plan: ResolutionPlanBody, lock: ProjectLock): void {
  const planned = new Map(plan.packages.map(item => [item.id, item]));
  for (const entry of Object.values(lock.skills)) {
    if (!entry.direct || entry.id === plan.rootSkillId) continue;
    for (const dependency of entry.dependencies) {
      const replacement = planned.get(dependency.id);
      if (replacement && replacement.version !== dependency.version) {
        throw new SkillFluxError('DEPENDENCY_VERSION_CONFLICT', `${entry.id} requires ${dependency.id}@${dependency.version}, but the plan selects ${replacement.version}`);
      }
    }
  }
}

function assertPlanPackageMatchesBundle(item: PlanPackage, pkg: { manifest: Bundle['manifest'] }): void {
  const manifest = pkg.manifest;
  if (canonical(manifest.permissions) !== canonical(item.permissions) || canonical(manifest.dependencies) !== canonical(item.dependencies)) {
    throw new SkillFluxError('PLAN_MISMATCH', `Catalog metadata changed after plan creation: ${item.id}@${item.version}`);
  }
  if (manifest.name !== item.name || manifest.publisher !== item.publisher) {
    throw new SkillFluxError('PLAN_MISMATCH', `Catalog identity changed after plan creation: ${item.id}@${item.version}`);
  }
}

function buildNextLock(previous: ProjectLock, plan: ResolutionPlanBody): ProjectLock {
  const now = new Date().toISOString();
  const skills = structuredClone(previous.skills);
  for (const item of plan.packages) {
    const existing = skills[item.id];
    skills[item.id] = {
      id: item.id,
      version: item.version,
      digest: item.digest,
      direct: item.direct || existing?.direct === true,
      dependencies: item.dependencies,
      installedAt: existing?.digest === item.digest ? existing.installedAt : now,
      publisher: item.publisher,
      name: item.name,
      pinned: existing?.pinned ?? false,
    };
  }
  const reachable = dependencyClosure(skills);
  for (const id of Object.keys(skills)) if (!reachable.has(id)) delete skills[id];
  for (const entry of Object.values(skills)) {
    for (const dependency of entry.dependencies) {
      if (skills[dependency.id]?.version !== dependency.version) {
        throw new SkillFluxError('LOCK_DEPENDENCY_MISMATCH', `${entry.id} requires ${dependency.id}@${dependency.version}`);
      }
    }
  }
  const changed = canonical(skills) !== canonical(previous.skills);
  return { schema: LOCK_SCHEMA, revision: previous.revision + (changed ? 1 : 0), updatedAt: changed ? now : previous.updatedAt, skills };
}

function dependencyClosure(skills: Record<string, LockEntry>): Set<string> {
  const reachable = new Set<string>();
  const visit = (id: string): void => {
    if (reachable.has(id) || !skills[id]) return;
    reachable.add(id);
    for (const dependency of skills[id].dependencies) visit(dependency.id);
  };
  for (const entry of Object.values(skills)) if (entry.direct) visit(entry.id);
  return reachable;
}

function isConnectivityFailure(error: unknown): boolean {
  return error instanceof SkillFluxError && ['SOURCE_UNAVAILABLE', 'SOURCE_TIMEOUT', 'CATALOG_NOT_FOUND'].includes(error.code);
}
