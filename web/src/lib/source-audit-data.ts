// Validation for sampled source audits (web/data/source-audits/*.json).
// Pure so the build script, the site and tests share it.
import { SourceAudit, summarizeAudit } from '@skillflux/bench/schema';

export function validateSourceAudits(raw: unknown[], siteSlugs: Set<string>): SourceAudit[] {
  const errors: string[] = [];
  const audits: SourceAudit[] = [];
  const seen = new Set<string>();
  for (const [index, value] of raw.entries()) {
    const label = `source-audits/${(value as { siteSlug?: string })?.siteSlug ?? index}`;
    const parsed = SourceAudit.safeParse(value);
    if (!parsed.success) {
      errors.push(`${label}: ${parsed.error.issues.map(issue => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('; ')}`);
      continue;
    }
    const audit = parsed.data;
    if (!siteSlugs.has(audit.siteSlug)) errors.push(`${label}: siteSlug is not in sites.json`);
    if (seen.has(audit.siteSlug)) errors.push(`${label}: duplicate audit`);
    seen.add(audit.siteSlug);
    if (JSON.stringify(summarizeAudit(audit.items)) !== JSON.stringify(audit.summary)) errors.push(`${label}: summary does not match its items`);
    if (audit.items.length > audit.sample.requested) errors.push(`${label}: more items than the requested sample`);
    audits.push(audit);
  }
  if (errors.length) throw new Error(`Source audit data is invalid:\n${errors.map(error => `  - ${error}`).join('\n')}`);
  return audits.sort((a, b) => a.siteSlug.localeCompare(b.siteSlug));
}

export type ScoreLine = { id: keyof SourceAudit['summary']; count: number; of: number; en: string; zh: string };

/** The scorecard lines shown on a source page, each a count out of the checked sample. */
export function scorecard(audit: SourceAudit): ScoreLine[] {
  const s = audit.summary;
  const lines: Array<Omit<ScoreLine, 'count' | 'of'> & { count: number; of?: number }> = [
    { id: 'checked', count: s.checked, of: s.sampled, en: 'sampled entries had a SKILL.md we could check', zh: '个抽样条目有可检查的 SKILL.md' },
    { id: 'failingAnyCheck', count: s.failingAnyCheck, en: 'fail at least one check', zh: '至少一项检查失败' },
    { id: 'missingTrigger', count: s.missingTrigger, en: 'do not say when to use the skill', zh: '的 description 没说明何时使用' },
    { id: 'noLicense', count: s.noLicense, en: 'have no license we could find', zh: '找不到许可证' },
    { id: 'withScripts', count: s.withScripts, en: 'bundle scripts the agent may run', zh: '附带 Agent 可能执行的脚本' },
    { id: 'networkCalls', count: s.networkCalls, en: 'include scripts that call the network', zh: '包含会访问网络的脚本' },
    { id: 'destructiveCommands', count: s.destructiveCommands, en: 'include destructive shell commands', zh: '包含破坏性命令' },
    { id: 'overTokenBudget', count: s.overTokenBudget, en: 'exceed the 5,000-token body guideline', zh: '正文超过 5000 token 建议上限' },
  ];
  return lines.map(line => ({ ...line, of: line.of ?? s.checked }));
}
