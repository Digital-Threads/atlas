import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { NestAdapter } from "./adapters/nest-adapter.js";
import { GraphBuilder } from "./core/graph.js";
import type { ArchitectureGraph, ArchitectureRisk, ScanOptions, ScanResult } from "./core/types.js";
import { detectStacks } from "./detector/stack-detector.js";
import { generateReport } from "./output/report.js";
import { writeOutputs } from "./output/writer.js";
import { detectRisks } from "./risks/risk-detector.js";
import { scanFiles } from "./scanner/file-scanner.js";

export * from "./core/types.js";
export { GraphBuilder, GraphQuery } from "./core/graph.js";
export { detectRisks } from "./risks/risk-detector.js";
export { generateReport } from "./output/report.js";

export async function scanProject(options: ScanOptions): Promise<ScanResult> {
  const started = Date.now();
  const scanStartedAt = new Date(started).toISOString();
  const projectRoot = resolve(options.projectPath);
  const packageJson = await readJson(resolve(projectRoot, "package.json"));
  const projectName = String(packageJson?.name ?? basename(projectRoot));
  const outputPath = resolve(projectRoot, options.outputPath ?? ".atlas");
  const fileScan = await scanFiles(projectRoot);
  const detectedStacks = await detectStacks(projectRoot, fileScan.files);
  const builder = new GraphBuilder();

  builder.addNode({ id: "project:root", type: "project", label: projectName, name: projectName, file: ".", source: "config", confidence: 1, metadata: { root: projectRoot } });
  for (const file of fileScan.files) {
    builder.addNode({ id: `file:${file.path}`, type: "file", label: file.path, name: basename(file.path), file: file.path, language: languageFor(file.extension), source: "static_analysis", confidence: 1, metadata: { extension: file.extension, size: file.size, hash: file.hash, lastModified: file.lastModified } });
  }
  addFileHierarchy(builder, projectRoot, fileScan.files.map((file) => file.path));

  const adapter = new NestAdapter();
  if (await adapter.detect({ projectRoot, files: fileScan.files, detectedStacks, debug: options.debug })) {
    const adapterResult = await adapter.scan({ projectRoot, files: fileScan.files, detectedStacks, debug: options.debug });
    for (const node of adapterResult.nodes) builder.addNode(node);
    for (const edge of adapterResult.edges) builder.addEdge(edge);
    if (options.debug) for (const warning of adapterResult.warnings) console.error(`[debug] ${warning}`);
  }

  const project = { name: projectName, root: projectRoot, detectedStacks: detectedStacks.map((stack) => stack.name), createdAt: new Date().toISOString() };
  let graph = builder.toGraph(project);
  const risks = detectRisks(graph);
  for (const item of risks) {
    builder.addNode({ id: item.id, type: "risk", label: item.title, name: item.title, file: item.file, source: "static_analysis", confidence: 1, metadata: { severity: item.severity, riskType: item.type, description: item.description, recommendation: item.recommendation } });
  }
  for (const item of risks) if (item.nodeId && builder.hasNode(item.nodeId)) builder.addEdge({ from: item.id, to: item.nodeId, type: "references", source: "static_analysis", confidence: 1 });
  graph = builder.toGraph(project);

  const finished = Date.now();
  const metadata = {
    version: graph.version,
    projectName,
    projectRoot,
    scanStartedAt,
    scanFinishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    filesScanned: fileScan.files.length,
    filesIgnored: fileScan.ignored,
    detectedStacks,
  };
  await writeOutputs(outputPath, graph, metadata, risks);
  return { graph, metadata, risks, outputPath };
}

export async function loadGraph(projectPath: string): Promise<ArchitectureGraph> {
  return JSON.parse(await readFile(resolve(projectPath, ".atlas", "graph.json"), "utf8"));
}

export async function regenerateReport(projectPath: string): Promise<string> {
  const output = resolve(projectPath, ".atlas");
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
