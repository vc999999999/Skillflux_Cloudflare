// Pure validation and derivation over skill, health and benchmark data. The
// build loader and scripts/validate-data.ts both call validateSkillData, so a
// broken record fails `npm run validate` and the Astro build alike.
import { HealthRecord, RunRecord, SkillRecord, type ArmSummary } from '@skillflux/bench/schema';
import { summarizeSkill } from '@skillflux/bench/summarize';
import { z } from 'zod';

export const SkillCategory = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  label: z.object({ en: z.string().min(1), zh: z.string().min(1) }),
  description: z.object({ en: z.string().min(1), zh: z.string().min(1) }),
});
export type SkillCategory = z.infer<typeof SkillCategory>;

export interface SkillData {
  skills: SkillRecord[];
  health: HealthRecord[];
  runs: RunRecord[];
  categories: SkillCategory[];
}

const DRAFT_SUMMARY = /^Draft:/;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Parses raw JSON and checks every cross-file reference. Throws one combined error. */
export function validateSkillData(raw: { skills: unknown[]; health: unknown[]; runs: unknown[]; categories: unknown[] }, siteSlugs: Set<string>): SkillData {
  const errors: string[] = [];
  const parse = <T>(schema: z.ZodType<T>, value: unknown, label: string): T | null => {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    errors.push(`${label}: ${result.error.issues.map(issue => `${issue.path.join('.') || '(root)'} ${issue.message}`).join('; ')}`);
    return null;
  };
  const categories = raw.categories.map((value, index) => parse(SkillCategory, value, `skill-categories[${index}]`)).filter(item => item !== null);
  const skills = raw.skills.map((value, index) => parse(SkillRecord, value, `skills/${(value as { id?: string })?.id ?? index}`)).filter(item => item !== null);
  const health = raw.health.map((value, index) => parse(HealthRecord, value, `health/${(value as { skillId?: string })?.skillId ?? index}`)).filter(item => item !== null);
  const runs = raw.runs.map((value, index) => parse(RunRecord, value, `benchmarks/runs/${(value as { runId?: string })?.runId ?? index}`)).filter(item => item !== null);

  const categorySlugs = new Set(categories.map(category => category.slug));
  const ids = new Set<string>();
  for (const skill of skills) {
    if (ids.has(skill.id)) errors.push(`skills/${skill.id}: duplicate id`);
    ids.add(skill.id);
    if (!siteSlugs.has(skill.sourceSiteSlug)) errors.push(`skills/${skill.id}: sourceSiteSlug "${skill.sourceSiteSlug}" is not in sites.json`);
    if (!categorySlugs.has(skill.category)) errors.push(`skills/${skill.id}: category "${skill.category}" is not in skill-categories.json`);
    if (skill.status !== 'draft' && (DRAFT_SUMMARY.test(skill.summary.en) || skill.summary.en.length < 60 || skill.summary.zh.length < 20)) {
      errors.push(`skills/${skill.id}: a ${skill.status} skill needs a real bilingual summary`);
    }
  }
  const bySkill = new Map(skills.map(skill => [skill.id, skill]));
  for (const record of health) {
    const skill = bySkill.get(record.skillId);
    if (!skill) errors.push(`health/${record.skillId}: no matching skill record`);
  }
  const runIds = new Set(runs.map(run => run.runId));
  for (const run of runs) {
    if (run.supersedes && !runIds.has(run.supersedes)) errors.push(`runs/${run.runId}: supersedes unknown run ${run.supersedes}`);
    if (run.supersededBy && !runIds.has(run.supersededBy)) errors.push(`runs/${run.runId}: supersededBy unknown run ${run.supersededBy}`);
    const totalCost = run.trials.reduce((sum, trial) => sum + trial.costUsd, 0);
    if (Math.abs(totalCost - run.totals.costUsd) > 0.01) errors.push(`runs/${run.runId}: totals.costUsd does not equal the sum of trial costs`);
    if (run.totals.trials !== run.trials.length) errors.push(`runs/${run.runId}: totals.trials does not equal the number of trials`);
    for (const result of run.skills) {
      if (!bySkill.has(result.skillId)) errors.push(`runs/${run.runId}: unknown skill ${result.skillId}`);
      // Every published number must follow from the trials.
      const recomputed = summarizeSkill(result.skillId, result.commitSha, result.tasks.map(({ taskId, taskVersion, taskSha256, kind, title, prompt, checks }) => ({ taskId, taskVersion, taskSha256, kind, title, prompt, checks })), run.trials);
      if (canonical(recomputed) !== canonical(result)) errors.push(`runs/${run.runId}: summary for ${result.skillId} does not match its trials`);
    }
  }
  if (errors.length) throw new Error(`Skill data validation failed (${errors.length}):\n- ${errors.join('\n- ')}`);
  return { skills, health, runs, categories };
}

