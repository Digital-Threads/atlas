import assert from "node:assert/strict";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { scanProject } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, "fixtures/nest-app");
const templatePath = resolve(here, "../assets/viewer/index.template.html");

class TestLogic {
  setState(update) {
    const patch = typeof update === "function" ? update(this.state, this.props) : update;
    this.state = { ...this.state, ...(patch ?? {}) };
  }
}

const ReactStub = { createElement: (type, props, ...children) => ({ type, props, children }) };

async function createViewer() {
  const root = await mkdtemp(resolve(tmpdir(), "atlas-viewer-interactions-"));
  const project = resolve(root, "project");
  await cp(fixture, project, { recursive: true });
  await scanProject({ projectPath: project });
  const dataScript = await readFile(resolve(project, ".atlas/viewer/atlas-data.js"), "utf8");
  const D = JSON.parse(dataScript.slice("window.__ATLAS_DATA__=".length, -2));
  const html = await readFile(templatePath, "utf8");
  const source = html.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(source, "viewer component source is missing");
  const Viewer = new Function("DCLogic", "React", `${source}; return Component;`)(TestLogic, ReactStub);
  const viewer = new Viewer();
  viewer.props = { showEdgeLabels: true };
  viewer.state = { ...viewer.state, D, guideOpen: false };
  return viewer;
}

test("trace explorer follows ports to their implementing adapters", async () => {
  const viewer = await createViewer();
  viewer.state = {
    ...viewer.state,
    mode: "services",
    sel: "use_case:CreateUserUseCase",
    trace: true,
    traceRoot: "use_case:CreateUserUseCase",
    traceDepth: "all",
  };

  const scene = viewer.sceneTrace("use_case:CreateUserUseCase");
  assert.ok(scene.nodes.some((node) => node.id === "port:CreateUserPort"));
  assert.ok(scene.nodes.some((node) => node.id === "adapter:CreateUserAdapter"));
  assert.ok(scene.edges.some((edge) => edge.id === "e:port:CreateUserPort>adapter:CreateUserAdapter"));
  assert.match(scene.status, /Complete for the selected filters/);
  assert.ok(scene.nodes.every((node) => [node.x, node.y, node.w, node.h].every(Number.isFinite)));
  assert.ok(scene.edges.every((edge) => edge.d.startsWith("M ") && !edge.d.includes("NaN")));

  const adapter = scene.nodes.find((node) => node.id === "adapter:CreateUserAdapter");
  adapter.onClick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(viewer.state.sel, "adapter:CreateUserAdapter");
  assert.equal(viewer.state.traceRoot, "use_case:CreateUserUseCase", "inspecting a trace node must preserve the original path");
});

test("trace controls progressively disclose depth and filter async work", async () => {
  const viewer = await createViewer();
  viewer.state = { ...viewer.state, mode: "services", sel: "use_case:CreateUserUseCase" };

  let values = viewer.renderVals();
  assert.equal(values.traceLabel, "Trace flow");
  values.toggleTrace();
  assert.equal(viewer.state.trace, true);
  assert.equal(viewer.state.traceDepth, "3");

  values = viewer.renderVals();
  values.traceDepthBtns.find((button) => button.label === "All").go();
  assert.equal(viewer.state.traceDepth, "all");
  assert.match(viewer.scene().status, /Full trace/);

  viewer.state = {
    ...viewer.state,
    sel: "method:OrderPublisher.publishOrder",
    traceRoot: "method:OrderPublisher.publishOrder",
    traceDepth: "all",
    traceAsync: true,
  };
  assert.ok(viewer.scene().nodes.some((node) => node.id === "message_topic:orders.created"));
  viewer.state.traceAsync = false;
  assert.ok(!viewer.scene().nodes.some((node) => node.id === "message_topic:orders.created"));
});

test("project search ranks exact endpoints above incidental file matches", async () => {
  const viewer = await createViewer();
  viewer.state = { ...viewer.state, q: "POST /api/users", searchOpen: true };
  const results = viewer.renderVals().searchResults;
  assert.ok(results.length > 0);
  assert.equal(results[0].label, "POST /api/users");
  assert.equal(results[0].type, "HTTP route");
});

test("focused context uses one methodology and recenters without duplicate cards", async () => {
  const viewer = await createViewer();
  const moduleNode = viewer.state.D.nodes.find((node) => node.type === "module"
    && viewer.state.D.edges.some((edge) => edge.from === node.id || edge.to === node.id));
  assert.ok(moduleNode, "fixture must contain a connected module");
  const otherModule = viewer.state.D.nodes.find((node) => node.type === "module" && node.id !== moduleNode.id);
  assert.ok(otherModule);
  viewer.state.D.edges.push(
    { from: moduleNode.id, to: otherModule.id, verb: "imports", relation: "imports", kind: "sync", confidence: 1, source: "ast" },
    { from: otherModule.id, to: moduleNode.id, verb: "imports", relation: "imports", kind: "sync", confidence: 1, source: "ast" },
  );
  viewer.state = { ...viewer.state, mode: "modules", sel: moduleNode.id, moduleView: "dependencies" };

  const scene = viewer.scene();
  assert.match(scene.status, /One-hop context/);
  assert.ok(scene.cols.some((column) => column.label === "DEPENDED ON BY"));
  assert.ok(scene.cols.some((column) => column.label === "MUTUAL DEPENDENCIES"));
  assert.ok(scene.cols.some((column) => column.label === "MODULE DEPENDENCIES"));
  assert.ok(scene.cols.some((column) => column.label === "OWNED COMPONENTS"));
  assert.equal(new Set(scene.nodes.map((node) => node.id)).size, scene.nodes.length, "a direct neighbour must be rendered once");
  assert.ok(scene.edges.every((edge) => {
    const [from, to] = edge.id.slice(2).split(">");
    return from === moduleNode.id || to === moduleNode.id;
  }), "every one-hop line must touch the selected element");

  const neighbour = scene.nodes.find((node) => node.id !== moduleNode.id);
  assert.ok(neighbour, "module context must expose a clickable neighbour");
  neighbour.onClick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(viewer.state.sel, neighbour.id);
  assert.equal(viewer.state.activeFlow, null);
});

