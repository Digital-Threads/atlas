#!/usr/bin/env node
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";

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
    const { scanProject } = await import("../index.js");
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
  .option("-o, --output <path>", "Atlas output directory relative to the project", ".atlas")
  .action(async ({ path, output }) => {
    const { openBrowser } = await import("../server/open-browser.js");
    const file = resolve(path, output, "viewer", "index.html");
    await access(file);
    await openBrowser(file);
    console.log(`Opened ${file}`);
  });

program.command("serve")
  .description("Serve the generated viewer on localhost")
  .option("-p, --path <path>", "project root", ".")
  .option("-o, --output <path>", "Atlas output directory relative to the project", ".atlas")
  .option("--port <port>", "local port", "4317")
  .option("--open", "open the viewer in a browser", false)
  .action(async ({ path, output, port, open }) => {
    const numericPort = Number.parseInt(port, 10);
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) throw new Error(`Invalid port: ${port}`);
    const { serveViewer } = await import("../server/viewer-server.js");
    await serveViewer(resolve(path, output, "viewer"), numericPort);
    if (open) {
      const { openBrowser } = await import("../server/open-browser.js");
      await openBrowser(`http://localhost:${numericPort}`);
    }
  });

program.command("report")
  .description("Regenerate report.md from graph.json and risks.json")
  .option("-p, --path <path>", "project root", ".")
  .option("-o, --output <path>", "Atlas output directory relative to the project", ".atlas")
  .action(async ({ path, output }) => {
    const { regenerateReport } = await import("../index.js");
    console.log(`Report created: ${await regenerateReport(resolve(path), output)}`);
  });

program.command("mcp")
  .description("Start the Atlas MCP server over stdio")
  .option("-p, --path <path>", "project root", ".")
  .option("-o, --output <path>", "Atlas output directory relative to the project", ".atlas")
  .action(async ({ path, output }) => {
    const { startMcpServer } = await import("../mcp/server.js");
    await startMcpServer(resolve(path), output);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(`Atlas error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
