import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  hashFileMap,
  isSafeRelativePath,
  sha256,
  writeFilesAtomically,
} from "../src/lib/fs-utils.js";
import { readLockfile, upsertInstalledSkill } from "../src/lib/lockfile.js";
import {
  readProjectManifest,
  upsertProjectSkill,
} from "../src/lib/manifest.js";
import { readMcpConfig, writeMcpConfig } from "../src/lib/mcp-config.js";
import {
  computePayloadHash,
  filterPackSkills,
  loadPackManifest,
  verifySkillPayload,
} from "../src/lib/pack.js";
import {
  PROJECT_LOCKFILE,
  PROJECT_MANIFEST,
} from "../src/lib/project.js";

describe("fs-utils", () => {
  it("rejects path traversal", () => {
    expect(isSafeRelativePath("../etc/passwd")).toBe(false);
    expect(isSafeRelativePath("SKILL.md")).toBe(true);
  });

  it("hashes consistently", () => {
    expect(sha256("hello")).toHaveLength(64);
  });

  it("writes files atomically into target directory", async () => {
    const base = await mkdtemp(join(tmpdir(), "skillflux-atomic-"));
    const target = join(base, "demo-skill");

    const written = await writeFilesAtomically(target, {
      "SKILL.md": "# demo",
      "references/note.md": "hello",
    });

    expect(written).toHaveLength(2);
    expect(await readFile(join(target, "SKILL.md"), "utf8")).toBe("# demo");
    await rm(base, { recursive: true, force: true });
  });
});

describe("project manifest + lockfile", () => {
  it("writes skillflux.json and project lockfile on install", async () => {
    const base = await mkdtemp(join(tmpdir(), "skillflux-project-"));
    const originalCwd = process.cwd();

    try {
      process.chdir(base);
      await upsertProjectSkill("demo-skill", "0.1.0", base);
      await upsertInstalledSkill(
        "demo-skill",
        {
          version: "0.1.0",
          scope: "project",
          path: ".skillflux/skills/demo-skill",
          sha256: "abc",
          files: ["SKILL.md"],
        },
        base,
      );

      const manifest = await readProjectManifest(base);
      expect(manifest.skills["demo-skill"]).toBe("^0.1.0");

      const lockfile = await readLockfile(base);
      expect(lockfile.skills["demo-skill"].path).toBe(".skillflux/skills/demo-skill");

      expect(await readFile(join(base, PROJECT_MANIFEST), "utf8")).toContain("demo-skill");
      expect(await readFile(join(base, PROJECT_LOCKFILE), "utf8")).toContain("demo-skill");
    } finally {
      process.chdir(originalCwd);
      await rm(base, { recursive: true, force: true });
    }
  });
});

describe("mcp-config", () => {
  it("returns empty object when file is missing", async () => {
    const base = await mkdtemp(join(tmpdir(), "skillflux-mcp-"));
    const config = await readMcpConfig(join(base, "missing.json"));
    expect(config).toEqual({});
    await rm(base, { recursive: true, force: true });
  });

  it("throws on invalid JSON instead of silently clearing", async () => {
    const base = await mkdtemp(join(tmpdir(), "skillflux-mcp-"));
    const path = join(base, "mcp.json");
    await writeFile(path, "{ not json", "utf8");

    await expect(readMcpConfig(path)).rejects.toThrow(/Failed to parse MCP config/);
    await rm(base, { recursive: true, force: true });
  });

  it("creates .bak before overwriting existing config", async () => {
    const base = await mkdtemp(join(tmpdir(), "skillflux-mcp-"));
    const path = join(base, "mcp.json");
    await writeFile(path, '{"mcpServers":{"old":{}}}\n', "utf8");

    await writeMcpConfig(path, { mcpServers: { skillflux: { command: "node" } } });

    const backup = await readFile(`${path}.bak`, "utf8");
    expect(backup).toContain("old");
    await rm(base, { recursive: true, force: true });
  });
});

describe("restore project skills", () => {
  it("installs skills declared in skillflux.json", async () => {
    const base = await mkdtemp(join(tmpdir(), "skillflux-restore-"));
    const originalCwd = process.cwd();

    try {
      process.chdir(base);
      await writeFile(
        join(base, PROJECT_MANIFEST),
        `${JSON.stringify(
          {
            schemaVersion: "2026-06-25",
            skills: { "demo-skill": "^0.1.0" },
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const { restoreProjectSkills } = await import("../src/mcp/skill-service.js");
      const result = await restoreProjectSkills("project", base);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.restored).toHaveLength(1);
      expect(result.data.restored[0].id).toBe("demo-skill");
      expect(await readFile(join(base, ".skillflux/skills/demo-skill/SKILL.md"), "utf8")).toContain(
        "demo",
      );
    } finally {
      process.chdir(originalCwd);
      await rm(base, { recursive: true, force: true });
    }
  });
});

describe("pack manifest", () => {
  it("loads bundled pack.json", async () => {
    const manifest = await loadPackManifest();
    expect(manifest.name).toBe("skillflux/deluxe-pack");
    expect(manifest.skills.length).toBe(5);
  });

  it("filters skills by query", async () => {
    const manifest = await loadPackManifest();
    const results = filterPackSkills(manifest, "demo");
    expect(results.some((skill) => skill.id === "demo-skill")).toBe(true);
  });

  it("verifies payload sha256", () => {
    const files = { "SKILL.md": "hello" };
    const payload = {
      id: "demo",
      version: "1.0.0",
      sha256: computePayloadHash(files),
      files,
    };
    expect(() => verifySkillPayload(payload)).not.toThrow();
    expect(() =>
      verifySkillPayload({ ...payload, sha256: hashFileMap({ "SKILL.md": "changed" }) }),
    ).toThrow(/checksum mismatch/);
  });
});
