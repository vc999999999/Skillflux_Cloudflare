import { restoreProjectSkills } from "../mcp/skill-service.js";
import type { InstallScope } from "../lib/paths.js";

export interface RestoreOptions {
  scope?: InstallScope;
  cwd?: string;
}

export async function runRestore(options: RestoreOptions = {}): Promise<string[]> {
  const notes: string[] = [];
  const result = await restoreProjectSkills(options.scope, options.cwd ?? process.cwd());

  if (!result.ok) {
    notes.push(result.message);
    return notes;
  }

  notes.push(result.message);
  for (const item of result.data.restored) {
    notes.push(`  restored ${item.id}@${item.version} -> ${item.path}`);
  }
  for (const item of result.data.failed) {
    notes.push(`  failed ${item.id} (${item.code}): ${item.message}`);
  }
  return notes;
}
