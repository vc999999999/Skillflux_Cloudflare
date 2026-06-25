import { readFile, writeFile } from "node:fs/promises";
import {
  PROJECT_MANIFEST,
  SKILLFLUX_SCHEMA_VERSION,
  ensureProjectSkillfluxDir,
  projectManifestPath,
} from "./project.js";

export interface ProjectManifest {
  schemaVersion: string;
  skills: Record<string, string>;
}

export async function readProjectManifest(cwd = process.cwd()): Promise<ProjectManifest> {
  try {
    const raw = await readFile(projectManifestPath(cwd), "utf8");
    return JSON.parse(raw) as ProjectManifest;
  } catch (error) {
    if (isENOENT(error)) {
      return { schemaVersion: SKILLFLUX_SCHEMA_VERSION, skills: {} };
    }
    throw error;
  }
}

export async function writeProjectManifest(
  manifest: ProjectManifest,
  cwd = process.cwd(),
): Promise<void> {
  await ensureProjectSkillfluxDir(cwd);
  await writeFile(
    projectManifestPath(cwd),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

export async function upsertProjectSkill(
  id: string,
  version: string,
  cwd = process.cwd(),
): Promise<ProjectManifest> {
  const manifest = await readProjectManifest(cwd);
  manifest.schemaVersion = SKILLFLUX_SCHEMA_VERSION;
  manifest.skills[id] = `^${version}`;
  await writeProjectManifest(manifest, cwd);
  return manifest;
}

export async function removeProjectSkill(id: string, cwd = process.cwd()): Promise<ProjectManifest> {
  const manifest = await readProjectManifest(cwd);
  delete manifest.skills[id];
  await writeProjectManifest(manifest, cwd);
  return manifest;
}

function isENOENT(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
