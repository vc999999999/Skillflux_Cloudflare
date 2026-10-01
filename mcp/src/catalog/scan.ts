import { extname } from 'node:path';
import { sha256 } from '../shared.js';
import type { QualityEvidence, SkillFile } from '../shared.js';

import { MAX_BUNDLE_BYTES, MAX_BUNDLE_FILES } from '../runtime/validation.js';
export { MAX_BUNDLE_BYTES, MAX_BUNDLE_FILES };

const deniedExtensions = new Set([
  '.7z', '.app', '.bin', '.com', '.dll', '.dmg', '.exe', '.gz',
  '.jar', '.msi', '.node',
  '.so', '.tar', '.tgz', '.wasm', '.xz', '.zip',
]);

const reservedRuntimeRoots = new Set([
  '.skillflux-envelope.json',
  '.skillflux-qualification.json',
  '.skillflux-manifest.json',
  'manifest.json',
  'skillflux.json',
  'skillflux.review.json',
]);

const secretPatterns: Array<{ name: string; pattern: RegExp }> = [
  { name: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: 'github-token', pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { name: 'openai-token', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
];

const unsafeInstructionPatterns: Array<{ name: string; pattern: RegExp }> = [
  { name: 'instruction-override', pattern: /ignore\s+(?:all\s+)?(?:previous|prior|system)\s+instructions?/i },
  { name: 'secret-exfiltration', pattern: /(?:upload|send|exfiltrat\w*)[^\n]{0,80}(?:secret|credential|token|private key)/i },
  { name: 'safety-bypass', pattern: /(?:disable|bypass|evade)[^\n]{0,50}(?:safety|policy|guardrail|permission)/i },
  { name: 'hidden-sponsorship', pattern: /(?:hide|omit|do not disclose)[^\n]{0,80}(?:advertis|sponsor|paid|\u5e7f\u544a|\u8d5e\u52a9)/i },
];

export interface ScanResult {
  quality: QualityEvidence;
  files: SkillFile[];
  totalBytes: number;
  failures: string[];
}

export function scanFiles(files: Record<string, string>, checkedAt = new Date().toISOString()): ScanResult {
  const checks: string[] = [];
  const failures: string[] = [];
  const scanned: SkillFile[] = [];
  let totalBytes = 0;

  const paths = Object.keys(files).sort();
  const foldedPaths = new Map<string, string>();
  const allFoldedPaths = new Set(paths.map(path => path.normalize('NFC').toLowerCase()));
  checks.push(`file-count:${paths.length}/${MAX_BUNDLE_FILES}`);
  if (paths.length > MAX_BUNDLE_FILES) failures.push('bundle contains too many files');

  for (const path of paths) {
    const content = files[path];
    const encoded = Buffer.from(content, 'utf8');
    totalBytes += encoded.byteLength;
    scanned.push({ path, sha256: sha256(encoded), size: encoded.byteLength });

    const extension = extname(path).toLowerCase();
    const foldedPath = path.normalize('NFC').toLowerCase();
    const previousFoldedPath = foldedPaths.get(foldedPath);
    if (previousFoldedPath && previousFoldedPath !== path) {
      failures.push(`${path}: collides with ${previousFoldedPath} on case-insensitive filesystems`);
    } else {
      foldedPaths.set(foldedPath, path);
    }
    const firstSegment = foldedPath.split('/')[0]!;
    if (reservedRuntimeRoots.has(firstSegment)) failures.push(`${path}: path is reserved for SkillFlux runtime metadata`);
    const segments = path.split('/');
    if (segments.some(segment => Buffer.byteLength(segment, 'utf8') > 255)) {
      failures.push(`${path}: a path segment exceeds 255 UTF-8 bytes`);
    }
    for (let index = 1; index < segments.length; index += 1) {
      const parent = segments.slice(0, index).join('/').normalize('NFC').toLowerCase();
      if (allFoldedPaths.has(parent)) failures.push(`${path}: parent path is also submitted as a file`);
    }
    if (deniedExtensions.has(extension)) failures.push(`${path}: executable or archive extension is not allowed`);
    if (content.includes('\u0000')) failures.push(`${path}: NUL byte is not valid text content`);
    for (const secret of secretPatterns) {
      if (secret.pattern.test(content)) failures.push(`${path}: possible ${secret.name}`);
    }
    for (const unsafe of unsafeInstructionPatterns) {
      if (unsafe.pattern.test(content)) failures.push(`${path}: ${unsafe.name} pattern requires rejection`);
    }
  }

  checks.push(`utf8-size:${totalBytes}/${MAX_BUNDLE_BYTES}`);
  if (totalBytes > MAX_BUNDLE_BYTES) failures.push('bundle exceeds 512 KiB');
  checks.push('safe-relative-paths');
  checks.push('runtime-reserved-paths');
  checks.push('case-folded-path-collisions');
  checks.push('file-directory-path-collisions');
  checks.push('filesystem-segment-byte-limits');
  checks.push('no-binary-or-archive-extension');
  checks.push('secret-pattern-scan');
  checks.push('instruction-risk-pattern-scan');

  return {
    quality: {
      automated: {
        passed: failures.length === 0,
        checks,
        checkedAt,
      },
      review: null,
    },
    files: scanned,
    totalBytes,
    failures: [...new Set(failures)],
  };
}

/** Reject declarative permissions: the runtime only installs reviewed text-only skills. */
export function scanPermissions(permissions: { shell: boolean; network: string[]; secrets: string[] }): string[] {
  const failures: string[] = [];
  if (permissions.shell) failures.push('shell permission is not supported');
  if (permissions.network.length > 0) failures.push('network permission is not supported');
  if (permissions.secrets.length > 0) failures.push('secret access is not supported');
  return failures;
}
