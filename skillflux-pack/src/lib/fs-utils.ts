import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function hashFileMap(files: Record<string, string>): string {
  return sha256(JSON.stringify(files));
}

export function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
  const normalized = path.split(/[/\\]/);
  return !normalized.some((part) => part === ".." || part === "");
}

export async function copyDirectory(
  sourceDir: string,
  targetDir: string,
): Promise<string[]> {
  const written: string[] = [];
  await mkdir(targetDir, { recursive: true });

  async function walk(currentSource: string, currentTarget: string): Promise<void> {
    const entries = await readdir(currentSource, { withFileTypes: true });
    for (const entry of entries) {
      const sourcePath = join(currentSource, entry.name);
      const targetPath = join(currentTarget, entry.name);
      if (entry.isDirectory()) {
        await mkdir(targetPath, { recursive: true });
        await walk(sourcePath, targetPath);
      } else if (entry.isFile()) {
        const content = await readFile(sourcePath);
        await writeFile(targetPath, content);
        written.push(targetPath);
      }
    }
  }

  await walk(sourceDir, targetDir);
  return written;
}

export async function writeFilesAtomically(
  targetRoot: string,
  files: Record<string, string>,
): Promise<string[]> {
  for (const relativePath of Object.keys(files)) {
    if (!isSafeRelativePath(relativePath)) {
      throw new Error(`Unsafe path rejected: ${relativePath}`);
    }
  }

  const parentDir = dirname(targetRoot);
  const tmpDir = join(parentDir, `.${basename(targetRoot)}.skillflux-${randomUUID()}`);
  const written: string[] = [];

  try {
    await mkdir(tmpDir, { recursive: true });

    for (const [relativePath, content] of Object.entries(files)) {
      const targetPath = join(tmpDir, relativePath);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content, "utf8");
      written.push(targetPath);
    }

    await rm(targetRoot, { recursive: true, force: true });
    await rename(tmpDir, targetRoot);

    return written.map((absolutePath) => join(targetRoot, relative(tmpDir, absolutePath)));
  } catch (error) {
    await rm(tmpDir, { recursive: true, force: true });
    throw error;
  }
}

export async function removeTrackedFiles(
  targetRoot: string,
  trackedRelativePaths: string[],
): Promise<void> {
  for (const relativePath of trackedRelativePaths) {
    if (!isSafeRelativePath(relativePath)) {
      throw new Error(`Unsafe path rejected: ${relativePath}`);
    }
    const targetPath = join(targetRoot, relativePath);
    await rm(targetPath, { force: true, recursive: true });
  }
}

export function toRelativePaths(root: string, absolutePaths: string[]): string[] {
  const resolvedRoot = resolve(root);
  return absolutePaths.map((absolutePath) => {
    const rel = relative(resolvedRoot, resolve(absolutePath));
    if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
      throw new Error(`Path escapes target root: ${absolutePath}`);
    }
    return rel.split(sep).join("/");
  });
}

export async function directoryExists(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}

export async function readTextFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}
