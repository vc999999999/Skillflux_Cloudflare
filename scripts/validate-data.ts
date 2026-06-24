import { getDirectoryStats, validateCatalog } from "../src/lib/content";

const catalog = validateCatalog();
const stats = getDirectoryStats();

console.log(
  `Validated ${catalog.sites.length} SkillFlux resources across ${stats.labelCount} labels. Updated ${stats.updatedAt}.`
);
