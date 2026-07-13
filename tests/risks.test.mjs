import assert from "node:assert/strict";
import test from "node:test";
import { detectRisks, GraphBuilder } from "../dist/index.js";

test("detects every documented MVP architecture risk", () => {
  const builder = new GraphBuilder();
  const add = (id, type) => builder.addNode({ id, type, label: id.split(":").at(-1) });
  const edge = (from, to, type) => builder.addEdge({ from, to, type });

  add("service:RiskyService", "service");
  add("method:RiskyService.run", "method");
  edge("service:RiskyService", "method:RiskyService.run", "has_method");
  for (let index = 0; index < 6; index += 1) {
    add(`provider:Dependency${index}`, "provider");
    edge("service:RiskyService", `provider:Dependency${index}`, "injects");
  }
  for (let index = 0; index < 4; index += 1) {
    add(`external_api:api${index}.example.test`, "external_api");
    edge("method:RiskyService.run", `external_api:api${index}.example.test`, "connects_to");
  }

  add("controller:LargeController", "controller");
  add("route:GET:/direct", "route");
  add("table:records", "table");
  for (let index = 0; index < 11; index += 1) {
    add(`method:LargeController.action${index}`, "method");
    edge("controller:LargeController", `method:LargeController.action${index}`, "has_method");
  }
  edge("route:GET:/direct", "method:LargeController.action0", "handles");
  edge("method:LargeController.action0", "table:records", "reads");

  add("file:a.ts", "file");
  add("file:b.ts", "file");
  edge("file:a.ts", "file:b.ts", "imports");
  edge("file:b.ts", "file:a.ts", "imports");

  const graph = builder.toGraph({ name: "risk-fixture", root: "/tmp/risk-fixture", detectedStacks: ["nestjs"], createdAt: new Date(0).toISOString() });
  const types = new Set(detectRisks(graph).map((risk) => risk.type));
  assert.deepEqual(types, new Set([
    "too-many-dependencies",
    "missing-service-test",
    "too-many-external-apis",
    "large-controller",
    "controller-database-access",
    "route-without-service",
    "circular-import",
  ]));
});
