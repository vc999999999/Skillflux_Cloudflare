import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const packPath = join(root, "pack.json");

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

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

  if (!files["SKILL.md"]) {
    throw new Error(`${skillId}: missing SKILL.md`);
  }

  return files;
}

function parseSkillName(skillMd) {
  if (!skillMd.startsWith("---")) return undefined;
  const match = skillMd.match(/^name:\s*([a-z0-9-]+)\s*$/m);
  return match?.[1];
}

const pack = JSON.parse(await readFile(packPath, "utf8"));
const seenIds = new Set();

if (!pack.name || !pack.packVersion || !Array.isArray(pack.skills)) {
  throw new Error("pack.json: invalid manifest shape");
}

for (const skill of pack.skills) {
  if (seenIds.has(skill.id)) {
    throw new Error(`Duplicate skill id: ${skill.id}`);
  }
  seenIds.add(skill.id);

  if (skill.id !== skill.path.split("/").pop()) {
    throw new Error(`${skill.id}: path folder mismatch (${skill.path})`);
  }

  if (!SEMVER.test(skill.version)) {
    throw new Error(`${skill.id}: invalid semver ${skill.version}`);
  }

  const skillRoot = join(root, skill.path);
  await access(skillRoot);

  const files = await loadSkillFiles(skill.id);
  const computed = hashFiles(files);
  if (skill.sha256 !== computed) {
    throw new Error(
      `${skill.id}: sha256 mismatch (expected ${skill.sha256}, got ${computed}). Run npm run sync:hash`,
    );
  }

  const frontmatterName = parseSkillName(files["SKILL.md"]);
  if (frontmatterName !== skill.id) {
    throw new Error(
      `${skill.id}: SKILL.md name '${frontmatterName}' does not match id`,
    );
  }

  if (!skill.description?.trim()) {
    throw new Error(`${skill.id}: description is required`);
  }
}

console.log(`Validated pack ${pack.name}@${pack.packVersion} (${pack.skills.length} skills)`);
