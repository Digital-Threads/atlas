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