test("module dependencies and internals are separate views", async () => {
  const viewer = await createViewer();
  const moduleNode = viewer.state.D.nodes.find((node) => node.type === "module");
  assert.ok(moduleNode);
  viewer.state = { ...viewer.state, mode: "modules", sel: moduleNode.id, moduleView: "dependencies" };

  let values = viewer.renderVals();
  assert.deepEqual(values.variantBtns.map((button) => button.label), ["Dependencies", "Internals"]);
  values.variantBtns.find((button) => button.label === "Internals").go();
  assert.equal(viewer.state.sel, moduleNode.id);
  assert.equal(viewer.state.moduleView, "internals");
  assert.match(viewer.scene().status, /module boundary above, internal architecture below/);

  values = viewer.renderVals();
  values.variantBtns.find((button) => button.label === "Dependencies").go();
  assert.equal(viewer.state.moduleView, "dependencies");
  assert.match(viewer.scene().status, /One-hop context/);
});

test("HTTP flow explicitly passes through its controller and drills into context", async () => {
  const viewer = await createViewer();
  const candidate = Object.entries(viewer.state.D.flows).map(([id, flow]) => {
    const handled = flow.links.find((edge) => edge.from === flow.root && edge.relation === "handles");
    const controllerEdge = handled && viewer.state.D.edges.find((edge) => edge.to === handled.to
      && edge.relation === "has_method" && viewer.node(edge.from)?.type === "controller");
    return controllerEdge ? { id, flow, handled, controllerEdge } : null;
  }).find(Boolean);
  assert.ok(candidate, "fixture must contain a route, handler and owning controller");
  viewer.state = { ...viewer.state, mode: "routes", sel: candidate.flow.root, activeFlow: candidate.id };

  const scene = viewer.sceneFlow(candidate.flow);
  assert.ok(scene.nodes.some((node) => node.id === candidate.controllerEdge.from));
  assert.ok(scene.edges.some((edge) => edge.id === `e:${candidate.flow.root}>${candidate.controllerEdge.from}`));
  assert.ok(scene.edges.some((edge) => edge.id === `e:${candidate.controllerEdge.from}>${candidate.handled.to}`));
  assert.ok(!scene.edges.some((edge) => edge.id === `e:${candidate.flow.root}>${candidate.handled.to}`));

  const controllerCard = scene.nodes.find((node) => node.id === candidate.controllerEdge.from);
  controllerCard.onClick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(viewer.state.sel, candidate.controllerEdge.from);
  assert.equal(viewer.state.mode, "routes");
  assert.equal(viewer.state.activeFlow, null, "drilling into an element must leave the previous route flow");
  assert.match(viewer.scene().status, /controller operations/);
});

test("database relations show exact foreign-key fields and keep repeated table links", async () => {
  const viewer = await createViewer();
  viewer.state = { ...viewer.state, mode: "database", sel: "table:profiles", dbDetail: "relations" };

  const scene = viewer.scene();
  const mappings = scene.nodes.filter((node) => node.id.startsWith("fk:table:profiles:"));
  assert.ok(mappings.some((node) => node.label === "profiles.user_id → users.id"));
  assert.ok(mappings.some((node) => node.label === "profiles.invited_user_id → users.id"));
  assert.equal(mappings.filter((node) => node.label.endsWith("→ users.id")).length, 2);
  assert.ok(scene.edges.length >= 2, "every visible foreign key must have a directional line");
  assert.ok(scene.edges.every((edge) => edge.d.startsWith("M ") && !edge.d.includes("NaN")));
});

test("ClickHouse overview stays bounded and a selected service opens direct context", async () => {
  const viewer = await createViewer();
  viewer.state = { ...viewer.state, mode: "clickhouse", sel: null };

  const overview = viewer.scene();
  assert.match(overview.status, /ClickHouse overview/);
  assert.ok(overview.nodes.length <= 54);
  assert.ok(overview.nodes.every((node) => !["column", "index", "constraint"].includes(viewer.node(node.id)?.type)));

  const service = viewer.node("service:UsersService");
  service.label = "AnalyticsClickhouseService";
  viewer.reveal(service.id);
  assert.equal(viewer.state.mode, "clickhouse");
  const focused = viewer.scene();
  assert.match(focused.status, /One-hop context/);
  assert.ok(focused.nodes.length < 40, "a ClickHouse service must not expand the complete database catalog");
});
