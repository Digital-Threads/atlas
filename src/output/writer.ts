import { createRequire } from "node:module";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ArchitectureGraph, ArchitectureRisk, ScanMetadata } from "../core/types.js";
import { viewerCss, viewerHtml, viewerJs, viewerLayoutCss } from "../viewer/templates.js";
import { generateReport } from "./report.js";

const require = createRequire(import.meta.url);

export async function writeOutputs(
  outputPath: string,
  graph: ArchitectureGraph,
  metadata: ScanMetadata,
  risks: ArchitectureRisk[],
): Promise<void> {
  const viewerPath = resolve(outputPath, "viewer");
  await mkdir(viewerPath, { recursive: true });
  const graphJson = `${JSON.stringify(graph, null, 2)}\n`;
  await Promise.all([
    writeFile(resolve(outputPath, "graph.json"), graphJson),
    writeFile(resolve(outputPath, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`),
    writeFile(resolve(outputPath, "risks.json"), `${JSON.stringify(risks, null, 2)}\n`),
    writeFile(resolve(outputPath, "report.md"), generateReport(graph, risks)),
    writeFile(resolve(viewerPath, "index.html"), viewerHtml),
    writeFile(resolve(viewerPath, "style.css"), viewerCss + viewerLayoutCss),
    writeFile(resolve(viewerPath, "app.js"), viewerJs),
    writeFile(resolve(viewerPath, "graph.json"), graphJson),
    writeFile(resolve(viewerPath, "graph-data.js"), `window.__ATLAS_GRAPH__=${JSON.stringify(graph)};\n`),
  ]);
  const cytoscapePath = require.resolve("cytoscape/dist/cytoscape.min.js");
  await copyFile(cytoscapePath, resolve(viewerPath, "cytoscape.min.js"));
}
