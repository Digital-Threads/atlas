import { readFile } from "node:fs/promises";
import { buildStats } from "../core/graph.js";
import { graphNodeTypes, type ArchitectureGraph, type GraphEdge, type GraphNode, type RuntimeTraceEvent, type RuntimeTraceNode } from "../core/types.js";

const validNodeTypes = new Set<string>(graphNodeTypes);

export async function readRuntimeEvents(path: string): Promise<RuntimeTraceEvent[]> {
  const content = await readFile(path, "utf8").catch(() => "");
  if (!content.trim()) return [];
  const events = new Map<string, RuntimeTraceEvent>();
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as RuntimeTraceEvent;
      if (event.from && event.to && event.type) {
        const key = edgeKey(event.from, event.type, event.to);
        const current = events.get(key);
        events.set(key, {
          ...current,
          ...event,
          count: (current?.count ?? 0) + Math.max(1, event.count ?? 1),
          durationMs: (current?.durationMs ?? 0) + Math.max(0, event.durationMs ?? 0),
          metadata: { ...current?.metadata, ...event.metadata },
        });
      }
    } catch {
      throw new Error(`Invalid runtime trace JSON on line ${index + 1}`);
    }
  }
  return [...events.values()];
}

export function mergeRuntimeEvidence(graph: ArchitectureGraph, events: RuntimeTraceEvent[]): ArchitectureGraph {
  const nodes = new Map(graph.nodes.map((node) => [node.id, { ...node, metadata: { ...node.metadata } }]));
  const edges = new Map(graph.edges.map((edge) => [edgeKey(edge.from, edge.type, edge.to), { ...edge, metadata: { ...edge.metadata } }]));
  for (const event of events) {
    const from = resolveNodeId(nodes, event.from, event.fromNode);
    const to = resolveNodeId(nodes, event.to, event.toNode);
    const key = edgeKey(from, event.type, to);
    const current = edges.get(key);
    const observations = Math.max(1, event.count ?? 1);
    const runtimeMetadata = {
      ...current?.metadata,
      ...event.metadata,
      runtimeObserved: true,
      runtimeObservations: observations,
      lastObservedAt: event.timestamp ?? new Date().toISOString(),
      ...(event.durationMs !== undefined ? { runtimeDurationMs: event.durationMs } : {}),
      evidenceSources: [...new Set([...(Array.isArray(current?.metadata?.evidenceSources) ? current.metadata.evidenceSources as string[] : []), current?.source, "runtime"].filter(Boolean))],
    };
    edges.set(key, current ? {
      ...current,
      confidence: 1,
      metadata: runtimeMetadata,
    } : {
      id: `edge:${encodeURIComponent(key)}`,
      from,
      to,
      type: event.type,
      source: "runtime",
      confidence: 1,
      metadata: runtimeMetadata,
    });
  }
  const nextNodes = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const nextEdges = [...edges.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { ...graph, nodes: nextNodes, edges: nextEdges, stats: buildStats(nextNodes, nextEdges) };
}

function resolveNodeId(nodes: Map<string, GraphNode>, requestedId: string, descriptor?: RuntimeTraceNode): string {
  if (nodes.has(requestedId)) return requestedId;
  const method = requestedId.match(/^method:([^.@]+)\.([^@]+)$/);
  if (method) {
    const matches = [...nodes.values()].filter((node) => node.type === "method" && node.metadata?.class === method[1] && node.metadata?.method === method[2]);
    if (matches.length === 1) return matches[0].id;
  }
  if (!nodes.has(requestedId)) {
    const prefix = requestedId.split(":", 1)[0];
    const type = descriptor?.type ?? (validNodeTypes.has(prefix) ? prefix as GraphNode["type"] : "provider");
    nodes.set(requestedId, {
      id: requestedId,
      type,
      label: descriptor?.label ?? requestedId,
      name: descriptor?.label ?? requestedId,
      file: descriptor?.file,
      source: "runtime",
      confidence: 1,
      metadata: { runtimeObserved: true },
    });
  }
  return requestedId;
}

function edgeKey(from: string, type: GraphEdge["type"], to: string): string {
  return `${from}|${type}|${to}`;
}
