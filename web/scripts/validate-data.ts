import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDirectoryStats, validateCatalog } from "../src/lib/content";
import { buildSkillViews, validateSkillData } from "../src/lib/skill-data";
import { getHomePicks } from "../src/lib/home-picks";
import { validateSourceAudits } from "../src/lib/source-audit-data";

const catalog = validateCatalog();
const stats = getDirectoryStats();
getHomePicks();

console.log(
  `Validated ${catalog.sites.length} SkillFlux resources across ${stats.labelCount} labels. Updated ${stats.updatedAt}.`
);

const dataDir = resolve(import.meta.dirname, "../data");
const readDir = (dir: string) => {
  const path = join(dataDir, dir);
  try {
    return readdirSync(path).filter(name => name.endsWith(".json") && !name.startsWith("_")).sort()
      .map(name => JSON.parse(readFileSync(join(path, name), "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};
const skillData = validateSkillData({
  skills: readDir("skills"),
  health: readDir("health"),
  runs: readDir("benchmarks/runs"),
  categories: JSON.parse(readFileSync(join(dataDir, "skill-categories.json"), "utf8")) as unknown[],
}, new Set(catalog.sites.map(site => site.slug)));
const views = buildSkillViews(skillData);
console.log(
  `Validated ${skillData.skills.length} skills (${views.filter(view => view.indexable).length} published), ${skillData.health.length} health records and ${skillData.runs.length} benchmark runs; every run summary matches its trials.`
);

const audits = validateSourceAudits(readDir("source-audits"), new Set(catalog.sites.map(site => site.slug)));
console.log(`Validated ${audits.length} source audits (${audits.reduce((sum, audit) => sum + audit.summary.sampled, 0)} sampled entries); every summary matches its items.`);
