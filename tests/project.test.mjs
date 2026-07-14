import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Script } from "node:vm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { GraphQuery, graphNodeTypes, loadGraph, scanFiles, scanProject } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, "fixtures/nest-app");
const cli = resolve(here, "../dist/cli/index.js");

test("covers the complete NestJS MVP architecture surface", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "atlas-test-"));
  const project = resolve(root, "project");
  await cp(fixture, project, { recursive: true });
  const progress = [];
  const result = await scanProject({ projectPath: project, onProgress: (event) => progress.push(event.stage) });
  const query = new GraphQuery(result.graph);

  assert.equal(result.metadata.detectedStacks[0]?.name, "nestjs");
  assert.ok(result.metadata.detectedStacks[0]?.confidence >= 0.8);
  assert.deepEqual([...new Set(progress)], ["scan_files", "detect_stack", "parse_architecture", "build_graph", "detect_risks", "write_outputs"]);

  const requiredNodes = [
    "project:root", "package:root", "config:nest-cli.json", "module:AppModule",
    "controller:UsersController", "service:UsersService", "service:AuditService", "service:PrismaService",
    "dto:CreateUserDto", "guard:AuthGuard", "pipe:RequestValidationPipe", "pipe:ValidationPipe",
    "interceptor:AuditInterceptor", "middleware:LoggerMiddleware", "provider:MAILER",
    "decorator:CurrentUser",
    "function:src/main.ts:bootstrap", "route:POST:/api/users", "route:GET:/api/users",
    "method:UsersController.create", "method:UsersService.create", "method:PrismaService.user.create",
    "database:prisma", "model:User", "table:User", "table:Post", "column:User.email",
    "database:typeorm", "entity:UserEntity", "repository:UserEntityRepository",
    "table:typeorm_users", "method:UserEntityRepository.find", "method:UserEntityRepository.save",
    "environment_variable:EXAMPLE_API_KEY", "environment_variable:AUDIT_API_URL",
    "external_api:api.example.com", "external_api:unknown:AUDIT_API_URL", "test:src/users.service.spec.ts",
    "library:@nestjs/core", "library:typeorm",
    "message_broker:kafka", "message_topic:orders.created", "queue:email-jobs", "processor:EmailProcessor",
    "method:OrderPublisher.publishOrder", "method:OrderEventsConsumer.handleOrder", "method:EmailProcessor.handleEmail",
  ];
  for (const id of requiredNodes) assert.ok(query.getNode(id), `missing node ${id}`);

  for (const method of ["ALL", "DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]) {
    assert.ok(query.findRoutes().some((route) => route.metadata?.httpMethod === method), `missing ${method} route`);
  }
  assert.equal(query.findControllers().length, 2);
  assert.ok(query.findServices().length >= 3);
  assert.equal(query.findRoutes().length, 8);
  assert.ok(result.graph.nodes.every((node) => graphNodeTypes.includes(node.type)), "graph contains an invalid node type");

  const dto = query.getNode("dto:CreateUserDto");
  assert.deepEqual(dto.metadata.fields.map((field) => field.name), ["email", "name"]);
  assert.deepEqual(dto.metadata.fields[0].validators, ["IsEmail"]);
  assert.ok(dto.metadata.fields[1].validators.includes("IsOptional"));

  const packageNode = query.getNode("package:root");
  assert.equal(packageNode.metadata.scripts.start, "nest start");
  assert.ok(result.graph.edges.some((edge) => edge.from === "file:src/audit.service.ts" && edge.to === "library:@nestjs/typeorm" && edge.type === "imports"));
  assert.ok(result.graph.edges.some((edge) => edge.from === "module:AppModule" && edge.to === "middleware:LoggerMiddleware" && edge.type === "uses"));
  assert.ok(result.graph.edges.some((edge) => edge.from === "project:root" && edge.to === "pipe:ValidationPipe" && edge.type === "decorates"));
  assert.ok(result.graph.edges.some((edge) => edge.from === "table:User" && edge.to === "table:Post" && edge.metadata?.relation === "has_many"));
  assert.ok(result.graph.edges.some((edge) => edge.from === "table:typeorm_users" && edge.to === "table:typeorm_posts" && edge.type === "references"));
  assert.ok(result.graph.edges.some((edge) => edge.from === "method:UserEntityRepository.find" && edge.to === "table:typeorm_users" && edge.type === "reads"));
  assert.ok(result.graph.edges.some((edge) => edge.from === "method:UserEntityRepository.save" && edge.to === "table:typeorm_users" && edge.type === "writes"));
  assert.ok(result.graph.edges.some((edge) => edge.from === "environment_variable:AUDIT_API_URL" && edge.to === "external_api:unknown:AUDIT_API_URL" && edge.type === "connects_to"));
  assert.ok(result.graph.edges.some((edge) => edge.from === "test:src/users.service.spec.ts" && edge.to === "service:UsersService" && edge.type === "tests"));
  assert.ok(result.graph.edges.some((edge) => edge.from === "method:OrderPublisher.publishOrder" && edge.to === "message_topic:orders.created" && edge.type === "publishes_to"));
  assert.ok(result.graph.edges.some((edge) => edge.from === "message_topic:orders.created" && edge.to === "method:OrderEventsConsumer.handleOrder" && edge.type === "delivers_to"));
  assert.ok(result.graph.edges.some((edge) => edge.from === "method:OrderPublisher.scheduleEmail" && edge.to === "queue:email-jobs" && edge.type === "enqueues"));
  assert.ok(result.graph.edges.some((edge) => edge.from === "queue:email-jobs" && edge.to === "processor:EmailProcessor" && edge.type === "processes"));
  assert.ok(result.graph.edges.some((edge) => edge.from === "queue:email-jobs" && edge.to === "method:EmailProcessor.handleEmail" && edge.type === "delivers_to"));

  const featureASettings = "module:SettingsModule@src/feature-a/settings.module.ts";
  const featureBSettings = "module:SettingsModule@src/feature-b/settings.module.ts";
  assert.ok(query.getNode(featureASettings));
  assert.ok(query.getNode(featureBSettings));
  assert.ok(result.graph.edges.some((edge) => edge.from === "module:AppModule" && edge.to === featureASettings && edge.type === "imports"));
  assert.ok(result.graph.edges.some((edge) => edge.from === "module:WorkerModule" && edge.to === featureBSettings && edge.type === "imports"));

  for (const node of result.graph.nodes.filter((item) => ["module", "controller", "service", "provider", "repository", "method", "function", "route", "message_broker", "message_topic", "queue", "processor"].includes(item.type))) {
    assert.ok(node.metadata?.description, `missing architecture description for ${node.id}`);
    assert.ok(node.metadata?.plainDescription, `missing plain-language description for ${node.id}`);
    assert.equal(node.metadata?.plainDescriptionSource, "inferred_from_code_structure");
  }
  assert.match(query.getNode("module:AppModule").metadata.description, /NestJS module/);
  assert.match(query.getNode("service:UsersService").metadata.description, /writes User/);
  assert.match(query.getNode("function:src/main.ts:bootstrap").metadata.description, /Top-level function/);
  assert.match(query.getNode("route:DELETE:/api/users/:id").metadata.flowDescription, /enters the application through UsersController\.remove/);
  assert.match(query.getNode("route:DELETE:/api/users/:id").metadata.flowDescription, /UsersService\.findAll/);
  assert.match(query.getNode("module:AppModule").metadata.plainDescription, /Groups the parts of the application/);
  assert.match(query.getNode("service:UsersService").metadata.plainDescription, /operations and rules related to users/i);
  assert.match(query.getNode("function:src/main.ts:bootstrap").metadata.plainDescription, /Starts and configures the application/);
  assert.match(query.getNode("route:DELETE:/api/users/:id").metadata.plainFlowDescription, /asks the system to remove a user/i);
  assert.match(query.getNode("route:DELETE:/api/users/:id").metadata.plainFlowDescription, /reads the required data/i);
  assert.match(query.getNode("message_topic:orders.created").metadata.plainAsyncFlowDescription, /sends|publishes/i);
  assert.match(query.getNode("queue:email-jobs").metadata.plainAsyncFlowDescription, /background work|queue/i);

  const kafkaFlow = query.findAsyncFlow("message_topic:orders.created");
  for (const id of ["method:OrderPublisher.publishOrder", "message_topic:orders.created", "method:OrderEventsConsumer.handleOrder"]) {
    assert.ok(kafkaFlow.nodes.some((node) => node.id === id), `Kafka flow is missing ${id}`);
  }
  const queueFlow = query.findAsyncFlow("queue:email-jobs");
  for (const id of ["method:OrderPublisher.scheduleEmail", "queue:email-jobs", "processor:EmailProcessor", "method:EmailProcessor.handleEmail"]) {
    assert.ok(queueFlow.nodes.some((node) => node.id === id), `queue flow is missing ${id}`);
  }

  const createFlow = query.findFlowFromRoute("route:POST:/api/users");
  for (const id of ["method:UsersController.create", "method:UsersService.create", "method:PrismaService.user.create", "table:User"]) {
    assert.ok(createFlow.nodes.some((node) => node.id === id), `flow is missing ${id}`);
  }
  assert.ok(createFlow.edges.some((edge) => edge.from === "method:PrismaService.user.create" && edge.to === "table:User" && edge.type === "writes"));
  assert.ok(result.graph.edges.some((edge) => edge.from === "method:UsersController.remove" && edge.to === "method:UsersController.removeUser" && edge.type === "calls"));
  const removeFlow = query.findFlowFromRoute("route:DELETE:/api/users/:id");
  for (const id of ["method:UsersController.remove", "method:UsersController.removeUser", "method:UsersService.findAll"]) {
    assert.ok(removeFlow.nodes.some((node) => node.id === id), `local method flow is missing ${id}`);
  }
  assert.ok(query.getNeighbors("service:UsersService", 1).nodes.some((node) => node.id === "controller:UsersController"));
  assert.equal(query.search("UsersService")[0].node.id, "service:UsersService");
  assert.ok(query.search("UsersService")[0].matches.includes("label"));

  const serialized = JSON.stringify(result.graph);
  assert.doesNotMatch(serialized, /secret-password|never-store-this-value|private\.example\.test/);
  const envFileNode = query.getNode("file:.env");
  assert.equal(envFileNode.metadata.sensitive, true);
  assert.equal(envFileNode.metadata.hash, undefined);
  assert.equal(envFileNode.metadata.size, undefined);

  for (const path of ["graph.json", "metadata.json", "risks.json", "report.md", "viewer/index.html", "viewer/app.js", "viewer/style.css", "viewer/cytoscape.min.js", "viewer/graph.json"]) {
    assert.ok((await stat(resolve(project, ".atlas", path))).isFile(), `missing output ${path}`);
  }
  const report = await readFile(resolve(project, ".atlas/report.md"), "utf8");
  assert.match(report, /POST \/api\/users/);
  assert.match(report, /Database Models and Tables/);
  assert.doesNotMatch(report, /never-store-this-value|private\.example\.test/);

  const viewerApp = await readFile(resolve(project, ".atlas/viewer/app.js"), "utf8");
  const viewerHtml = await readFile(resolve(project, ".atlas/viewer/index.html"), "utf8");
  const viewerCss = await readFile(resolve(project, ".atlas/viewer/style.css"), "utf8");
  assert.doesNotThrow(() => new Script(viewerApp));
  assert.match(viewerApp, /source:edge\.from,target:edge\.to/);
  assert.match(viewerApp, /Dependencies/);
  assert.match(viewerApp, /data-tab="source"/);
  assert.match(viewerCss, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
  assert.match(viewerApp, /renderModePreview/);
  assert.match(viewerApp, /moduleDependencyContext/);
  assert.match(viewerApp, /positionDependencyGraph/);
  assert.match(viewerApp, /Used by/);
  assert.match(viewerApp, /Depends on/);
  assert.match(viewerApp, /Request flow/);
  assert.match(viewerApp, /Async flows/);
  assert.match(viewerApp, /Async flow/);
  assert.match(viewerApp, /flowDescription/);
  assert.match(viewerApp, /plainDescription/);
  assert.match(viewerApp, /Technical explanation/);
  assert.match(viewerCss, /\.flow-purpose/);
  assert.match(viewerCss, /\.plain-purpose/);
  assert.match(viewerCss, /\.technical-purpose/);
  assert.match(viewerHtml, /id="graph-guide"/);
  assert.match(viewerHtml, /src="cytoscape\.min\.js"/);
  assert.doesNotMatch(viewerHtml, /https?:\/\//);

  const cliScan = spawnSync(process.execPath, [cli, "scan", "--path", project], { encoding: "utf8" });
  assert.equal(cliScan.status, 0, cliScan.stderr);
  assert.match(cliScan.stdout, /Scanning files\.\.\.[\s\S]*NestJS detected[\s\S]*Graph created:[\s\S]*Done/);

  await writeFile(resolve(project, ".atlas/report.md"), "stale report\n");
  const cliReport = spawnSync(process.execPath, [cli, "report", "--path", project], { encoding: "utf8" });
  assert.equal(cliReport.status, 0, cliReport.stderr);
  assert.match(await readFile(resolve(project, ".atlas/report.md"), "utf8"), /Atlas Architecture Report/);

  const port = 44000 + (process.pid % 1000);
  const viewerServer = spawn(process.execPath, [cli, "serve", "--path", project, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  await waitForOutput(viewerServer, `http://localhost:${port}`);
  try {
    const indexResponse = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(indexResponse.status, 200);
    assert.match(indexResponse.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await indexResponse.text(), /Atlas Architecture Map/);
    const traversalResponse = await fetch(`http://127.0.0.1:${port}/%2e%2e/%2e%2e/package.json`);
    assert.notEqual(traversalResponse.status, 200);
  } finally {
    viewerServer.kill();
  }

  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, "mcp", "--path", project], stderr: "pipe" });
  const client = new Client({ name: "atlas-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 12);
    for (const name of ["atlas_find_node", "atlas_get_node", "atlas_get_dependencies", "atlas_get_dependents", "atlas_find_routes", "atlas_find_flow", "atlas_find_async_flows", "atlas_find_async_flow", "atlas_find_tables", "atlas_find_external_apis", "atlas_search", "atlas_project_summary"]) {
      assert.ok(tools.tools.some((tool) => tool.name === name), `missing MCP tool ${name}`);
    }
    const routes = await client.callTool({ name: "atlas_find_routes", arguments: {} });
    assert.match(JSON.stringify(routes), /POST \/api\/users/);
    const flow = await client.callTool({ name: "atlas_find_flow", arguments: { query: "POST /api/users" } });
    assert.match(JSON.stringify(flow), /PrismaService\.user\.create/);
    const asyncFlows = await client.callTool({ name: "atlas_find_async_flows", arguments: {} });
    assert.match(JSON.stringify(asyncFlows), /orders\.created/);
    const asyncFlow = await client.callTool({ name: "atlas_find_async_flow", arguments: { query: "orders.created" } });
    assert.match(JSON.stringify(asyncFlow), /OrderEventsConsumer\.handleOrder/);
    const dependencies = await client.callTool({ name: "atlas_get_dependencies", arguments: { id: "service:UsersService", depth: 3 } });
    assert.match(JSON.stringify(dependencies), /table:User/);
    const nodeSearch = await client.callTool({ name: "atlas_find_node", arguments: { query: "UsersService" } });
    assert.match(JSON.stringify(nodeSearch), /service:UsersService/);
    const nodeDetails = await client.callTool({ name: "atlas_get_node", arguments: { id: "service:UsersService" } });
    assert.match(JSON.stringify(nodeDetails), /method:UsersService\.create/);
    const dependents = await client.callTool({ name: "atlas_get_dependents", arguments: { id: "service:UsersService", depth: 2 } });
    assert.match(JSON.stringify(dependents), /controller:UsersController/);
    const tables = await client.callTool({ name: "atlas_find_tables", arguments: {} });
    assert.match(JSON.stringify(tables), /table:User/);
    const externalApis = await client.callTool({ name: "atlas_find_external_apis", arguments: {} });
    assert.match(JSON.stringify(externalApis), /api\.example\.com/);
    const search = await client.callTool({ name: "atlas_search", arguments: { query: "CreateUserDto" } });
    assert.match(JSON.stringify(search), /dto:CreateUserDto/);
    const summary = await client.callTool({ name: "atlas_project_summary", arguments: {} });
    assert.match(JSON.stringify(summary), /atlas-nest-fixture/);
  } finally {
    await client.close();
  }
});

function waitForOutput(child, expected) {
  return new Promise((resolvePromise, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for server output: ${output}`)), 10_000);
    const inspect = (chunk) => {
      output += chunk.toString();
      if (!output.includes(expected)) return;
      clearTimeout(timer);
      resolvePromise();
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("exit", (code) => {
      if (!output.includes(expected)) {
        clearTimeout(timer);
        reject(new Error(`Viewer server exited with ${code}: ${output}`));
      }
    });
  });
}

test("handles unsupported projects and sensitive files without crashing or leaking values", async () => {
  const project = await mkdtemp(resolve(tmpdir(), "atlas-plain-"));
  await mkdir(resolve(project, "src"), { recursive: true });
  await mkdir(resolve(project, "node_modules/hidden"), { recursive: true });
  await mkdir(resolve(project, ".worktrees/feature/src"), { recursive: true });
  await mkdir(resolve(project, "generated/cache"), { recursive: true });
  await writeFile(resolve(project, "package.json"), JSON.stringify({ name: "plain-typescript" }));
  await writeFile(resolve(project, ".gitignore"), "generated/\n");
  await writeFile(resolve(project, "src/index.ts"), "export const value = 1;\n");
  await writeFile(resolve(project, ".env"), "JWT_SECRET=do-not-store-this\n");
  await writeFile(resolve(project, "private.pem"), "PRIVATE KEY VALUE\n");
  await writeFile(resolve(project, "node_modules/hidden/secret.ts"), "export const secret = 'hidden';\n");
  await writeFile(resolve(project, ".worktrees/feature/src/ignored.ts"), "export const worktree = true;\n");
  await writeFile(resolve(project, "generated/cache/ignored.js"), "export const generated = true;\n");

  const result = await scanProject({ projectPath: project });
  assert.equal(result.metadata.detectedStacks.length, 0);
  assert.ok(result.graph.nodes.some((node) => node.id === "project:root"));
  const serialized = JSON.stringify(result.graph);
  assert.doesNotMatch(serialized, /do-not-store-this|PRIVATE KEY VALUE|node_modules\/hidden|\.worktrees|generated\/cache/);
  const fileScan = await scanFiles(project);
  assert.deepEqual(fileScan.files.map((file) => file.path).sort(), [".env", "package.json", "src/index.ts"]);
  const report = await readFile(resolve(project, ".atlas/report.md"), "utf8");
  assert.match(report, /No supported framework architecture was detected/);
});

test("uses a custom output directory across CLI, report, server, and MCP", async () => {
  const project = await mkdtemp(resolve(tmpdir(), "atlas-custom-output-"));
  await mkdir(resolve(project, "src"), { recursive: true });
  await writeFile(resolve(project, "package.json"), JSON.stringify({ name: "custom-output-project" }));
  await writeFile(resolve(project, "src/index.ts"), "export const ready = true;\n");
  const output = ".architecture";

  const scan = spawnSync(process.execPath, [cli, "scan", "--path", project, "--output", output], { encoding: "utf8" });
  assert.equal(scan.status, 0, scan.stderr);
  assert.equal((await loadGraph(project, output)).project.name, "custom-output-project");
  const rescan = spawnSync(process.execPath, [cli, "scan", "--path", project, "--output", output], { encoding: "utf8" });
  assert.equal(rescan.status, 0, rescan.stderr);
  assert.doesNotMatch(JSON.stringify(await loadGraph(project, output)), /file:\.architecture\//);
  const report = spawnSync(process.execPath, [cli, "report", "--path", project, "--output", output], { encoding: "utf8" });
  assert.equal(report.status, 0, report.stderr);
  assert.match(await readFile(resolve(project, output, "report.md"), "utf8"), /Atlas Architecture Report/);

  const port = 45000 + (process.pid % 1000);
  const server = spawn(process.execPath, [cli, "serve", "--path", project, "--output", output, "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  await waitForOutput(server, `http://localhost:${port}`);
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
  } finally {
    server.kill();
  }

  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, "mcp", "--path", project, "--output", output], stderr: "pipe" });
  const client = new Client({ name: "atlas-custom-output-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    const summary = await client.callTool({ name: "atlas_project_summary", arguments: {} });
    assert.match(JSON.stringify(summary), /custom-output-project/);
  } finally {
    await client.close();
  }

  for (const command of ["open", "serve", "report", "mcp"]) {
    const help = spawnSync(process.execPath, [cli, command, "--help"], { encoding: "utf8" });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /--output <path>/);
  }
});

test("rejects unsupported output formats with a clear CLI error", () => {
  const execution = spawnSync(process.execPath, [cli, "scan", "--path", fixture, "--format", "yaml"], { encoding: "utf8" });
  assert.equal(execution.status, 1);
  assert.match(execution.stderr, /Unsupported format: yaml\. Use json\./);
});

test("identifies Atlas as a publishable Digital Threads package", async () => {
  const packageJson = JSON.parse(await readFile(resolve(here, "../package.json"), "utf8"));
  assert.equal(packageJson.name, "@dthreads/atlas");
  assert.equal(packageJson.bin.atlas, "./dist/cli/index.js");
  assert.equal(packageJson.author, "Digital Threads");
  assert.equal(packageJson.license, "MIT");
  assert.equal(packageJson.private, false);
});
