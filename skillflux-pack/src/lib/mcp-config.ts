import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface McpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface McpJson {
  mcpServers?: Record<string, McpServerEntry>;
}

function isENOENT(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export async function readMcpConfig(path: string): Promise<McpJson> {
  try {
    const raw = await readFile(path, "utf8");
    try {
      return JSON.parse(raw) as McpJson;
    } catch (parseError) {
      const detail =
        parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(
        `Failed to parse MCP config at ${path}: ${detail}. Fix the file manually before reinstalling.`,
      );
    }
  } catch (error) {
    if (isENOENT(error)) {
      return {};
    }
    throw error;
  }
}

export async function writeMcpConfig(path: string, data: McpJson): Promise<void> {
  await mkdir(dirname(path), { recursive: true });

  try {
    await readFile(path, "utf8");
    await copyFile(path, `${path}.bak`);
  } catch (error) {
    if (!isENOENT(error)) {
      throw error;
    }
  }

  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