export interface SkillView {
  skill: SkillRecord;
  health: HealthRecord | null;
  /** Health computed for a different commit than the one now pinned. */
  healthStale: boolean;
  category: SkillCategory;
  result: { run: RunRecord; skill: RunRecord['skills'][number] } | null;
  counts: { pass: number; warn: number; fail: number; info: number };
  indexable: boolean;
  dateModified: string;
}

export function buildSkillViews(data: SkillData): SkillView[] {
  const health = new Map(data.health.map(record => [record.skillId, record]));
  const categories = new Map(data.categories.map(category => [category.slug, category]));
  const published = data.runs.filter(run => run.status === 'published').sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.runId.localeCompare(a.runId));
  return data.skills.map(skill => {
    const record = health.get(skill.id) ?? null;
    const run = published.find(item => item.skills.some(result => result.skillId === skill.id)) ?? null;
    const result = run ? { run, skill: run.skills.find(item => item.skillId === skill.id)! } : null;
    const counts = { pass: 0, warn: 0, fail: 0, info: 0 };
    for (const check of record?.checks ?? []) counts[check.status] += 1;
    const healthStale = Boolean(record && record.commitSha !== skill.source.commitSha);
    const dates = [skill.updatedAt, record?.changedAt, result?.run.publishedAt].filter((value): value is string => Boolean(value));
    return {
      skill,
      health: record,
      healthStale,
      category: categories.get(skill.category)!,
      result,
      counts,
      indexable: skill.status !== 'draft' && skill.status !== 'delisted' && Boolean(record) && !healthStale,
      dateModified: dates.sort().at(-1)!,
    };
  }).sort((a, b) => a.skill.id.localeCompare(b.skill.id));
}

export const pct = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
export const ci = (interval: [number, number] | null | undefined) => interval ? `${Math.round(interval[0] * 100)}–${Math.round(interval[1] * 100)}%` : '—';
export const signedPoints = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${Math.round(value * 100)} pts`;
export const usd = (value: number | null | undefined) => value === null || value === undefined ? '—' : `$${value.toFixed(value < 1 ? 3 : 2)}`;
export const seconds = (ms: number | null | undefined) => ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(0)} s`;
export const shortSha = (sha: string) => sha.slice(0, 7);

export function armLine(arm: ArmSummary, lang: 'en' | 'zh'): string {
  const rate = `${arm.passes}/${arm.n}`;
  return lang === 'zh' ? `${rate}（${pct(arm.passRate)}，95% CI ${ci(arm.wilson95)}）` : `${rate} (${pct(arm.passRate)}, 95% CI ${ci(arm.wilson95)})`;
}

/**
 * The first sentence of a report page. Deterministic: it is filled from data,
 * never written by a model, so a citation always matches the numbers.
 */
