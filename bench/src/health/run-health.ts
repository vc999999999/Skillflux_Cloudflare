// Runs the L1 check for skill records and writes web/data/health/<id>.json.
// A record is rewritten only when its result hash changes.
import { existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { HealthRecord, SkillRecord } from '../schema.js';
import { HEALTH_DIR, SKILLS_DIR, readJson, readJsonDir, today, writeJson } from '../paths.js';
import { fetchSnapshot, listFiles } from '../source/fetch.js';
import { commitsSincePin, lastCommitAt, parseRepoUrl, repoMeta, type RepoMeta } from '../source/github.js';
import { CHECKER_VERSION, resultHash, runHealthChecks } from './checks.js';

export interface HealthOptions { only?: string[]; offline?: boolean; force?: boolean }

function previousRepoSpdx(skill: SkillRecord): string | null {
  // A skill-level license file means the SPDX id was never the repository's.
  return skill.license.file && !/^(?:LICEN[CS]E|COPYING)(?:\.[a-z]+)?$/i.test(skill.license.file) ? null : skill.license.spdx;
}

export async function checkSkill(skill: SkillRecord, options: HealthOptions = {}): Promise<{ record: HealthRecord; changed: boolean }> {
  const ref = parseRepoUrl(skill.source.repo);
  const root = await fetchSnapshot(ref, skill.source.commitSha);
  const all = await listFiles(root);
  const prefix = skill.source.path ? `${skill.source.path}/` : '';
  const files = all.filter(file => file.path.startsWith(prefix)).map(file => ({ ...file, path: file.path.slice(prefix.length) }));
  const repoLicenseFile = all.find(file => /^(?:LICEN[CS]E|COPYING)(?:\.[a-z]+)?$/i.test(file.path))?.path ?? null;
  const checkedAt = today();

  let meta: RepoMeta | null = null;
  let changed: string | null = null;
  let drift: number | null = null;
  if (!options.offline) {
    [meta, changed, drift] = await Promise.all([
      repoMeta(ref).catch(() => null),
      lastCommitAt(ref, skill.source.path, skill.source.commitSha).catch(() => null),
      commitsSincePin(ref, skill.source.path, skill.source.commitSha).catch(() => null),
    ]);
  }
  const previousPath = join(HEALTH_DIR, `${skill.id}.json`);
  const previous = existsSync(previousPath) ? HealthRecord.parse(await readJson(previousPath)) : null;
  // Offline re-checks reuse the repository facts recorded last time.
  if (options.offline && previous?.commitSha === skill.source.commitSha) {
    changed = previous.metrics.lastCommitAt;
    drift = previous.metrics.commitsSincePin;
  }

  const result = runHealthChecks({
    dirName: posix.basename(skill.source.path) || ref.repo,
    files,
    repoFiles: new Set(all.map(file => file.path)),
    skillPath: skill.source.path,
    repoLicenseFile,
    // Offline, keep the repository license recorded last time rather than erasing it.
    repoLicenseSpdx: meta?.licenseSpdx ?? (options.offline ? previousRepoSpdx(skill) : null),
    archived: meta?.archived ?? previous?.repo.archived ?? null,
    lastCommitAt: changed,
    commitsSincePin: drift,
    checkedAt: previous && options.offline ? previous.repo.checkedAt : checkedAt,
  });
  // License is a fact of the pinned files, so the check keeps the record in step.
  if (JSON.stringify(skill.license) !== JSON.stringify(result.license)) {
    await writeJson(join(SKILLS_DIR, `${skill.id}.json`), SkillRecord.parse({ ...skill, license: result.license, updatedAt: checkedAt }));
  }
  const hash = resultHash(skill.id, skill.source.commitSha, result);
  if (previous && previous.resultHash === hash && !options.force) return { record: previous, changed: false };
  const record = HealthRecord.parse({
    schema: 'skillflux-health/v1',
    skillId: skill.id,
    commitSha: skill.source.commitSha,
    checkerVersion: CHECKER_VERSION,
    changedAt: checkedAt,
    resultHash: hash,
    checks: result.checks,
    metrics: result.metrics,
    repo: { stars: meta?.stars ?? previous?.repo.stars ?? null, archived: meta?.archived ?? previous?.repo.archived ?? null, checkedAt },
    flags: result.flags,
  });
  await writeJson(previousPath, record);
  return { record, changed: true };
}

export async function runHealth(options: HealthOptions = {}): Promise<void> {
  const skills = (await readJsonDir<unknown>(SKILLS_DIR)).map(value => SkillRecord.parse(value))
    .filter(skill => skill.status !== 'delisted')
    .filter(skill => !options.only?.length || options.only.includes(skill.id));
  let written = 0;
  for (const skill of skills) {
    try {
      const { record, changed } = await checkSkill(skill, options);
      if (changed) written += 1;
      const counts = ['pass', 'warn', 'fail'].map(status => record.checks.filter(item => item.status === status).length);
      console.log(`${changed ? 'updated' : 'same   '} ${skill.id}: ${counts[0]} pass · ${counts[1]} warn · ${counts[2]} fail${record.flags.length ? ` [${record.flags.join(', ')}]` : ''}`);
    } catch (error) {
      process.exitCode = 1;
      console.error(`failed  ${skill.id}: ${(error as Error).message}`);
    }
  }
  console.log(`${skills.length} skills checked, ${written} health records written.`);
}
