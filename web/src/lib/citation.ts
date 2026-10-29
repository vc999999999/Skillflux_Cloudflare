import { SITE } from '../config';
import { absoluteUrl } from './content';
import { shortSha, type SkillView } from './skill-data';

/** Citations point at the immutable record: the run when there is one, else the pinned commit. */
export function citationText(view: SkillView, lang: 'en' | 'zh'): string {
  const { skill, result, health } = view;
  const url = absoluteUrl(`/skills/${skill.id}/`);
  if (result) {
    return lang === 'zh'
      ? `SkillFlux（${result.run.publishedAt}）。《${skill.displayName.zh} 实测》，测试批次 ${result.run.runId}，方法论 v${result.run.methodologyVersion}。${url}`
      : `SkillFlux (${result.run.publishedAt}). ${skill.displayName.en} benchmark, run ${result.run.runId}, methodology v${result.run.methodologyVersion}. ${url}`;
  }
  const date = health?.changedAt ?? skill.updatedAt;
  return lang === 'zh'
    ? `SkillFlux（${date}）。《${skill.displayName.zh} 体检报告》，提交 ${shortSha(skill.source.commitSha)}，检查器 ${health?.checkerVersion ?? '—'}。${url}`
    : `SkillFlux (${date}). ${skill.displayName.en} health check, commit ${shortSha(skill.source.commitSha)}, checker ${health?.checkerVersion ?? '—'}. ${url}`;
}

export function citationBibtex(view: SkillView): string {
  const { skill, result, health } = view;
  const date = result?.run.publishedAt ?? health?.changedAt ?? skill.updatedAt;
  const key = `skillflux_${skill.id.replaceAll('-', '_')}_${date.replaceAll('-', '')}`;
  const title = result ? `${skill.displayName.en} benchmark (run ${result.run.runId})` : `${skill.displayName.en} health check (commit ${shortSha(skill.source.commitSha)})`;
  return [
    `@misc{${key},`,
    `  author = {{${SITE.name}}},`,
    `  title = {${title}},`,
    `  year = {${date.slice(0, 4)}},`,
    `  month = {${Number(date.slice(5, 7))}},`,
    `  howpublished = {\\url{${absoluteUrl(`/skills/${skill.id}/`)}}},`,
    `  note = {Methodology v${result?.run.methodologyVersion ?? '1'}. Data: ${absoluteUrl(`/data/skills/${skill.id}.json`)}. Accessed ${date}.},`,
    '}',
  ].join('\n');
}
