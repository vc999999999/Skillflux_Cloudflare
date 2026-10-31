// Runs source audits for every target listed in
// web/data/source-audit-targets.json. Sources that are not GitHub
// repositories (most marketplaces) have no target and are not audited.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { WEB_DATA, readJson } from '../paths.js';
import { AUDITS_DIR, auditSource } from './run-audit.js';

export const TARGETS_FILE = join(WEB_DATA, 'source-audit-targets.json');

export const AuditTarget = z.object({
  site: z.string().min(1),
  repo: z.string().regex(/^https:\/\/github\.com\/[^/]+\/[^/]+$/),
  method: z.enum(['repo', 'list']),
});

export async function auditTargets(options: { missingOnly?: boolean; only?: string[]; sampleSize?: number }): Promise<void> {
  const targets = z.array(AuditTarget).parse(await readJson(TARGETS_FILE))
    .filter(target => !options.only?.length || options.only.includes(target.site))
    .filter(target => !options.missingOnly || !existsSync(join(AUDITS_DIR, `${target.site}.json`)));
  for (const target of targets) {
    console.log(`${target.site} (${target.method}) ${target.repo}`);
    try {
      const audit = await auditSource({ siteSlug: target.site, repo: target.repo, method: target.method, sampleSize: options.sampleSize });
      const s = audit.summary;
      console.log(`→ ${s.checked}/${s.sampled} checked, ${s.noSkill} no skill, ${s.unreachable} unreachable\n`);
    } catch (error) {
      process.exitCode = 1;
      console.error(`→ failed: ${(error as Error).message}\n`);
    }
  }
}
