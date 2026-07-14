import { access, copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ArchitectureGraph, ArchitectureRisk, ScanMetadata } from "../core/types.js";
import { generateViewerData } from "../viewer/data.js";
import { generateReport } from "./report.js";

export async function writeOutputs(
  outputPath: string,
  graph: ArchitectureGraph,
  metadata: ScanMetadata,
  risks: ArchitectureRisk[],
): Promise<void> {
  const viewerPath = resolve(outputPath, "viewer");
  const viewerAssets = await findViewerAssets();
  await mkdir(viewerPath, { recursive: true });
  const graphJson = `${JSON.stringify(graph, null, 2)}\n`;
  await Promise.all([
    writeFile(resolve(outputPath, "graph.json"), graphJson),
    writeFile(resolve(outputPath, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`),
    writeFile(resolve(outputPath, "risks.json"), `${JSON.stringify(risks, null, 2)}\n`),
    writeFile(resolve(outputPath, "report.md"), generateReport(graph, risks)),
    writeFile(resolve(viewerPath, "graph.json"), graphJson),
    writeFile(resolve(viewerPath, "atlas-data.js"), generateViewerData(graph, metadata, risks)),
    copyFile(resolve(viewerAssets, "index.template.html"), resolve(viewerPath, "index.html")),
    copyFile(resolve(viewerAssets, "support.js"), resolve(viewerPath, "support.js")),
    copyFile(resolve(viewerAssets, "react.production.min.js"), resolve(viewerPath, "react.production.min.js")),
    copyFile(resolve(viewerAssets, "react-dom.production.min.js"), resolve(viewerPath, "react-dom.production.min.js")),
  ]);
}

async function findViewerAssets(): Promise<string> {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDir, "../assets/viewer"),
    resolve(moduleDir, "../../assets/viewer"),
    resolve(process.cwd(), "assets/viewer"),
  ];
  for (const candidate of candidates) {
    try {
      await access(resolve(candidate, "index.template.html"));
      return candidate;
    } catch {
      // Try the next source or packaged asset location.
    }
  }
  throw new Error("Atlas viewer assets are missing from the installed package.");
}
