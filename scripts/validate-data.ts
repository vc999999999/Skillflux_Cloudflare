import { getDirectoryStats, validateCatalog } from "../src/lib/content";

const catalog = validateCatalog();
const stats = getDirectoryStats();

console.log(
  `Validated ${catalog.sites.length} SkillFlux resources across ${catalog.categories.length} categories. Updated ${stats.updatedAt}.`
);
