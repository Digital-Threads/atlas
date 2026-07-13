#!/usr/bin/env node
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import { regenerateReport, scanProject } from "../index.js";
import { startMcpServer } from "../mcp/server.js";
import { openBrowser } from "../server/open-browser.js";
import { serveViewer } from "../server/viewer-server.js";

const program = new Command();
program.name("atlas").description("Local architecture intelligence for NestJS projects").version("0.1.0");

program.command("scan")
  .description("Scan a local NestJS project and generate its architecture graph")
  .option("-p, --path <path>", "project root", ".")
  .option("-o, --output <path>", "output directory relative to the project", ".atlas")
  .option("--format <format>", "output format", "json")
  .option("--debug", "show diagnostic details", false)
  .action(async (options) => {
    if (options.format !== "json") throw new Error(`Unsupported format: ${options.format}. Use json.`);
    console.log("Atlas scan started");
    const result = await scanProject({
      projectPath: options.path,
      outputPath: options.output,
      debug: options.debug,
      onProgress: ({ message }) => console.log(message),
    });
    console.log(`Graph created: ${result.graph.stats.totalNodes} nodes, ${result.graph.stats.totalEdges} edges`);
    console.log(`Risks detected: ${result.risks.length}`);
    console.log(`Viewer created: ${resolve(result.outputPath, "viewer", "index.html")}`);
    console.log("Done");
  });

program.command("open")
  .description("Open the generated static viewer")
  .option("-p, --path <path>", "project root", ".")
  .action(async ({ path }) => {
    const file = resolve(path, ".atlas", "viewer", "index.html");
    await access(file);
    openBrowser(file);
    console.log(`Opened ${file}`);
  });

program.command("serve")
  .description("Serve the generated viewer on localhost")
  .option("-p, --path <path>", "project root", ".")
  .option("--port <port>", "local port", "4317")
  .option("--open", "open the viewer in a browser", false)
  .action(async ({ path, port, open }) => {
    const numericPort = Number.parseInt(port, 10);
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) throw new Error(`Invalid port: ${port}`);
    if (open) openBrowser(`http://localhost:${numericPort}`);
    await serveViewer(resolve(path, ".atlas", "viewer"), numericPort);
  });

program.command("report")
  .description("Regenerate report.md from graph.json and risks.json")
  .option("-p, --path <path>", "project root", ".")
  .action(async ({ path }) => console.log(`Report created: ${await regenerateReport(resolve(path))}`));

program.command("mcp")
  .description("Start the Atlas MCP server over stdio")
  .option("-p, --path <path>", "project root", ".")
  .action(async ({ path }) => startMcpServer(resolve(path)));

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`Atlas error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
