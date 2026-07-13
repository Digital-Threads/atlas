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

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
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
      const [content, fileStat] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
      files.push({
        absolutePath,
        path: relative(root, absolutePath).replaceAll("\\", "/"),
        extension: isEnv ? ".env" : extension,
        size: fileStat.size,
        hash: createHash("sha256").update(content).digest("hex"),
        lastModified: fileStat.mtime.toISOString(),
      });
    }
  }

  await walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, ignored };
}
