// Build-time loader for skill, health and benchmark data. import.meta.glob
// reads every JSON file under web/data at build time.
import sites from '../../data/sites.json';
import skillCategories from '../../data/skill-categories.json';
import { buildSkillViews, validateSkillData, type SkillData, type SkillView } from './skill-data';

const load = (files: Record<string, { default: unknown }>) => Object.keys(files).sort().map(key => files[key]!.default);

let cache: { data: SkillData; views: SkillView[] } | null = null;

function state() {
  if (!cache) {
    const data = validateSkillData({
      skills: load(import.meta.glob('../../data/skills/*.json', { eager: true })),
      health: load(import.meta.glob('../../data/health/*.json', { eager: true })),
      runs: load(import.meta.glob('../../data/benchmarks/runs/*.json', { eager: true })),
      categories: skillCategories,
    }, new Set(sites.map(site => site.slug)));
    cache = { data, views: buildSkillViews(data) };
  }
  return cache;
}

export function getSkillData(): SkillData { return state().data; }
export function getSkillViews(): SkillView[] { return state().views; }
export function getIndexableSkillViews(): SkillView[] { return state().views.filter(view => view.indexable); }
export function getSkillView(id: string): SkillView | undefined { return state().views.find(view => view.skill.id === id); }
export function getRuns() { return [...state().data.runs].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.runId.localeCompare(a.runId)); }
export function getSkillCategories() { return state().data.categories; }
export function getBenchmarkedViews(): SkillView[] { return getIndexableSkillViews().filter(view => view.result); }

export function skillsForSite(siteSlug: string): SkillView[] {
  return getIndexableSkillViews().filter(view => view.skill.sourceSiteSlug === siteSlug);
}
