import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import createIgnore from "ignore";
import type { ScannedFile } from "../core/types.js";

const ignoredDirectories = new Set([
  "node_modules", "dist", "build", ".git", "coverage", ".atlas", ".next", ".nuxt",
  ".cache", "tmp", ".tmp", "temp", ".temp", "logs", ".turbo", ".idea", ".vscode",
  ".worktrees", "worktrees", ".pnpm-store", ".yarn", ".nx", ".angular", ".svelte-kit",
  ".output", ".serverless", ".aws-sam", ".parcel-cache", ".vercel", "storybook-static",
]);
const supportedExtensions = new Set([".ts", ".js", ".json", ".yml", ".yaml", ".prisma"]);

export interface FileScanResult {
  files: ScannedFile[];
  ignored: number;
}

export interface FileScanOptions {
  ignoredPaths?: string[];
}

export async function scanFiles(projectRoot: string, options: FileScanOptions = {}): Promise<FileScanResult> {
  const root = resolve(projectRoot);
  const files: ScannedFile[] = [];
  const ignoreRules = createIgnore();
  let ignored = 0;
  const gitignore = await readFile(resolve(root, ".gitignore"), "utf8").catch(() => "");
  if (gitignore) ignoreRules.add(gitignore);
  for (const path of options.ignoredPaths ?? []) {
    const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
    if (normalized && normalized !== "." && !normalized.startsWith("../")) ignoreRules.add(`${normalized}/`);
  }

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
      const projectPath = relative(root, absolutePath).replaceAll("\\", "/");
      if (ignoreRules.ignores(entry.isDirectory() ? `${projectPath}/` : projectPath)) {
        ignored += 1;
        continue;
      }
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
          path: projectPath,
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
