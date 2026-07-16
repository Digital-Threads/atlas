import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import cytoscape from "cytoscape";
import { GraphQuery, scanProject } from "../dist/index.js";

test("scans the documented upper-bound NestJS fixture in under 30 seconds", async () => {
  const project = await mkdtemp(resolve(tmpdir(), "atlas-scale-"));
  const src = resolve(project, "src");
  await mkdir(src, { recursive: true });
  await writeFile(resolve(project, "package.json"), JSON.stringify({ name: "atlas-scale", dependencies: { "@nestjs/common": "11.0.0", "@nestjs/core": "11.0.0" } }));
  await writeFile(resolve(project, "tsconfig.json"), JSON.stringify({ compilerOptions: { experimentalDecorators: true } }));
  await writeFile(resolve(src, "app.module.ts"), "import { Module } from '@nestjs/common'; @Module({}) export class AppModule {}\n");

  const writes = [];
  for (let index = 0; index < 100; index += 1) {
    const methods = Array.from({ length: 10 }, (_, method) => "@Get('r" + method + "') route" + method + "() { return " + method + "; }").join("\n");
    writes.push(writeFile(resolve(src, "controller-" + index + ".ts"), "import { Controller, Get } from '@nestjs/common'; @Controller('c" + index + "') export class Controller" + index + " { " + methods + " }\n"));
  }
  for (let index = 0; index < 300; index += 1) {
    writes.push(writeFile(resolve(src, "service-" + index + ".ts"), "import { Injectable } from '@nestjs/common'; @Injectable() export class Service" + index + "Service { first(){} second(){} }\n"));
  }
  for (let index = 0; index < 599; index += 1) writes.push(writeFile(resolve(src, "file-" + index + ".ts"), "export const value" + index + " = " + index + ";\n"));
  await Promise.all(writes);

  const started = performance.now();
  const result = await scanProject({ projectPath: project });
  const duration = performance.now() - started;
  assert.ok(duration < 30_000, `scan took ${Math.round(duration)}ms`);
  assert.equal(result.graph.stats.byNodeType.controller, 100);
  assert.equal(result.graph.stats.byNodeType.service, 300);
  assert.equal(result.graph.stats.byNodeType.route, 1000);
  assert.ok(result.graph.stats.totalNodes >= 4000);

  const parseStarted = performance.now();
  JSON.parse(await readFile(resolve(project, ".atlas/viewer/graph.json"), "utf8"));
  assert.ok(performance.now() - parseStarted < 3000, "viewer graph JSON should parse in under 3 seconds");

  const elements = [];
  for (let index = 0; index < 5000; index += 1) {
    elements.push({ data: { id: `node-${index}`, label: `Node ${index}` }, position: { x: index % 100, y: Math.floor(index / 100) } });
    if (index > 0) elements.push({ data: { id: `edge-${index}`, source: `node-${index - 1}`, target: `node-${index}` } });
  }
  const viewerStarted = performance.now();
  const cy = cytoscape({ headless: true, elements, layout: { name: "preset" } });
  assert.equal(cy.nodes().length, 5000);
  assert.ok(performance.now() - viewerStarted < 3000, "Cytoscape should initialize a 5,000-node graph in under 3 seconds");
  cy.destroy();
});

test("reuses unchanged analysis and invalidates it when source files change", async () => {
  const project = await mkdtemp(resolve(tmpdir(), "atlas-incremental-"));
  const src = resolve(project, "src");
  await mkdir(src, { recursive: true });
  await writeFile(resolve(project, "package.json"), JSON.stringify({ name: "atlas-incremental" }));
  const source = resolve(src, "index.ts");
  await writeFile(source, "export const first = true;\n");

  const first = await scanProject({ projectPath: project });
  assert.equal(first.metadata.cacheHit, false);
  assert.ok(first.metadata.filesHashed >= 2);

  const warmStarted = performance.now();
  const warm = await scanProject({ projectPath: project });
  assert.equal(warm.metadata.cacheHit, true);
  assert.equal(warm.metadata.filesHashed, 0);
  assert.ok(warm.metadata.filesReused >= 2);
  assert.ok(performance.now() - warmStarted < 3000, "warm scan should finish in under 3 seconds");
  assert.equal(JSON.stringify(warm.graph), JSON.stringify(first.graph));

  await writeFile(source, "export const first = true;\nexport const second = true;\n");
  const changed = await scanProject({ projectPath: project });
  assert.equal(changed.metadata.cacheHit, false);
  assert.ok(changed.metadata.filesHashed >= 1);

  const forced = await scanProject({ projectPath: project, incremental: false });
  assert.equal(forced.metadata.cacheHit, false);
  assert.ok(forced.metadata.filesHashed >= 2);
});

test("serves repeated graph queries from indexes on a large graph", () => {
  const nodes = Array.from({ length: 20_000 }, (_, index) => ({
    id: `service:Service${index}`,
    type: "service",
    label: `Service ${index}`,
    source: "ast",
    confidence: 1,
  }));
  const edges = Array.from({ length: 50_000 }, (_, index) => ({
    id: `edge:${index}`,
    from: `service:Service${index % nodes.length}`,
    to: `service:Service${(index * 17 + 1) % nodes.length}`,
    type: "calls",
    source: "ast",
    confidence: 1,
  }));
  const graph = {
    version: "0.3.0",
    project: { name: "query-scale", root: ".", detectedStacks: ["nestjs"], createdAt: new Date().toISOString() },
    nodes,
    edges,
    stats: { totalNodes: nodes.length, totalEdges: edges.length, byNodeType: { service: nodes.length }, byEdgeType: { calls: edges.length } },
  };

  const started = performance.now();
  const query = new GraphQuery(graph);
  let relationships = 0;
  for (let index = 0; index < 20_000; index += 1) {
    relationships += query.getIncoming(`service:Service${index}`).length;
    relationships += query.getOutgoing(`service:Service${index}`).length;
  }
  const duration = performance.now() - started;
  assert.equal(relationships, edges.length * 2);
  assert.ok(duration < 2000, `indexed graph queries took ${Math.round(duration)}ms`);
});
