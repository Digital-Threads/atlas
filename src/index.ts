import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { NestAdapter } from "./adapters/nest-adapter.js";
import { ProjectAdapter } from "./adapters/project-adapter.js";
import { enrichGraphDescriptions } from "./core/descriptions.js";
import { GraphBuilder } from "./core/graph.js";
import type { ArchitectureGraph, ArchitectureRisk, ScanMetadata, ScanOptions, ScanResult, ScannedFile } from "./core/types.js";
import { detectStacks } from "./detector/stack-detector.js";
import { generateReport } from "./output/report.js";
import { writeOutputs } from "./output/writer.js";
import { detectRisks } from "./risks/risk-detector.js";
import { scanFiles } from "./scanner/file-scanner.js";

export * from "./core/types.js";
export { enrichGraphDescriptions } from "./core/descriptions.js";
export { GraphBuilder, GraphQuery } from "./core/graph.js";
export { detectRisks } from "./risks/risk-detector.js";
export { generateReport } from "./output/report.js";
export { getBrowserLaunch, openBrowser } from "./server/open-browser.js";
export { serveViewer } from "./server/viewer-server.js";
export { scanFiles } from "./scanner/file-scanner.js";
export type { FileScanOptions, FileScanResult } from "./scanner/file-scanner.js";

const ANALYSIS_CACHE_VERSION = 1;

