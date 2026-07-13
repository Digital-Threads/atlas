import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Script } from "node:vm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { GraphQuery, scanProject } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, "fixtures/nest-app");
const cli = resolve(here, "../dist/cli/index.js");

test("scans a NestJS project and produces queryable outputs", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "atlas-test-"));
  const project = resolve(root, "project");
  await cp(fixture, project, { recursive: true });

  const result = await scanProject({ projectPath: project });
  const query = new GraphQuery(result.graph);

  assert.equal(result.metadata.detectedStacks[0]?.name, "nestjs");
  assert.ok(result.metadata.detectedStacks[0]?.confidence >= 0.8);
  for (const id of [
    "module:AppModule", "controller:UsersController", "service:UsersService",
    "dto:CreateUserDto", "route:POST:/users", "method:UsersController.create",
    "table:User", "environment_variable:EXAMPLE_API_KEY", "external_api:api.example.com",
  ]) assert.ok(query.getNode(id), `missing node ${id}`);

  const flow = query.findFlowFromRoute("route:POST:/users");
  assert.ok(flow.nodes.some((node) => node.id === "method:UsersService.create"));
  assert.ok(flow.nodes.some((node) => node.id === "table:User"));
  assert.ok(result.graph.edges.some((edge) => edge.from === "test:src/users.service.spec.ts" && edge.to === "service:UsersService" && edge.type === "tests"));

  const serialized = JSON.stringify(result.graph);
  assert.doesNotMatch(serialized, /secret-password|never-store-this-value/);
  for (const path of ["graph.json", "metadata.json", "risks.json", "report.md", "viewer/index.html", "viewer/app.js", "viewer/cytoscape.min.js", "viewer/graph.json"]) {
    assert.ok((await stat(resolve(project, ".atlas", path))).isFile(), `missing output ${path}`);
  }
  const report = await readFile(resolve(project, ".atlas/report.md"), "utf8");
  assert.match(report, /POST \/users/);
  const viewerApp = await readFile(resolve(project, ".atlas/viewer/app.js"), "utf8");
  const viewerHtml = await readFile(resolve(project, ".atlas/viewer/index.html"), "utf8");
  const viewerCss = await readFile(resolve(project, ".atlas/viewer/style.css"), "utf8");
  assert.doesNotThrow(() => new Script(viewerApp));
  assert.match(viewerApp, /source:edge\.from, target:edge\.to/);
  assert.match(viewerCss, /#empty\[hidden\]\{display:none\}/);
  assert.match(viewerHtml, /src="cytoscape\.min\.js"/);
  assert.doesNotMatch(viewerHtml, /https?:\/\//);

  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, "mcp", "--path", project], stderr: "pipe" });
  const client = new Client({ name: "atlas-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 10);
    assert.ok(tools.tools.some((tool) => tool.name === "atlas_find_routes"));
    const response = await client.callTool({ name: "atlas_find_routes", arguments: {} });
    assert.match(JSON.stringify(response), /POST \/users/);
  } finally {
    await client.close();
  }
});

test("identifies Atlas as a Digital Threads package", async () => {
  const packageJson = JSON.parse(await readFile(resolve(here, "../package.json"), "utf8"));
  assert.equal(packageJson.name, "@dthreads/atlas");
  assert.equal(packageJson.bin.atlas, "./dist/cli/index.js");
  assert.equal(packageJson.author, "Digital Threads");
  assert.equal(packageJson.license, "MIT");
});
