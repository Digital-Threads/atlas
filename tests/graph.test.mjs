import assert from "node:assert/strict";
import test from "node:test";
import { GraphBuilder, GraphQuery } from "../dist/index.js";

test("graph builder deduplicates edges and query traversal is bidirectional", () => {
  const builder = new GraphBuilder();
  builder.addNode({ id: "project:root", type: "project", label: "Project" });
  builder.addNode({ id: "service:A", type: "service", label: "A" });
  builder.addNode({ id: "service:B", type: "service", label: "B" });
  builder.addEdge({ from: "project:root", to: "service:A", type: "contains" });
  builder.addEdge({ from: "service:A", to: "service:B", type: "calls" });
  builder.addEdge({ from: "service:A", to: "service:B", type: "calls" });
  assert.equal(builder.addEdge({ from: "service:B", to: "missing", type: "calls" }), null);
  assert.deepEqual(builder.validate(), []);

  const graph = builder.toGraph({ name: "test", root: "/tmp/test", detectedStacks: ["nestjs"], createdAt: new Date(0).toISOString() });
  assert.equal(graph.edges.length, 2);
  const query = new GraphQuery(graph);
  assert.deepEqual(new Set(query.getNeighbors("service:A", 1).nodes.map((node) => node.id)), new Set(["project:root", "service:A", "service:B"]));
  assert.ok(query.findDependencies("service:A", 1).nodes.some((node) => node.id === "service:B"));
  assert.ok(query.findDependents("service:A", 1).nodes.some((node) => node.id === "project:root"));
  assert.deepEqual(query.findPath("project:root", "service:B").nodes.map((node) => node.id), ["project:root", "service:A", "service:B"]);
  assert.deepEqual(query.findPath("service:B", "project:root", "both").nodes.map((node) => node.id), ["service:B", "service:A", "project:root"]);
  assert.deepEqual(query.findPath("service:B", "project:root").nodes, []);
  assert.equal(query.search("service:A")[0].score, 60);
});