export async function scanProject(options: ScanOptions): Promise<ScanResult> {
  const started = Date.now();
  const scanStartedAt = new Date(started).toISOString();
  const projectRoot = resolve(options.projectPath);
  const packageJson = await readJson(resolve(projectRoot, "package.json"));
  const projectName = String(packageJson?.name ?? basename(projectRoot));
  const outputPath = resolve(projectRoot, options.outputPath ?? ".atlas");
  const relativeOutput = relative(projectRoot, outputPath).replaceAll("\\", "/");
  const ignoredPaths = relativeOutput && relativeOutput !== "." && !relativeOutput.startsWith("../") ? [relativeOutput] : [];
  options.onProgress?.({ stage: "scan_files", message: "Scanning files..." });
  const fileScan = await scanFiles(projectRoot, {
    ignoredPaths,
    cachePath: resolve(outputPath, "cache", "files.json"),
    useCache: options.incremental !== false,
  });
  const inputFingerprint = fingerprintFiles(fileScan.files);
  options.onProgress?.({
    stage: "scan_files",
    message: `${fileScan.files.length} files found (${fileScan.hashed} hashed, ${fileScan.reused} unchanged)`,
  });
  if (options.incremental !== false) {
    const cached = await loadCachedAnalysis(outputPath, inputFingerprint);
    if (cached) {
      const finished = Date.now();
      const metadata: ScanMetadata = {
        ...cached.metadata,
        scanStartedAt,
        scanFinishedAt: new Date(finished).toISOString(),
        durationMs: finished - started,
        filesScanned: fileScan.files.length,
        filesIgnored: fileScan.ignored,
        filesHashed: fileScan.hashed,
        filesReused: fileScan.reused,
        cacheHit: true,
        inputFingerprint,
        analysisCacheVersion: ANALYSIS_CACHE_VERSION,
      };
      options.onProgress?.({ stage: "parse_architecture", message: "No source changes. Reusing the cached architecture graph." });
      await writeFile(resolve(outputPath, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
      return { graph: cached.graph, metadata, risks: cached.risks, outputPath };
    }
  }
  options.onProgress?.({ stage: "detect_stack", message: "Detecting project stack..." });
  const detectedStacks = await detectStacks(projectRoot, fileScan.files);
  const nestStack = detectedStacks.find((stack) => stack.name === "nestjs");
  options.onProgress?.({
    stage: "detect_stack",
    message: nestStack
      ? `NestJS detected with confidence ${nestStack.confidence}`
      : "No supported framework detected. Generating a basic project graph.",
  });
  const builder = new GraphBuilder();

  builder.addNode({ id: "project:root", type: "project", label: projectName, name: projectName, file: ".", source: "config", confidence: 1, metadata: { root: projectRoot } });
  for (const file of fileScan.files) {
    const metadata = file.extension === ".env"
      ? { extension: file.extension, lastModified: file.lastModified, sensitive: true, valuesStored: false }
      : { extension: file.extension, size: file.size, hash: file.hash, lastModified: file.lastModified };
    builder.addNode({ id: `file:${file.path}`, type: "file", label: file.path, name: basename(file.path), file: file.path, language: languageFor(file.extension), source: "static_analysis", confidence: 1, metadata });
    if ([".json", ".yml", ".yaml"].includes(file.extension) && file.path !== "package.json") {
      builder.addNode({ id: `config:${file.path}`, type: "config", label: file.path, name: basename(file.path), file: file.path, language: languageFor(file.extension), source: "config", confidence: 1 });
      builder.addEdge({ from: `file:${file.path}`, to: `config:${file.path}`, type: "declares", source: "config", confidence: 1 });
    }
  }
  addFileHierarchy(builder, projectRoot, fileScan.files.map((file) => file.path));

  const contentReads = new Map<string, Promise<string>>();
  const readScannedFile = (file: ScannedFile) => {
    let pending = contentReads.get(file.path);
    if (!pending) {
      pending = readFile(file.absolutePath, "utf8").catch(() => "");
      contentReads.set(file.path, pending);
      void pending.then(() => {
        if (contentReads.get(file.path) === pending) contentReads.delete(file.path);
      });
    }
    return pending;
  };
  const adapterContext = { projectRoot, files: fileScan.files, detectedStacks, readFile: readScannedFile, debug: options.debug };
  const adapters = [new NestAdapter(), new ProjectAdapter()];
  const detections = await Promise.all(adapters.map((adapter) => adapter.detect(adapterContext)));
  const activeAdapters = adapters.filter((_, index) => detections[index].detected);
  if (activeAdapters.length) {
    options.onProgress?.({
      stage: "parse_architecture",
      message: `Parsing architecture with ${activeAdapters.map((adapter) => adapter.name).join(" and ")}...`,
    });
    const adapterResults = await Promise.all(activeAdapters.map(async (adapter) => ({
      adapter,
      result: await adapter.scan(adapterContext),
    })));
    for (const { adapter, result } of adapterResults) {
      for (const node of await adapter.buildNodes(result)) builder.addNode(node);
      for (const edge of await adapter.buildEdges(result)) builder.addEdge(edge);
      if (options.debug) for (const warning of result.warnings) console.error(`[debug] ${warning}`);
    }
  }

  options.onProgress?.({ stage: "build_graph", message: "Building architecture graph..." });
  const integrityErrors = builder.validate();
  if (integrityErrors.length) throw new Error(`Graph integrity check failed: ${integrityErrors[0]}`);
  const project = { name: projectName, root: projectRoot, detectedStacks: detectedStacks.map((stack) => stack.name), createdAt: new Date().toISOString() };
  let graph = builder.toGraph(project);
  options.onProgress?.({ stage: "detect_risks", message: "Detecting architecture risks..." });
  const risks = detectRisks(graph);
  for (const item of risks) {
    builder.addNode({ id: item.id, type: "risk", label: item.title, name: item.title, file: item.file, source: "static_analysis", confidence: 1, metadata: { severity: item.severity, riskType: item.type, description: item.description, recommendation: item.recommendation } });
  }
  for (const item of risks) if (item.nodeId && builder.hasNode(item.nodeId)) builder.addEdge({ from: item.id, to: item.nodeId, type: "references", source: "static_analysis", confidence: 1 });
  graph = enrichGraphDescriptions(builder.toGraph(project));

  const finished = Date.now();
  const metadata: ScanMetadata = {
    version: graph.version,
    projectName,
    projectRoot,
    scanStartedAt,
    scanFinishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    filesScanned: fileScan.files.length,
    filesIgnored: fileScan.ignored,
    filesHashed: fileScan.hashed,
    filesReused: fileScan.reused,
    cacheHit: false,
    inputFingerprint,
    analysisCacheVersion: ANALYSIS_CACHE_VERSION,
    detectedStacks,
  };
  options.onProgress?.({ stage: "write_outputs", message: "Writing graph, report, and viewer..." });
  await writeOutputs(outputPath, graph, metadata, risks);
  return { graph, metadata, risks, outputPath };
}

export async function loadGraph(projectPath: string, outputPath = ".atlas"): Promise<ArchitectureGraph> {
  return JSON.parse(await readFile(resolve(projectPath, outputPath, "graph.json"), "utf8"));
}

export async function regenerateReport(projectPath: string, outputPath = ".atlas"): Promise<string> {
  const output = resolve(projectPath, outputPath);
  const [graph, risks] = await Promise.all([
    readFile(resolve(output, "graph.json"), "utf8").then((value) => JSON.parse(value) as ArchitectureGraph),
    readFile(resolve(output, "risks.json"), "utf8").then((value) => JSON.parse(value) as ArchitectureRisk[]),
  ]);
  const report = generateReport(graph, risks);
  await writeFile(resolve(output, "report.md"), report);
  return resolve(output, "report.md");
}

function addFileHierarchy(builder: GraphBuilder, projectRoot: string, files: string[]) {
  const folders = new Set<string>();
  for (const file of files) {
    let folder = dirname(file).replaceAll("\\", "/");
    while (folder !== "." && folder !== "/") { folders.add(folder); folder = dirname(folder).replaceAll("\\", "/"); }
  }
  for (const folder of [...folders].sort()) builder.addNode({ id: `folder:${folder}`, type: "folder", label: folder, name: basename(folder), file: folder, source: "static_analysis", confidence: 1 });
  for (const folder of folders) {
    const parent = dirname(folder).replaceAll("\\", "/");
    builder.addEdge({ from: parent === "." ? "project:root" : `folder:${parent}`, to: `folder:${folder}`, type: "contains", source: "static_analysis", confidence: 1 });
  }
  for (const file of files) {
    const folder = dirname(file).replaceAll("\\", "/");
    builder.addEdge({ from: folder === "." ? "project:root" : `folder:${folder}`, to: `file:${file}`, type: "contains", source: "static_analysis", confidence: 1 });
  }
  void projectRoot;
}

function languageFor(extension: string): string {
  if (extension === ".ts") return "typescript";
  if (extension === ".js") return "javascript";
  if (extension === ".json") return "json";
  if (extension === ".prisma") return "prisma";
  return "config";
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}

function fingerprintFiles(files: ScannedFile[]): string {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.hash ?? `${file.size}:${file.lastModified}`);
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function loadCachedAnalysis(
  outputPath: string,
  inputFingerprint: string,
): Promise<{ graph: ArchitectureGraph; metadata: ScanMetadata; risks: ArchitectureRisk[] } | null> {
  try {
    const [graph, metadata, risks] = await Promise.all([
      readFile(resolve(outputPath, "graph.json"), "utf8").then((value) => JSON.parse(value) as ArchitectureGraph),
      readFile(resolve(outputPath, "metadata.json"), "utf8").then((value) => JSON.parse(value) as ScanMetadata),
      readFile(resolve(outputPath, "risks.json"), "utf8").then((value) => JSON.parse(value) as ArchitectureRisk[]),
    ]);
    if (metadata.analysisCacheVersion !== ANALYSIS_CACHE_VERSION || metadata.inputFingerprint !== inputFingerprint) return null;
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(risks)) return null;
    return { graph, metadata, risks };
  } catch {
    return null;
  }
}
