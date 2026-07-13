import type {
  ArchitectureGraph,
  GraphEdge,
  GraphEdgeType,
  GraphNode,
  GraphSearchResult,
  GraphStats,
  GraphSubgraph,
} from "./types.js";
import { graphEdgeTypes, graphNodeTypes } from "./types.js";

const validNodeTypes = new Set<string>(graphNodeTypes);
const validEdgeTypes = new Set<string>(graphEdgeTypes);

export class GraphBuilder {
  readonly nodes = new Map<string, GraphNode>();
  readonly edges = new Map<string, GraphEdge>();

  addNode(node: GraphNode): GraphNode {
    const current = this.nodes.get(node.id);
    if (!current) {
      this.nodes.set(node.id, node);
      return node;
    }
    const merged = {
      ...current,
      ...node,
      metadata: { ...current.metadata, ...node.metadata },
    };
    this.nodes.set(node.id, merged);
    return merged;
  }

  addEdge(edge: Omit<GraphEdge, "id"> & { id?: string }): GraphEdge | null {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) return null;
    const key = `${edge.from}|${edge.type}|${edge.to}|${edge.label ?? ""}`;
    const id = edge.id ?? `edge:${encodeURIComponent(key)}`;
    const result: GraphEdge = { ...edge, id };
    this.edges.set(key, result);
    return result;
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  validate(): string[] {
    const errors: string[] = [];
    for (const node of this.nodes.values()) {
      if (!validNodeTypes.has(String(node.type))) errors.push(`${node.id}: invalid node type ${String(node.type)}`);
    }
    for (const edge of this.edges.values()) {
      if (!validEdgeTypes.has(String(edge.type))) errors.push(`${edge.id}: invalid edge type ${String(edge.type)}`);
      if (!this.nodes.has(edge.from)) errors.push(`${edge.id}: missing source ${edge.from}`);
      if (!this.nodes.has(edge.to)) errors.push(`${edge.id}: missing target ${edge.to}`);
    }
    return errors;
  }

  toGraph(project: ArchitectureGraph["project"]): ArchitectureGraph {
    const nodes = [...this.nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
    const edges = [...this.edges.values()].sort((a, b) => a.id.localeCompare(b.id));
    return { version: "0.1.0", project, nodes, edges, stats: buildStats(nodes, edges) };
  }
}

function increment<T extends string>(target: Partial<Record<T, number>>, key: T) {
  target[key] = (target[key] ?? 0) + 1;
}

export function buildStats(nodes: GraphNode[], edges: GraphEdge[]): GraphStats {
  const byNodeType: GraphStats["byNodeType"] = Object.create(null) as GraphStats["byNodeType"];
  const byEdgeType: GraphStats["byEdgeType"] = Object.create(null) as GraphStats["byEdgeType"];
  for (const node of nodes) increment(byNodeType, node.type);
  for (const edge of edges) increment(byEdgeType, edge.type);
  return { totalNodes: nodes.length, totalEdges: edges.length, byNodeType, byEdgeType };
}

export class GraphQuery {
  private readonly nodeMap: Map<string, GraphNode>;

  constructor(readonly graph: ArchitectureGraph) {
    this.nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  }

  findNode(query: string): GraphNode[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return this.graph.nodes
      .filter((node) => searchableNode(node).includes(needle))
      .sort((a, b) => scoreNode(b, needle) - scoreNode(a, needle))
      .slice(0, 100);
  }

  search(query: string): GraphSearchResult[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return this.findNode(query).map((node) => ({
      node,
      score: scoreNode(node, needle),
      matches: matchingFields(node, needle),
    }));
  }

  getNode(id: string): GraphNode | null {
    return this.nodeMap.get(id) ?? null;
  }

  getIncoming(id: string): GraphEdge[] {
    return this.graph.edges.filter((edge) => edge.to === id);
  }

  getOutgoing(id: string): GraphEdge[] {
    return this.graph.edges.filter((edge) => edge.from === id);
  }

