import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { AdDecision, Bundle, Host, QualificationProof, Revocations, SearchResponse, Signed, SkillDetail, SkillVersionSummary } from '../shared.js';
import { bundleDigest, canonical, compareVersions, safeRelativePath, sha256, verifyPayload } from '../shared.js';
import { RegistryClient } from './api-client.js';
import { SkillFluxError } from './errors.js';
import {
  LOCK_SCHEMA,
  PLAN_SCHEMA,
  STATE_SCHEMA,
  type AdEventReport,
  type AdEventType,
  type AdFrequencyState,
  type AdSelection,
  type CreatePlanOptions,
  type EventOutboxFlush,
  type InstallJournal,
  type InstalledEnvelope,
  type InstallResult,
  type InstallationState,
  type ListResult,
  type LoadedSkill,
  type LockEntry,
  type PlanPackage,
  type PrivacyState,
  type ProjectLock,
  type QueuedAdEvent,
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
import { QUALIFICATION_FILE, verifyQualificationProof } from './qualification.js';
import {
  loadRuntimeState,
  moveDirectoryAtomic,
  readLock,
  readPlan,
  recoverJournal,
  sealPlan,
  verifyInstalledFiles,
  verifyPlanSeal,
  writeInstalledBundle,
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
import { isRevoked, isSemanticVersion, verifyBundleEnvelope, verifyRevocationEnvelope } from './validation.js';

const PLAN_TTL_MS = 10 * 60 * 1000;
const MAX_DEPENDENCIES = 32;
const AD_FREQUENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_QUEUED_EVENTS = 1000;

interface RevocationResult {
  feed: Revocations;
  warnings: string[];
}

export class SkillFluxRuntime {
  readonly paths: RuntimePaths;
  readonly config: RuntimeConfig;
  private policyValue: RuntimePolicy;
  readonly trust: TrustRecord;
  readonly client: RegistryClient;

  private constructor(state: Awaited<ReturnType<typeof loadRuntimeState>>) {
    this.paths = state.paths;
    this.config = state.config;
    this.policyValue = state.policy;
    this.trust = state.trust;
    this.client = new RegistryClient(state.config.registry);
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
    const limit = Math.max(1, Math.min(50, Math.trunc(options.limit ?? 12)));
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));
    return this.client.search({
      query,
      category: options.category?.slice(0, 80),
      host: options.host ?? this.config.host,
      sort: options.sort ?? 'relevance',
      limit,
      offset,
    });
  }

  async createPlan(skillId: string, options: CreatePlanOptions = {}): Promise<ResolutionPlan> {
    assertSkillId(skillId);
    const lock = await readLock(this.paths);
    const resolved = new Map<string, SkillDetail>();
    const visiting = new Set<string>();
    const visit = async (id: string, version: string | undefined, direct: boolean): Promise<void> => {
      const detail = await this.client.getSkill(id, version);
      validateSkillDetail(detail, this.config.host);
      verifyQualificationProof(await this.client.getQualification(detail.skill.digest), this.trust, { id: detail.skill.id, version: detail.skill.version, digest: detail.skill.digest, hosts: detail.manifest.hosts });
      const key = detail.skill.id;
      if (visiting.has(key)) throw new SkillFluxError('DEPENDENCY_CYCLE', `Dependency cycle includes ${key}`);
      const existing = resolved.get(key);
      if (existing && existing.skill.version !== detail.skill.version) {
        throw new SkillFluxError('DEPENDENCY_VERSION_CONFLICT', `${key} is required at both ${existing.skill.version} and ${detail.skill.version}`);
      }
      if (existing) return;
      if (resolved.size >= MAX_DEPENDENCIES + 1) throw new SkillFluxError('DEPENDENCY_LIMIT', `A plan cannot contain more than ${MAX_DEPENDENCIES} dependencies`);
      visiting.add(key);
      resolved.set(key, detail);
      for (const dependency of detail.manifest.dependencies) await visit(dependency.id, dependency.version, false);
      visiting.delete(key);
      if (direct) {
        const marked = resolved.get(key);
        if (marked) (marked as SkillDetail & { __direct?: boolean }).__direct = true;
      }
    };
    await visit(skillId, options.version ?? lock.skills[skillId]?.version, true);
    const rootDetail = resolved.get(skillId);
    if (!rootDetail) throw new SkillFluxError('SKILL_NOT_FOUND', `Unable to resolve ${skillId}`);
    const packages: PlanPackage[] = [...resolved.values()].map(detail => ({
      id: detail.skill.id,
      version: detail.skill.version,
      digest: detail.skill.digest,
      direct: detail.skill.id === skillId,
      name: detail.skill.name,
      publisher: detail.skill.publisher,
      permissions: detail.skill.permissions,
      dependencies: detail.skill.dependencies,
    }));
    const now = Date.now();
    const changes = packages.filter(item => lock.skills[item.id] && lock.skills[item.id].digest !== item.digest).map(item => ({
      id: item.id, from: lock.skills[item.id].version, to: item.version,
      notes: resolved.get(item.id)?.manifest.release?.notes ?? 'Release notes are unavailable.',
      breaking: resolved.get(item.id)?.manifest.release?.breaking ?? (compareVersions(item.version, lock.skills[item.id].version) > 0 && item.version.split('.')[0] !== lock.skills[item.id].version.split('.')[0]),
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
      registryOrigin: this.client.origin,
      host: this.config.host,
      rootSkillId: rootDetail.skill.id,
      rootSkillVersion: rootDetail.skill.version,
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
      const revocations = await this.getRevocations(false);
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
      const verified = new Map<string, { envelope: Signed<Bundle>; bundle: Bundle; target: string; reused: boolean }>();
      try {
        for (const item of body.packages) {
          const revokedReason = isRevoked(revocations.feed, item);
          if (revokedReason) throw new SkillFluxError('SKILL_REVOKED', `${item.id}@${item.version} was revoked: ${revokedReason}`);
          const current = previous.skills[item.id];
          const target = this.packageRoot(item.id, item.version);
          if (current?.digest === item.digest) {
            const installed = await this.readAndVerifyInstalled(current, revocations.feed);
            assertPlanPackageMatchesBundle(item, installed.bundle);
            verified.set(item.id, { envelope: installed.envelope, bundle: installed.bundle, target, reused: true });
            continue;
          }
          const envelope = await this.client.getBundle(item.digest);
          const integrity = verifyBundleEnvelope(envelope, this.trust, { digest: item.digest, id: item.id, version: item.version, host: this.config.host, integrityOnly: true });
          const qualification = await this.getQualification(integrity.bundle, item.digest);
          const checked = verifyBundleEnvelope(envelope, this.trust, { digest: item.digest, id: item.id, version: item.version, host: this.config.host, qualification: qualification.envelope });
          const postDownloadRevoked = isRevoked(revocations.feed, { id: item.id, version: item.version, digest: checked.digest });
          if (postDownloadRevoked) throw new SkillFluxError('SKILL_REVOKED', `${item.id}@${item.version} was revoked: ${postDownloadRevoked}`);
          assertPlanPackageMatchesBundle(item, checked.bundle);
          const staged = join(stageRoot, item.id, item.version);
          await mkdir(staged, { recursive: true, mode: 0o700 });
          await writeInstalledBundle(this.paths, envelope, item.digest, staged);
          await atomicWriteJson(join(staged, QUALIFICATION_FILE), qualification.envelope);
          await assertNoSymlinkPath(this.paths.root, this.paths.cache, false);
          await atomicWriteJson(join(this.paths.cache, `${item.digest}.json`), { schema: STATE_SCHEMA, digest: item.digest, envelope, installedAt: new Date().toISOString() });
          verified.set(item.id, { envelope, bundle: checked.bundle, target, reused: false });
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
            }, revocations.feed);
            if (bundleDigest(existing.bundle) !== item.digest) throw new SkillFluxError('IMMUTABLE_VERSION_CONFLICT', `Existing package directory conflicts with ${item.id}@${item.version}`);
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

  async load(skillId: string, resources: string[] = [], includeAdvertisement = true, adContext: 'normal' | 'sensitive' | 'unknown' = 'unknown'): Promise<LoadedSkill> {
    assertSkillId(skillId);
    for (const resource of resources) if (!safeRelativePath(resource)) throw new SkillFluxError('UNSAFE_RESOURCE_PATH', `Unsafe resource path: ${resource}`);
    const lock = await readLock(this.paths);
    const entry = lock.skills[skillId];
    if (!entry) throw new SkillFluxError('SKILL_NOT_INSTALLED', `${skillId} is not installed in this project`);
    const revocations = await this.getRevocations(true);
    const installed = await this.readAndVerifyInstalled(entry, revocations.feed, { allowStale: true });
    const qualificationWarnings = [...installed.warnings];
    const selectedResources: Record<string, string> = {};
    for (const resource of [...new Set(resources)]) {
      if (!Object.hasOwn(installed.bundle.files, resource)) throw new SkillFluxError('RESOURCE_NOT_FOUND', `${resource} is not a declared resource of ${skillId}`);
      selectedResources[resource] = installed.bundle.files[resource];
    }
    const dependencies: LoadedSkill['dependencies'] = [];
    const seen = new Set<string>();
    const loadDependency = async (dependencyId: string, expectedVersion: string): Promise<void> => {
      if (seen.has(dependencyId)) return;
      seen.add(dependencyId);
      const dependency = lock.skills[dependencyId];
      if (!dependency || dependency.version !== expectedVersion) throw new SkillFluxError('LOCK_DEPENDENCY_MISMATCH', `${skillId} requires ${dependencyId}@${expectedVersion}`);
      const verified = await this.readAndVerifyInstalled(dependency, revocations.feed, { allowStale: true });
      qualificationWarnings.push(...verified.warnings);
      for (const child of verified.bundle.manifest.dependencies) await loadDependency(child.id, child.version);
      dependencies.push({
        id: dependency.id,
        version: dependency.version,
        entry: verified.bundle.manifest.entry,
        content: verified.bundle.files[verified.bundle.manifest.entry],
      });
    };
    for (const dependency of installed.bundle.manifest.dependencies) await loadDependency(dependency.id, dependency.version);
    const result: LoadedSkill = {
      skill: { id: entry.id, version: entry.version, digest: entry.digest, name: entry.name, publisher: entry.publisher },
      manifest: installed.bundle.manifest,
      entry: { path: installed.bundle.manifest.entry, content: installed.bundle.files[installed.bundle.manifest.entry] },
      resources: selectedResources,
      dependencies,
      warnings: [...revocations.warnings, ...qualificationWarnings],
    };
    try {
      result.update = (await this.checkUpdates(skillId, false, revocations)).items[0];
    } catch (error) {
      result.warnings.push(`Update availability is unknown: ${(error as Error).message}`);
    }
    if (includeAdvertisement && this.policyValue.adsEnabled) {
      try {
        result.advertisement = (await this.selectAdvertisement(installed.bundle.manifest.category, entry.id, adContext)).decision;
      } catch (error) {
        result.warnings.push(`Advertisement unavailable; skill loading was not affected: ${(error as Error).message}`);
      }
    }
    return result;
  }

  async list(): Promise<ListResult> {
    const lock = await readLock(this.paths);
    return { projectRoot: this.paths.root, revision: lock.revision, skills: Object.values(lock.skills).sort((a, b) => a.id.localeCompare(b.id)) };
  }

  async checkUpdates(skillId?: string, force = true, security?: RevocationResult): Promise<UpdateCheckResult> {
    if (skillId) assertSkillId(skillId);
    const lock = await readLock(this.paths);
    const entries = skillId ? [lock.skills[skillId]] : Object.values(lock.skills);
    if (entries.some(entry => !entry)) throw new SkillFluxError('SKILL_NOT_INSTALLED', `${skillId} is not installed`);
    let securityWarning: string | undefined;
    if (!security && entries.length) {
      try { security = await this.getRevocations(true); } catch (error) { securityWarning = (error as Error).message; }
    }
    const items: UpdateCheckItem[] = [];
    for (const entry of entries) {
      const cachedPath = join(this.paths.cache, `updates-${entry.id}.json`);
      await assertNoSymlinkPath(this.paths.root, cachedPath, true);
      const cached = await readJsonIfExists<{ registry: string; checkedAt: string; releases: SkillVersionSummary[] }>(cachedPath);
      let releases = cached?.registry === this.client.origin && Array.isArray(cached.releases) ? cached.releases : null;
      let checkedAt = releases ? cached!.checkedAt : null;
      let source: UpdateCheckItem['source'] = releases ? 'cache' : 'unavailable';
      const warnings = [...(security?.warnings ?? [])];
      if (securityWarning) warnings.push(`Revocation status unknown: ${securityWarning}`);
      if (force || !checkedAt || !Number.isFinite(Date.parse(checkedAt)) || Date.now() - Date.parse(checkedAt) >= UPDATE_CACHE_MS) {
        try {
          releases = await this.client.getVersions(entry.id);
          checkedAt = new Date().toISOString();
          source = 'registry';
          await atomicWriteJson(cachedPath, { registry: this.client.origin, checkedAt, releases });
        } catch (error) {
          source = releases ? 'stale-cache' : 'unavailable';
          warnings.push(`Latest version is unknown; registry check failed: ${(error as Error).message}`);
        }
      }
      const available = orderedReleases((releases ?? []).filter(item => item.qualification === 'qualified' && item.status === 'approved'));
      const latest = available[0];
      const compatible = available.find(item => releaseCompatibility(item, this.config.host, lock) === 'compatible');
      const currentRelease = releases?.find(item => item.version === entry.version);
      const revoked = security ? isRevoked(security.feed, entry) !== null : false;
      const revocationStatus = revoked || currentRelease?.qualification === 'revoked' ? 'revoked' : security && !security.warnings.length ? 'clear' : 'unknown';
      const compatibility = latest ? releaseCompatibility(latest, this.config.host, lock) : 'unknown';
      let status: UpdateCheckItem['status'] = 'unknown';
      if (revocationStatus === 'revoked') status = 'revoked';
      else if (source !== 'stale-cache' && source !== 'unavailable' && revocationStatus === 'clear') {
        if (compatible && compareVersions(compatible.version, entry.version) > 0) status = 'update-available';
        else if (latest && compareVersions(latest.version, entry.version) > 0 && compatibility === 'incompatible') status = 'incompatible';
        else if (currentRelease?.qualification === 'qualified' && compatibility === 'compatible') status = 'current';
      }
      items.push({ id: entry.id, currentVersion: entry.version, latestVersion: latest?.version ?? null, latestCompatibleVersion: compatible?.version ?? null, status,
        pinned: entry.pinned === true, notes: latest?.release?.notes ?? null, breaking: latest?.release?.breaking ?? null, compatibility,
        revocationStatus, checkedAt, source, warnings });
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
      const revocations = await this.getRevocations(false);
      for (const entry of Object.values(current.skills)) {
        if (desired.skills[entry.id]?.digest !== entry.digest) await this.readAndVerifyInstalled(entry, null, { localOnly: true });
        if (entry.pinned && desired.skills[entry.id]?.digest !== entry.digest) throw new SkillFluxError('VERSION_PINNED', `${entry.id} is pinned; explicitly unpin it before rolling back`);
      }
      for (const entry of Object.values(desired.skills)) await this.ensurePackageMaterialized(entry, revocations.feed);
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
      if (!previous.skills[skillId]) throw new SkillFluxError('SKILL_NOT_INSTALLED', `${skillId} is not installed`);
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

  async privacyState(): Promise<PrivacyState> {
    await this.refreshPolicy();
    const frequency = await this.readFrequency();
    const outbox = await readJsonIfExists<unknown[]>(this.paths.eventOutbox) ?? [];
    return {
      anonymous: true,
      accountRequired: false,
      installationId: 'stored locally and never exposed to the registry',
      installationIdLeavesDevice: false,
      adsEnabled: this.policyValue.adsEnabled,
      locale: this.policyValue.locale,
      localFrequencyEntries: frequency.records.length,
      queuedEvents: outbox.length,
      registry: this.config.registry,
      dataSent: ['capability query', 'skill id', 'coarse category', 'locale', 'excluded campaign ids', 'random request/event ids'],
      dataNeverSent: ['installation id', 'account identity', 'project path', 'source code', 'file contents', 'secrets', 'full prompt', 'model answer'],
    };
  }

  async setAdvertising(enabled: boolean): Promise<RuntimePolicy> {
    return withProjectLock(this.paths, async () => {
      await this.refreshPolicy();
      const next: RuntimePolicy = { ...this.policyValue, adsEnabled: enabled, updatedAt: new Date().toISOString() };
      await atomicWriteJson(this.paths.policy, next);
      if (!enabled) await this.writeEventOutbox([]); // Revoked ad participation discards any queued ad events.
      this.policyValue = next;
      return next;
    });
  }

  private async refreshPolicy(): Promise<void> {
    await assertNoSymlinkPath(this.paths.root, this.paths.policy, false);
    const policy = await readJson<RuntimePolicy>(this.paths.policy);
    if (policy.schema !== STATE_SCHEMA || typeof policy.preauthorizeReviewedText !== 'boolean' || typeof policy.adsEnabled !== 'boolean'
      || typeof policy.locale !== 'string') throw new SkillFluxError('INVALID_LOCAL_POLICY', 'Project policy is invalid; refusing to use previous permissions');
    this.policyValue = policy;
  }

  async resetPrivacy(): Promise<PrivacyState> {
    await withProjectLock(this.paths, async () => {
      const state = await loadRuntimeState(this.paths.root);
      const now = new Date().toISOString();
      await atomicWriteJson(this.paths.installation, {
        ...state.installation,
        installationId: randomUUID(),
        planSecret: randomBytes(32).toString('base64url'),
        rotatedAt: now,
      });
      await atomicWriteJson(this.paths.adFrequency, { schema: STATE_SCHEMA, records: [] });
      await atomicWriteJson(this.paths.eventOutbox, []);
      for (const file of await readdir(this.paths.plans)) if (file.endsWith('.json')) await rm(join(this.paths.plans, file), { force: true });
    });
    return (await SkillFluxRuntime.open(this.paths.root)).privacyState();
  }

  async resetTrust(): Promise<void> {
    await rm(this.paths.trust, { force: true });
  }

  async selectAdvertisement(category: string, skillId?: string, context: 'normal' | 'sensitive' | 'unknown' = 'unknown'): Promise<AdSelection> {
    await this.refreshPolicy();
    if (!this.policyValue.adsEnabled) throw new SkillFluxError('ADS_DISABLED', 'Advertising is disabled in local project policy');
    if (context !== 'normal' || !['development', 'writing', 'design', 'productivity', 'data', 'business', 'education', 'research', 'coding', 'documentation'].includes(category)) {
      throw new SkillFluxError('AD_SUPPRESSED', 'Advertising is suppressed for sensitive or unknown categories');
    }
    const frequency = await this.readFrequency();
    const cutoff = Date.now() - AD_FREQUENCY_WINDOW_MS;
    const excludedCampaigns = [...new Set(frequency.records.filter(record => Date.parse(record.renderedAt) >= cutoff && record.campaignId !== 'house').map(record => record.campaignId))];
    const envelope = await this.client.decideAd({
      category: category.slice(0, 80),
      context,
      skillId,
      locale: this.policyValue.locale,
      placement: 'final-answer',
      excludedCampaigns,
      requestId: randomUUID(),
    });
    let decision: AdDecision;
    try {
      decision = verifyPayload(envelope, this.trust);
    } catch (error) {
      throw new SkillFluxError('INVALID_AD_SIGNATURE', (error as Error).message);
    }
    validateAdDecision(decision);
    await this.refreshPolicy();
    if (!this.policyValue.adsEnabled) throw new SkillFluxError('ADS_DISABLED', 'Advertising was disabled while the decision was in flight');
    // A successful decision proves registry reachability; retry any queued ad events without blocking selection.
    await this.flushEventOutbox().catch(() => undefined);
    return { decision, envelope };
  }

  async recordImpression(selection: AdSelection): Promise<AdEventReport> {
    const report = await this.emitAdEvent(selection, 'impression');
    if (report.status === 'reported') {
      await withProjectLock(this.paths, async () => {
        const frequency = await this.readFrequency();
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        frequency.records = frequency.records.filter(record => Date.parse(record.renderedAt) >= cutoff);
        frequency.records.push({
          campaignId: selection.decision.campaignId ?? 'house',
          sponsor: selection.decision.house ? 'SkillFlux' : selection.decision.text,
          renderedAt: new Date().toISOString(),
        });
        await assertNoSymlinkPath(this.paths.root, this.paths.adFrequency, true);
        await atomicWriteJson(this.paths.adFrequency, frequency);
      });
    }
    return report;
  }

  /** Emits a user-initiated hide for a rendered advertisement, using the decision token's permitted uses. */
  async hideAd(selection: AdSelection): Promise<AdEventReport> {
    return this.emitAdEvent(selection, 'hide');
  }

  /** Emits a user-initiated report for a rendered advertisement, using the decision token's permitted uses. */
  async reportAd(selection: AdSelection, reason: string): Promise<AdEventReport> {
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmed || trimmed.length > 1000) throw new SkillFluxError('INVALID_EVENT_REASON', 'An advertisement report requires a reason of 1 to 1000 characters');
    return this.emitAdEvent(selection, 'report', trimmed);
  }

  /**
   * Resends queued ad events in order, oldest first. Server deduplication counts as success.
   * Permanently rejected events (expired or unknown decisions) are dropped; transient failures keep the rest queued.
   * When local policy has since disabled advertising, the queue is cleared without sending anything.
   */
  async flushEventOutbox(): Promise<EventOutboxFlush> {
    await this.refreshPolicy();
    return withProjectLock(this.paths, async () => {
      const queued = await this.readEventOutbox();
      if (!queued.length) return { flushed: 0, dropped: 0, remaining: 0 };
      if (!this.policyValue.adsEnabled) {
        await this.writeEventOutbox([]);
        return { flushed: 0, dropped: 0, remaining: 0 };
      }
      let flushed = 0;
      let dropped = 0;
      const remaining: QueuedAdEvent[] = [];
      let blocked = false;
      for (const event of queued) {
        if (blocked) {
          remaining.push(event);
          continue;
        }
        try {
          await this.client.emitEvent({ token: event.token, type: event.type, eventId: event.eventId, ...(event.reason ? { reason: event.reason } : {}) });
          flushed += 1;
        } catch (error) {
          if (isPermanentEventRejection(error)) {
            dropped += 1;
          } else {
            blocked = true;
            remaining.push(event);
          }
        }
      }
      await this.writeEventOutbox(remaining);
      return { flushed, dropped, remaining: remaining.length };
    });
  }

  private async emitAdEvent(selection: AdSelection, type: AdEventType, reason?: string): Promise<AdEventReport> {
    await this.refreshPolicy();
    if (!this.policyValue.adsEnabled) {
      await withProjectLock(this.paths, async () => this.writeEventOutbox([]));
      throw new SkillFluxError('ADS_DISABLED', 'Advertising is disabled in local project policy; any queued ad events were discarded');
    }
    // Best-effort retry of earlier queued events now that the registry is being contacted anyway.
    await this.flushEventOutbox().catch(() => undefined);
    const event: QueuedAdEvent = {
      token: selection.decision.token,
      type,
      eventId: randomUUID(),
      ...(reason ? { reason } : {}),
      queuedAt: new Date().toISOString(),
    };
    try {
      const response = await this.client.emitEvent({ token: event.token, type: event.type, eventId: event.eventId, ...(event.reason ? { reason: event.reason } : {}) });
      return { type, eventId: event.eventId, status: 'reported', duplicate: response.duplicate };
    } catch (error) {
      if (isPermanentEventRejection(error)) return { type, eventId: event.eventId, status: 'unknown', duplicate: false };
      try {
        await withProjectLock(this.paths, async () => {
          const queued = await this.readEventOutbox();
          queued.push(event);
          while (queued.length > MAX_QUEUED_EVENTS) queued.shift();
          await this.writeEventOutbox(queued);
        });
        return { type, eventId: event.eventId, status: 'queued', duplicate: false };
      } catch {
        return { type, eventId: event.eventId, status: 'unknown', duplicate: false };
      }
    }
  }

  private async readEventOutbox(): Promise<QueuedAdEvent[]> {
    await assertNoSymlinkPath(this.paths.root, this.paths.eventOutbox, true);
    const events = await readJsonIfExists<QueuedAdEvent[]>(this.paths.eventOutbox) ?? [];
    const valid = (event: QueuedAdEvent) => event && typeof event.token === 'string' && typeof event.eventId === 'string'
      && ['impression', 'hide', 'report'].includes(event.type) && typeof event.queuedAt === 'string'
      && (event.reason === undefined || typeof event.reason === 'string');
    if (!Array.isArray(events) || events.some(event => !valid(event))) throw new SkillFluxError('INVALID_PRIVACY_STATE', 'Local ad event outbox is invalid');
    return events;
  }

  private async writeEventOutbox(events: QueuedAdEvent[]): Promise<void> {
    await assertNoSymlinkPath(this.paths.root, this.paths.eventOutbox, true);
    await atomicWriteJson(this.paths.eventOutbox, events);
  }

  private validatePlanBody(body: ResolutionPlanBody): void {
    if (body.schema !== PLAN_SCHEMA || body.projectRoot !== this.paths.root || body.registryOrigin !== this.client.origin || body.host !== this.config.host) {
      throw new SkillFluxError('PLAN_BINDING_MISMATCH', 'Plan is not bound to this project, registry and host');
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

  private async readAndVerifyInstalled(entry: LockEntry, revocations: Revocations | null, options: { allowStale?: boolean; localOnly?: boolean } = {}): Promise<{ envelope: Signed<Bundle>; bundle: Bundle; warnings: string[] }> {
    const root = this.packageRoot(entry.id, entry.version);
    const rootInfo = await lstat(root).catch(() => null);
    if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new SkillFluxError('PACKAGE_NOT_FOUND', `Installed package directory is missing or unsafe: ${entry.id}@${entry.version}`);
    await assertNoSymlinkPath(this.paths.root, root, false);
    const metadataPath = join(root, '.skillflux-envelope.json');
    await assertNoSymlinkPath(this.paths.root, metadataPath, false);
    const installed = await readJson<InstalledEnvelope>(metadataPath);
    if (installed.schema !== STATE_SCHEMA || installed.digest !== entry.digest) throw new SkillFluxError('INSTALL_METADATA_MISMATCH', `Installed metadata does not match lock for ${entry.id}`);
    const checked = verifyBundleEnvelope(installed.envelope, this.trust, { digest: entry.digest, id: entry.id, version: entry.version, host: this.config.host, integrityOnly: true });
    if (revocations) {
      const reason = isRevoked(revocations, entry);
      if (reason) throw new SkillFluxError('SKILL_REVOKED', `${entry.id}@${entry.version} was revoked: ${reason}`);
    }
    await verifyInstalledFiles(root, checked.bundle);
    const localProofPath = join(root, QUALIFICATION_FILE);
    await assertNoSymlinkPath(this.paths.root, localProofPath, true);
    const localProof = await readJsonIfExists<Signed<QualificationProof>>(localProofPath);
    if (entry.qualificationProofRequired && !localProof) throw new SkillFluxError('QUALIFICATION_METADATA_MISSING', `Installed qualification metadata is missing for ${entry.id}`);
    if (localProof) verifyQualificationProof(localProof, this.trust, { ...entry, hosts: checked.bundle.manifest.hosts, bundle: checked.bundle }, true, false);
    if (options.localOnly) return { envelope: installed.envelope, bundle: checked.bundle, warnings: [] };
    const qualification = await this.getQualification(checked.bundle, entry.digest, root, options.allowStale);
    verifyBundleEnvelope(installed.envelope, this.trust, { digest: entry.digest, id: entry.id, version: entry.version, host: this.config.host, qualification: qualification.envelope, allowExpiredQualification: options.allowStale });
    return { envelope: installed.envelope, bundle: checked.bundle, warnings: qualification.warnings };
  }

  private async getQualification(bundle: Bundle, digest: string, installedRoot?: string, allowStale = false): Promise<{ envelope: Signed<QualificationProof>; warnings: string[] }> {
    const target = installedRoot ? join(installedRoot, QUALIFICATION_FILE) : join(this.paths.cache, `qualification-${digest}.json`);
    await assertNoSymlinkPath(this.paths.root, target, true);
    const cached = await readJsonIfExists<Signed<QualificationProof>>(target);
    const expected = { id: bundle.manifest.id, version: bundle.manifest.version, digest, hosts: bundle.manifest.hosts, bundle };
    // Verify before a network refresh so edits cannot be silently repaired or covered by fresh metadata.
    if (cached) verifyQualificationProof(cached, this.trust, expected, true, false);
    try {
      const envelope = await this.client.getQualification(digest);
      verifyQualificationProof(envelope, this.trust, expected, false, false);
      await atomicWriteJson(target, envelope);
      // Keep signed withdrawals too: a later offline load must not resurrect an older passing proof.
      verifyQualificationProof(envelope, this.trust, expected);
      return { envelope, warnings: [] };
    } catch (error) {
      if (!allowStale || !isConnectivityFailure(error)) throw error;
      if (!cached) throw new SkillFluxError('QUALIFICATION_UNAVAILABLE', 'Offline loading requires a previously verified qualification proof for this exact package');
      const proof = verifyQualificationProof(cached, this.trust, expected, true);
      return { envelope: cached, warnings: [`Offline qualification: ${proof.id}@${proof.version} uses ${Date.parse(proof.expiresAt) <= Date.now() ? 'expired' : 'cached'} signed evidence as of ${proof.generatedAt}; current cloud qualification is unknown.`] };
    }
  }

  private async getRevocations(allowStale: boolean): Promise<RevocationResult> {
    try {
      const envelope = await this.client.getRevocations();
      const feed = verifyRevocationEnvelope(envelope, this.trust);
      if (Date.parse(feed.expiresAt) <= Date.now()) throw new SkillFluxError('REVOCATIONS_EXPIRED', 'Online revocation feed is expired');
      await assertNoSymlinkPath(this.paths.root, this.paths.revocations, true);
      await atomicWriteJson(this.paths.revocations, { schema: STATE_SCHEMA, envelope, fetchedAt: new Date().toISOString() });
      return { feed, warnings: [] };
    } catch (error) {
      if (!allowStale || !isConnectivityFailure(error)) throw error;
      await assertNoSymlinkPath(this.paths.root, this.paths.revocations, true);
      const cached = await readJsonIfExists<{ schema: string; envelope: Signed<Revocations>; fetchedAt: string }>(this.paths.revocations);
      if (!cached || cached.schema !== STATE_SCHEMA) throw new SkillFluxError('REVOCATIONS_UNAVAILABLE', 'Cannot load offline without a previously verified revocation feed');
      const feed = verifyRevocationEnvelope(cached.envelope, this.trust);
      const expired = Date.parse(feed.expiresAt) <= Date.now();
      return {
        feed,
        warnings: [`Offline activation: revocation status is ${expired ? 'expired' : 'cached'} as of ${cached.fetchedAt}. No new package was installed.`],
      };
    }
  }

  private async ensurePackageMaterialized(entry: LockEntry, revocations: Revocations): Promise<void> {
    try {
      await this.readAndVerifyInstalled(entry, revocations);
      return;
    } catch (error) {
      if ((error as SkillFluxError).code !== 'PACKAGE_NOT_FOUND') throw error;
    }
    const cachedPath = join(this.paths.cache, `${entry.digest}.json`);
    await assertNoSymlinkPath(this.paths.root, cachedPath, true);
    const cached = await readJsonIfExists<InstalledEnvelope>(cachedPath);
    if (!cached || cached.schema !== STATE_SCHEMA || cached.digest !== entry.digest) throw new SkillFluxError('ROLLBACK_ARTIFACT_MISSING', `Verified cached artifact is unavailable for ${entry.id}@${entry.version}`);
    const integrity = verifyBundleEnvelope(cached.envelope, this.trust, { digest: entry.digest, id: entry.id, version: entry.version, host: this.config.host, integrityOnly: true });
    const qualification = await this.getQualification(integrity.bundle, entry.digest);
    const checked = verifyBundleEnvelope(cached.envelope, this.trust, { digest: entry.digest, id: entry.id, version: entry.version, host: this.config.host, qualification: qualification.envelope });
    const reason = isRevoked(revocations, entry);
    if (reason) throw new SkillFluxError('SKILL_REVOKED', `${entry.id}@${entry.version} was revoked: ${reason}`);
    const stage = join(this.paths.staging, `rollback-${randomUUID()}`);
    await assertNoSymlinkPath(this.paths.root, stage, true);
    await mkdir(stage, { recursive: true, mode: 0o700 });
    await assertNoSymlinkPath(this.paths.root, stage, false);
    await writeInstalledBundle(this.paths, cached.envelope, checked.digest, stage);
    await atomicWriteJson(join(stage, QUALIFICATION_FILE), qualification.envelope);
    const target = this.packageRoot(entry.id, entry.version);
    await assertNoSymlinkPath(this.paths.root, dirname(target), true);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await assertNoSymlinkPath(this.paths.root, dirname(target), false);
    await assertNoSymlinkPath(this.paths.root, target, true);
    if (!await moveDirectoryAtomic(stage, target)) {
      await removeIfExists(stage);
      await this.readAndVerifyInstalled(entry, revocations);
    }
  }

  private async readFrequency(): Promise<AdFrequencyState> {
    await assertNoSymlinkPath(this.paths.root, this.paths.adFrequency, true);
    const state = await readJsonIfExists<AdFrequencyState>(this.paths.adFrequency) ?? { schema: STATE_SCHEMA, records: [] };
    if (state.schema !== STATE_SCHEMA || !Array.isArray(state.records)) throw new SkillFluxError('INVALID_PRIVACY_STATE', 'Local advertisement frequency state is invalid');
    return state;
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

function validateSkillDetail(detail: SkillDetail, host: Host): void {
  if (!detail?.skill || !detail.manifest || detail.skill.status !== 'approved') throw new SkillFluxError('UNAPPROVED_SKILL', 'Registry detail is not an approved skill');
  if (detail.skill.id !== detail.manifest.id || detail.skill.version !== detail.manifest.version || !/^[a-f0-9]{64}$/.test(detail.skill.digest)) {
    throw new SkillFluxError('INVALID_SKILL_DETAIL', 'Registry skill detail fields are inconsistent');
  }
  if (detail.skill.name !== detail.manifest.name || detail.skill.publisher !== detail.manifest.publisher
    || detail.skill.entry !== detail.manifest.entry || canonical(detail.skill.permissions) !== canonical(detail.manifest.permissions)
    || canonical(detail.skill.dependencies) !== canonical(detail.manifest.dependencies)) {
    throw new SkillFluxError('INVALID_SKILL_DETAIL', 'Registry summary and manifest fields are inconsistent');
  }
  if (!detail.skill.hosts.includes(host) && !detail.skill.hosts.includes('generic')) throw new SkillFluxError('INCOMPATIBLE_HOST', `${detail.skill.id} does not support ${host}`);
  if (detail.manifest.release?.minClientVersion && compareVersions(RUNTIME_VERSION, detail.manifest.release.minClientVersion) < 0) throw new SkillFluxError('INCOMPATIBLE_CLIENT', `${detail.skill.id} requires SkillFlux >= ${detail.manifest.release.minClientVersion}; current client is ${RUNTIME_VERSION}`);
  if (detail.skill.permissions.shell || detail.skill.permissions.network.length || detail.skill.permissions.secrets.length) {
    throw new SkillFluxError('UNSUPPORTED_PERMISSIONS', `${detail.skill.id} is not a reviewed text-only skill`);
  }
  if (!detail.skill.quality.automated.passed || !detail.skill.quality.review) throw new SkillFluxError('UNREVIEWED_SKILL', `${detail.skill.id} lacks complete review evidence`);
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

function assertPlanPackageMatchesBundle(item: PlanPackage, bundle: Bundle): void {
  const manifest = bundle.manifest;
  if (canonical(manifest.permissions) !== canonical(item.permissions) || canonical(manifest.dependencies) !== canonical(item.dependencies)) {
    throw new SkillFluxError('PLAN_MISMATCH', `Signed bundle metadata changed after plan creation: ${item.id}@${item.version}`);
  }
  if (manifest.name !== item.name || manifest.publisher !== item.publisher) {
    throw new SkillFluxError('PLAN_MISMATCH', `Signed bundle identity changed after plan creation: ${item.id}@${item.version}`);
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
      qualificationProofRequired: true,
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
  return error instanceof SkillFluxError && ['REGISTRY_UNAVAILABLE', 'REGISTRY_TIMEOUT'].includes(error.code);
}

/** Client-side 4xx rejections (expired/unknown decisions, disallowed event types) will never succeed on retry. */
function isPermanentEventRejection(error: unknown): boolean {
  if (!(error instanceof SkillFluxError) || isConnectivityFailure(error)) return false;
  const status = (error.details as { status?: number } | undefined)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

function validateAdDecision(decision: AdDecision): void {
  if (!decision || decision.disclosure !== '广告' || !decision.decisionId || !decision.creativeId || !decision.token) {
    throw new SkillFluxError('INVALID_AD', 'Advertisement decision is missing required disclosure or identifiers');
  }
  if (decision.text.trim().length === 0 || decision.text.length > 280 || /[\r\n]/.test(decision.text)) throw new SkillFluxError('INVALID_AD', 'Advertisement text must be one non-empty line of at most 280 characters');
  if (Date.parse(decision.expiresAt) <= Date.now()) throw new SkillFluxError('AD_EXPIRED', 'Advertisement decision has expired');
  let url: URL;
  try {
    url = new URL(decision.url);
  } catch {
    throw new SkillFluxError('INVALID_AD_URL', 'Advertisement URL is invalid');
  }
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new SkillFluxError('INVALID_AD_URL', 'Advertisement URL must use HTTPS; HTTP is allowed only for loopback development');
  if (decision.house && decision.campaignId !== null) throw new SkillFluxError('INVALID_AD', 'House advertisements cannot have a paid campaign id');
  if (!decision.house && !decision.campaignId) throw new SkillFluxError('INVALID_AD', 'Paid advertisements require a campaign id');
}
