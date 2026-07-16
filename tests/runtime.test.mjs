import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { createNestRuntimeInterceptor, mergeRuntimeEvidence, readRuntimeEvents, RuntimeTracer } from "../dist/index.js";

test("records local NestJS observations and merges them idempotently with static evidence", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "atlas-runtime-"));
  const output = resolve(root, "runtime.jsonl");
  const tracer = new RuntimeTracer({ outputPath: output, flushIntervalMs: 60_000 });
  const interceptor = createNestRuntimeInterceptor(tracer);
  const returned = interceptor.intercept({
    getClass: () => ({ name: "UsersController" }),
    getHandler: () => ({ name: "create" }),
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => ({ method: "POST", baseUrl: "/api", route: { path: "/users" } }) }),
  }, { handle: () => "handled" });
  assert.equal(returned, "handled");
  tracer.edge("method:UsersController.create", "method:UsersService.create", "calls", { observed: true });
  await tracer.flush();

  const events = await readRuntimeEvents(output);
  assert.equal(events.length, 2);
  const graph = {
    version: "0.1.0",
    project: { name: "runtime-test", root, detectedStacks: ["nestjs"], createdAt: new Date().toISOString() },
    nodes: [
      { id: "route:POST:/api/users", type: "route", label: "POST /api/users", source: "ast", confidence: 1 },
      { id: "method:UsersController.create", type: "method", label: "UsersController.create", source: "ast", confidence: 1, metadata: { class: "UsersController", method: "create" } },
      { id: "method:UsersService.create", type: "method", label: "UsersService.create", source: "ast", confidence: 1, metadata: { class: "UsersService", method: "create" } },
    ],
    edges: [{ id: "static-route", from: "route:POST:/api/users", to: "method:UsersController.create", type: "handles", source: "ast", confidence: 1 }],
    stats: { totalNodes: 3, totalEdges: 1, byNodeType: {}, byEdgeType: {} },
  };
  const merged = mergeRuntimeEvidence(graph, events);
  const routeEdge = merged.edges.find((edge) => edge.type === "handles");
  assert.equal(routeEdge.metadata.runtimeObserved, true);
  assert.equal(routeEdge.metadata.runtimeObservations, 1);
  assert.deepEqual(routeEdge.metadata.evidenceSources, ["ast", "runtime"]);
  assert.ok(merged.edges.some((edge) => edge.from === "method:UsersController.create" && edge.to === "method:UsersService.create" && edge.source === "runtime"));

  const additional = new RuntimeTracer({ outputPath: output, flushIntervalMs: 60_000 });
  additional.edge("method:UsersController.create", "method:UsersService.create", "calls");
  additional.edge("method:UsersController.create", "method:UsersService.create", "calls");
  await additional.flush();
  const cumulative = await readRuntimeEvents(output);
  const remerged = mergeRuntimeEvidence(merged, cumulative);
  const callEdge = remerged.edges.find((edge) => edge.type === "calls");
  assert.equal(callEdge.metadata.runtimeObservations, 3);
});