  findRoutes(): GraphNode[] { return this.byType("route"); }
  findServices(): GraphNode[] { return this.byType("service"); }
  findControllers(): GraphNode[] { return this.byType("controller"); }
  findTables(): GraphNode[] { return this.byType("table"); }
  findExternalApis(): GraphNode[] { return this.byType("external_api"); }

  getNeighbors(nodeId: string, depth = 1): GraphSubgraph {
    if (!this.nodeMap.has(nodeId)) return { nodes: [], edges: [] };
    const nodeIds = new Set([nodeId]);
    const edgeIds = new Set<string>();
    let frontier = [nodeId];
    for (let level = 0; level < Math.max(0, depth) && frontier.length; level += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const edge of [...this.getIncoming(id), ...this.getOutgoing(id)]) {
          edgeIds.add(edge.id);
          const neighbor = edge.from === id ? edge.to : edge.from;
          if (!nodeIds.has(neighbor)) { nodeIds.add(neighbor); next.push(neighbor); }
        }
      }
      frontier = next;
    }
    return {
      nodes: [...nodeIds].map((id) => this.nodeMap.get(id)).filter(Boolean) as GraphNode[],
      edges: this.graph.edges.filter((edge) => edgeIds.has(edge.id)),
    };
  }

  findFlowFromRoute(routeId: string): GraphSubgraph {
    return this.walk(routeId, "outgoing", 12, new Set([
      "handles", "calls", "reads", "writes", "uses", "connects_to", "validates", "returns",
    ]));
  }

  findDependencies(nodeId: string, depth = 2): GraphSubgraph {
    return this.walk(nodeId, "outgoing", depth);
  }

  findDependents(nodeId: string, depth = 2): GraphSubgraph {
    return this.walk(nodeId, "incoming", depth);
  }

  private byType(type: GraphNode["type"]): GraphNode[] {
    return this.graph.nodes.filter((node) => node.type === type);
  }

  private walk(
    startId: string,
    direction: "incoming" | "outgoing",
    depth: number,
    allowedTypes?: Set<GraphEdgeType>,
  ): GraphSubgraph {
    if (!this.nodeMap.has(startId)) return { nodes: [], edges: [] };
    const nodeIds = new Set([startId]);
    const edgeIds = new Set<string>();
    let frontier = [startId];
    for (let level = 0; level < Math.max(0, depth) && frontier.length; level += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        const edges = direction === "outgoing" ? this.getOutgoing(id) : this.getIncoming(id);
        for (const edge of edges) {
          if (allowedTypes && !allowedTypes.has(edge.type)) continue;
          edgeIds.add(edge.id);
          const neighbor = direction === "outgoing" ? edge.to : edge.from;
          if (!nodeIds.has(neighbor)) {
            nodeIds.add(neighbor);
            next.push(neighbor);
          }
        }
      }
      frontier = next;
    }
    return {
      nodes: [...nodeIds].map((id) => this.nodeMap.get(id)).filter(Boolean) as GraphNode[],
      edges: this.graph.edges.filter((edge) => edgeIds.has(edge.id)),
    };
  }
}

function searchableNode(node: GraphNode): string {
  return [node.id, node.type, node.label, node.name, node.file, JSON.stringify(node.metadata ?? {})]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function scoreNode(node: GraphNode, needle: string): number {
  const label = node.label.toLowerCase();
  if (label === needle) return 100;
  if (label.startsWith(needle)) return 80;
  if (node.id.toLowerCase().includes(needle)) return 60;
  return 20;
}

function matchingFields(node: GraphNode, needle: string): string[] {
  const fields = {
    id: node.id,
    label: node.label,
    name: node.name ?? "",
    type: node.type,
    file: node.file ?? "",
    metadata: JSON.stringify(node.metadata ?? {}),
  };
  return Object.entries(fields).filter(([, value]) => value.toLowerCase().includes(needle)).map(([key]) => key);
}
