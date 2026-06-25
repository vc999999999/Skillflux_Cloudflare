import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const packPath = join(root, "pack.json");

function hashFiles(files) {
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

async function loadSkillFiles(skillId) {
  const skillRoot = join(root, "skills", skillId);
  const files = {};
  const entries = await readdir(skillRoot, { withFileTypes: true, recursive: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const fullPath = join(entry.parentPath ?? entry.path, entry.name);
    const relativePath = fullPath.slice(skillRoot.length + 1).split("\\").join("/");
    files[relativePath] = await readFile(fullPath, "utf8");
  }

  return files;
}

const pack = JSON.parse(await readFile(packPath, "utf8"));

for (const skill of pack.skills) {
  const files = await loadSkillFiles(skill.id);
  skill.sha256 = hashFiles(files);
  console.log(`Updated ${skill.id} sha256: ${skill.sha256}`);
}

pack.updatedAt = new Date().toISOString().slice(0, 10);
await writeFile(packPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
console.log(`Synced ${pack.skills.length} skill hash(es) in pack.json`);
