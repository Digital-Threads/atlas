import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import type { ScannedFile } from "../core/types.js";

const ignoredDirectories = new Set([
  "node_modules", "dist", "build", ".git", "coverage", ".atlas", ".next", ".nuxt",
  ".cache", "tmp", "logs", ".turbo", ".idea", ".vscode",
]);
const supportedExtensions = new Set([".ts", ".js", ".json", ".yml", ".yaml", ".prisma"]);

export interface FileScanResult {
  files: ScannedFile[];
  ignored: number;
}

export async function scanFiles(projectRoot: string): Promise<FileScanResult> {
  const root = resolve(projectRoot);
  const files: ScannedFile[] = [];
  let ignored = 0;

  async function walk(directory: string, isRoot = false): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isRoot) throw new Error(`Cannot read project directory: ${root}`, { cause: error });
      ignored += 1;
      return;
    }
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) {
        ignored += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) {
          ignored += 1;
        } else {
          await walk(absolutePath);
        }
        continue;
      }
      const extension = extname(entry.name).toLowerCase();
      const isEnv = entry.name === ".env" || entry.name.startsWith(".env.");
      if (!supportedExtensions.has(extension) && !isEnv) {
        ignored += 1;
        continue;
      }
      try {
        const fileStat = await stat(absolutePath);
        const hash = isEnv ? undefined : createHash("sha256").update(await readFile(absolutePath)).digest("hex");
        files.push({
          absolutePath,
          path: relative(root, absolutePath).replaceAll("\\", "/"),
          extension: isEnv ? ".env" : extension,
          size: fileStat.size,
          hash,
          lastModified: fileStat.mtime.toISOString(),
        });
      } catch {
        ignored += 1;
      }
    }
  }

  await walk(root, true);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, ignored };
}
