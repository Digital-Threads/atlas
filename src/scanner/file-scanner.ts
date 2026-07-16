import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { extname, relative, resolve } from "node:path";
import createIgnore from "ignore";
import type { ScannedFile } from "../core/types.js";

const ignoredDirectories = new Set([
  "node_modules", "dist", "build", ".git", "coverage", ".atlas", ".next", ".nuxt",
  ".cache", "tmp", ".tmp", "temp", ".temp", "logs", ".turbo", ".idea", ".vscode",
  ".worktrees", "worktrees", ".pnpm-store", ".yarn", ".nx", ".angular", ".svelte-kit",
  ".output", ".serverless", ".aws-sam", ".parcel-cache", ".vercel", "storybook-static",
]);
const supportedExtensions = new Set([
  ".ts", ".js", ".json", ".yml", ".yaml", ".prisma", ".sql", ".tf", ".hcl",
  ".toml", ".sh", ".tpl",
]);
const supportedNames = new Set(["dockerfile", "jenkinsfile"]);

export interface FileScanResult {
  files: ScannedFile[];
  ignored: number;
  hashed: number;
  reused: number;
}

export interface FileScanOptions {
  ignoredPaths?: string[];
  cachePath?: string;
  useCache?: boolean;
  concurrency?: number;
}

interface FileManifestEntry {
  size: number;
  lastModified: string;
  hash?: string;
}

interface FileManifest {
  version: 1;
  files: Record<string, FileManifestEntry>;
}

interface FileCandidate {
  absolutePath: string;
  path: string;
  extension: string;
  isEnv: boolean;
}

export async function scanFiles(projectRoot: string, options: FileScanOptions = {}): Promise<FileScanResult> {
  const root = resolve(projectRoot);
  const files: ScannedFile[] = [];
  const candidates: FileCandidate[] = [];
  const ignoreRules = createIgnore();
  let ignored = 0;
  let hashed = 0;
  let reused = 0;
  const manifest = options.useCache === false ? null : await readManifest(options.cachePath);
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
      const normalizedName = entry.name.toLowerCase();
      const isNamedConfig = supportedNames.has(normalizedName) || normalizedName.startsWith("dockerfile.");
      if (!supportedExtensions.has(extension) && !isEnv && !isNamedConfig) {
        ignored += 1;
        continue;
      }
      candidates.push({
        absolutePath,
        path: projectPath,
        extension: isEnv ? ".env" : (isNamedConfig ? normalizedName : extension),
        isEnv,
      });
    }
  }

  await walk(root, true);
  const results = await mapConcurrent(candidates, options.concurrency ?? 32, async (candidate) => {
    try {
      const fileStat = await stat(candidate.absolutePath);
      const lastModified = fileStat.mtime.toISOString();
      const previous = manifest?.files[candidate.path];
      let hash: string | undefined;
      if (!candidate.isEnv && previous?.hash && previous.size === fileStat.size && previous.lastModified === lastModified) {
        hash = previous.hash;
        reused += 1;
      } else if (!candidate.isEnv) {
        hash = createHash("sha256").update(await readFile(candidate.absolutePath)).digest("hex");
        hashed += 1;
      }
      return {
        absolutePath: candidate.absolutePath,
        path: candidate.path,
        extension: candidate.extension,
        size: fileStat.size,
        hash,
        lastModified,
      } satisfies ScannedFile;
    } catch {
      ignored += 1;
      return null;
    }
  });
  files.push(...results.filter((file): file is ScannedFile => Boolean(file)));
  files.sort((a, b) => a.path.localeCompare(b.path));
  await writeManifest(options.cachePath, files);
  return { files, ignored, hashed, reused };
}

async function readManifest(path?: string): Promise<FileManifest | null> {
  if (!path) return null;
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as FileManifest;
    return parsed.version === 1 && parsed.files && typeof parsed.files === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function writeManifest(path: string | undefined, files: ScannedFile[]): Promise<void> {
  if (!path) return;
  const entries = Object.fromEntries(files.map((file) => [file.path, {
    size: file.size,
    lastModified: file.lastModified,
    ...(file.hash ? { hash: file.hash } : {}),
  }]));
  const manifest: FileManifest = { version: 1, files: entries };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest)}\n`);
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency), items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}