export function keyFinding(view: SkillView, lang: 'en' | 'zh'): string {
  const { skill, health, result, counts } = view;
  const name = skill.displayName[lang];
  if (result) {
    const { run, skill: res } = result;
    const env = run.environment;
    const pooled = res.pooled;
    const verdictText = {
      improves: lang === 'zh' ? '通过率显著更高' : 'a higher pass rate',
      hurts: lang === 'zh' ? '通过率显著更低' : 'a lower pass rate',
      'no-detectable-difference': lang === 'zh' ? '与不装 Skill 相比没有可检测的差异' : 'no detectable difference from running without it',
    }[pooled.comparison.verdict ?? 'no-detectable-difference'];
    return lang === 'zh'
      ? `在 SkillFlux 测试批次 ${run.runId}（方法论 v${run.methodologyVersion}，${env.modelRequested}，Claude Code ${env.claudeCodeVersion}）中，${name}装上后任务通过 ${armLine(pooled.with, 'zh')}，不装时通过 ${armLine(pooled.without, 'zh')}，结论为${verdictText}；Skill 在 ${pooled.with.triggered}/${pooled.with.n} 次运行中被调用，单次成本中位数 ${usd(pooled.with.medianCostUsd)}，不装时为 ${usd(pooled.without.medianCostUsd)}。`
      : `In SkillFlux run ${run.runId} (methodology v${run.methodologyVersion}, ${env.modelRequested}, Claude Code ${env.claudeCodeVersion}), tasks passed ${armLine(pooled.with, 'en')} with ${name} installed versus ${armLine(pooled.without, 'en')} without it — ${verdictText}; the skill was invoked in ${pooled.with.triggered} of ${pooled.with.n} runs, at a median cost of ${usd(pooled.with.medianCostUsd)} per run versus ${usd(pooled.without.medianCostUsd)}.`;
  }
  if (!health) return lang === 'zh' ? `${name} 尚未完成 SkillFlux 体检。` : `${name} has not been health-checked by SkillFlux yet.`;
  const total = health.checks.length;
  return lang === 'zh'
    ? `截至 ${health.changedAt}，SkillFlux 对${name}（提交 ${shortSha(health.commitSha)}）的 ${total} 项静态体检结果为 ${counts.pass} 项通过、${counts.warn} 项警告、${counts.fail} 项失败、${counts.info} 项仅作提示；该 Skill 尚未进行实测对照。`
    : `As of ${health.changedAt}, SkillFlux's static health check of ${name} at commit ${shortSha(health.commitSha)} recorded ${counts.pass} passes, ${counts.warn} warnings and ${counts.fail} failures, plus ${counts.info} informational results, across ${total} checks; it has not been benchmarked yet.`;
}

export interface AggregateFinding { id: string; count: number; total: number; en: string; zh: string }

/** Counts across published skills, phrased so each line can be quoted on its own. */
export function aggregateFindings(views: SkillView[]): AggregateFinding[] {
  const checked = views.filter(view => view.health);
  const total = checked.length;
  const flag = (name: string) => checked.filter(view => view.health!.flags.includes(name as never)).length;
  const status = (id: string, value: string) => checked.filter(view => view.health!.checks.some(item => item.id === id && item.status === value)).length;
  const items: Array<Omit<AggregateFinding, 'total'>> = [
    { id: 'executes-code', count: flag('executes-code'), en: 'bundle scripts that the agent may run', zh: '附带 Agent 可能执行的脚本' },
    { id: 'network-calls', count: flag('network-calls'), en: 'include scripts that call the network', zh: '包含会访问网络的脚本' },
    { id: 'no-trigger', count: status('frontmatter.descriptionTrigger', 'warn'), en: 'have a description that does not say when to use the skill', zh: '的 description 没有说明何时使用' },
    { id: 'large-body', count: status('body.tokensApprox', 'warn'), en: 'exceed the 5,000-token guideline for the SKILL.md body', zh: '的 SKILL.md 正文超过 5000 token 的建议上限' },
    { id: 'no-license', count: flag('no-license'), en: 'have no license that we could find', zh: '找不到任何许可证' },
    { id: 'any-fail', count: checked.filter(view => view.counts.fail > 0).length, en: 'fail at least one check', zh: '至少有一项检查失败' },
  ];
  return items.map(item => ({ ...item, total }));
}
