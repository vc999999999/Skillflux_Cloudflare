import { bundleDigest, contentHash, compareVersions, safeRelativePath, sha256, verifyPayload, type Bundle, type Host, type PublicKeyInfo, type QualificationProof, type Revocations, type Signed } from '../shared.js';
import { QUALIFICATION_FILE, verifyQualificationProof } from './qualification.js';
import { RUNTIME_VERSION } from './updates.js';
import { SkillFluxError } from './errors.js';

export const MAX_BUNDLE_BYTES = 512 * 1024;
export const MAX_BUNDLE_FILES = 64;
const RESERVED_INSTALL_FILES = new Set(['manifest.json', '.skillflux-envelope.json', QUALIFICATION_FILE]);
const SEMANTIC_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function isSemanticVersion(value: string): boolean {
  return SEMANTIC_VERSION.test(value);
}

function conflictsWithRuntimeMetadata(path: string): boolean {
  return RESERVED_INSTALL_FILES.has(path.split('/')[0]?.toLocaleLowerCase('en-US') ?? '');
}

export interface VerifiedBundle {
  bundle: Bundle;
  digest: string;
  totalBytes: number;
}

export function verifyBundleEnvelope(
  envelope: Signed<Bundle>,
  key: PublicKeyInfo,
  expected: { digest: string; id?: string; version?: string; host?: Host; qualification?: Signed<QualificationProof>; allowExpiredQualification?: boolean; integrityOnly?: boolean },
): VerifiedBundle {
  let bundle: Bundle;
  try {
    bundle = verifyPayload(envelope, key);
  } catch (error) {
    throw new SkillFluxError('INVALID_BUNDLE_SIGNATURE', (error as Error).message);
  }
  const digest = bundleDigest(bundle);
  if (digest !== expected.digest) throw new SkillFluxError('BUNDLE_DIGEST_MISMATCH', `Expected ${expected.digest}, received ${digest}`);
  const manifest = bundle?.manifest;
  if (!manifest || manifest.schema !== 'skillflux/v1') throw new SkillFluxError('INVALID_MANIFEST', 'Bundle manifest schema is invalid');
  if (expected.id && manifest.id !== expected.id) throw new SkillFluxError('PLAN_MISMATCH', `Bundle id ${manifest.id} does not match plan ${expected.id}`);
  if (expected.version && manifest.version !== expected.version) throw new SkillFluxError('PLAN_MISMATCH', `Bundle version ${manifest.version} does not match plan ${expected.version}`);
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(manifest.id)) throw new SkillFluxError('INVALID_MANIFEST', `Invalid skill id: ${manifest.id}`);
  if (!isSemanticVersion(manifest.version)) throw new SkillFluxError('INVALID_MANIFEST', `Version must be exact semver: ${manifest.version}`);
  if (!manifest.quality?.automated?.passed || !manifest.quality.review) {
    throw new SkillFluxError('UNREVIEWED_SKILL', 'Only automated-check-passing, human-reviewed skills can be installed');
  }
  const evaluation = manifest.quality.evaluation;
  if (expected.qualification) {
    verifyQualificationProof(expected.qualification, key, { id: manifest.id, version: manifest.version, digest, hosts: manifest.hosts, bundle }, expected.allowExpiredQualification);
  } else if (!expected.integrityOnly && (!evaluation || evaluation.contentHash !== contentHash(bundle) || !evaluation.purposePassed || !evaluation.boundaryPassed
    || !manifest.hosts.every(host => evaluation.hosts.includes(host)))) {
    throw new SkillFluxError('UNTESTED_SKILL', 'The signed skill lacks passing evaluation evidence bound to this content and every declared host');
  }
  if (manifest.release?.minClientVersion && compareVersions(RUNTIME_VERSION, manifest.release.minClientVersion) < 0) throw new SkillFluxError('INCOMPATIBLE_CLIENT', `This skill requires SkillFlux >= ${manifest.release.minClientVersion}`);
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
  if (manifest.files.length !== fileEntries.length) throw new SkillFluxError('MANIFEST_FILE_MISMATCH', 'Manifest and bundle file counts differ');
  const manifestFiles = new Map(manifest.files.map(file => [file.path, file]));
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
    const declared = manifestFiles.get(path);
    if (!declared) throw new SkillFluxError('MANIFEST_FILE_MISMATCH', `Bundle contains undeclared file: ${path}`);
    if (declared.size !== actualSize || declared.sha256 !== sha256(content)) {
      throw new SkillFluxError('FILE_HASH_MISMATCH', `Manifest hash or size does not match ${path}`);
    }
  }
  for (const file of manifest.files) {
    if (!safeRelativePath(file.path) || !Object.hasOwn(bundle.files, file.path)) {
      throw new SkillFluxError('MANIFEST_FILE_MISMATCH', `Manifest references a missing or unsafe file: ${file.path}`);
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
  return { bundle, digest, totalBytes };
}

export function verifyRevocationEnvelope(envelope: Signed<Revocations>, key: PublicKeyInfo): Revocations {
  let revocations: Revocations;
  try {
    revocations = verifyPayload(envelope, key);
  } catch (error) {
    throw new SkillFluxError('INVALID_REVOCATION_SIGNATURE', (error as Error).message);
  }
  if (!revocations || !Array.isArray(revocations.items)) throw new SkillFluxError('INVALID_REVOCATIONS', 'Revocation feed payload is invalid');
  const expiry = Date.parse(revocations.expiresAt);
  if (!Number.isFinite(expiry)) throw new SkillFluxError('INVALID_REVOCATIONS', 'Revocation feed expiration is invalid');
  return revocations;
}

export function isRevoked(revocations: Revocations, identity: { id: string; version: string; digest: string }): string | null {
  const item = revocations.items.find(candidate => candidate.id === identity.id && candidate.version === identity.version && candidate.digest === identity.digest);
  return item?.reason ?? null;
}
