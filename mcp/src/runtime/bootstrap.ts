import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Host } from '../shared.js';
import { SkillFluxError } from './errors.js';
import { assertNoSymlinkPath, atomicWriteText } from './paths.js';

const OWNERSHIP_MARKER = '<!-- skillflux-bootstrap:v1 -->';

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..');
}

function targetDirectory(projectRoot: string, host: Host): string {
  if (host === 'claude') return join(projectRoot, '.claude', 'skills', 'skillflux');
  if (host === 'cursor') return join(projectRoot, '.cursor', 'skills', 'skillflux');
  if (host === 'generic') return join(projectRoot, '.skillflux', 'bootstrap', 'skillflux');
  return join(projectRoot, '.agents', 'skills', 'skillflux');
}

export async function installBootstrapSkill(projectRoot: string, host: Host): Promise<string> {
  const source = join(packageRoot(), 'skills', 'skillflux');
  const target = targetDirectory(projectRoot, host);
  await assertNoSymlinkPath(projectRoot, target, true);
  await mkdir(target, { recursive: true, mode: 0o700 });
  await assertNoSymlinkPath(projectRoot, target, false);
  const sourceSkill = await readFile(join(source, 'SKILL.md'), 'utf8');
  const skill = host === 'claude' || host === 'cursor' ? withExplicitInvocationFrontmatter(sourceSkill) : sourceSkill;
  const skillTarget = join(target, 'SKILL.md');
  await assertNoSymlinkPath(projectRoot, skillTarget, true);
  const existing = await readFile(skillTarget, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing !== null && !existing.includes(OWNERSHIP_MARKER)) {
    throw new SkillFluxError('BOOTSTRAP_CONFLICT', `Refusing to overwrite a user-owned Skill at ${join(target, 'SKILL.md')}`);
  }
  await atomicWriteText(skillTarget, skill, 0o644);
  if (host === 'codex') {
    const metadata = await readFile(join(source, 'agents', 'openai.yaml'), 'utf8');
    await assertNoSymlinkPath(projectRoot, join(target, 'agents'), true);
    await mkdir(join(target, 'agents'), { recursive: true, mode: 0o700 });
    await assertNoSymlinkPath(projectRoot, join(target, 'agents'), false);
    const metadataTarget = join(target, 'agents', 'openai.yaml');
    await assertNoSymlinkPath(projectRoot, metadataTarget, true);
    await atomicWriteText(metadataTarget, metadata, 0o644);
  }
  return join(target, 'SKILL.md');
}

function withExplicitInvocationFrontmatter(skill: string): string {
  const closing = skill.indexOf('\n---', 4);
  if (!skill.startsWith('---\n') || closing < 0) throw new SkillFluxError('INVALID_BOOTSTRAP', 'Bootstrap Skill frontmatter is invalid');
  return `${skill.slice(0, closing)}\ndisable-model-invocation: true\nuser-invocable: true${skill.slice(closing)}`;
}
