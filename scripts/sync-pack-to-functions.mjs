import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packRoot = join(repoRoot, "skillflux-pack");
const packJsonPath = join(packRoot, "pack.json");
const skillsRoot = join(packRoot, "skills");
const outPath = join(repoRoot, "functions", "_pack", "catalog.json");

function hashFiles(files) {
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

async function loadSkillFiles(skillId) {
  const skillDir = join(skillsRoot, skillId);
  const files = {};
  const entries = await readdir(skillDir, { withFileTypes: true, recursive: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = join(entry.parentPath ?? entry.path, entry.name);
    const relativePath = fullPath.slice(skillDir.length + 1).split("\\").join("/");
    files[relativePath] = await readFile(fullPath, "utf8");
  }

  return files;
}

const manifest = JSON.parse(await readFile(packJsonPath, "utf8"));
const skills = {};

for (const skill of manifest.skills) {
  const files = await loadSkillFiles(skill.id);
  const sha256 = hashFiles(files);
  if (skill.sha256 !== sha256) {
    throw new Error(
      `${skill.id}: sha256 out of date (${skill.sha256} != ${sha256}). Run: cd skillflux-pack && npm run sync:hash`,
    );
  }
  skills[skill.id] = {
    id: skill.id,
    version: skill.version,
    sha256,
    files,
  };
}

const catalog = {
  manifest,
  skills,
  generatedAt: new Date().toISOString(),
};

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(catalog)}\n`, "utf8");
console.log(
  `Generated functions/_pack/catalog.json (${manifest.skills.length} skills, pack ${manifest.packVersion})`,
);
