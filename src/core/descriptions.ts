import type { ArchitectureGraph, GraphEdge, GraphEdgeType, GraphNode, GraphNodeType } from "./types.js";

const flowEdgeTypes = new Set<GraphEdgeType>([
  "handles", "calls", "reads", "writes", "uses", "connects_to",
  "validates", "returns", "decorates",
]);

interface GraphIndex {
  nodes: Map<string, GraphNode>;
  incoming: Map<string, GraphEdge[]>;
  outgoing: Map<string, GraphEdge[]>;
}

export function enrichGraphDescriptions(graph: ArchitectureGraph): ArchitectureGraph {
  const index = buildIndex(graph);
  const nodes = graph.nodes.map((node) => {
    const description = String(node.metadata?.description ?? "") || describeNode(node, index);
    const flowDescription = node.type === "route" ? describeFlow(node, index) : "";
    if (!description && !flowDescription) return node;
    return {
      ...node,
      metadata: {
        ...node.metadata,
        ...(description ? { description } : {}),
        ...(flowDescription ? { flowDescription } : {}),
      },
    };
  });
  return { ...graph, nodes };
}

function buildIndex(graph: ArchitectureGraph): GraphIndex {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map(graph.nodes.map((node) => [node.id, [] as GraphEdge[]]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as GraphEdge[]]));
  for (const edge of graph.edges) {
    outgoing.get(edge.from)?.push(edge);
    incoming.get(edge.to)?.push(edge);
  }
  return { nodes, incoming, outgoing };
}

function describeNode(node: GraphNode, index: GraphIndex): string {
  if (node.type === "module") return describeModule(node, index);
  if (node.type === "controller") return describeController(node, index);
  if (["service", "provider", "repository"].includes(node.type)) return describeProvider(node, index);
  if (node.type === "method") return describeMethod(node, index);
  if (node.type === "function") return describeFunction(node, index);
  if (node.type === "route") return describeFlow(node, index);
  return "";
}

function describeModule(node: GraphNode, index: GraphIndex): string {
  const controllers = relatedNodes(node.id, index, "out", ["contains"], ["controller"]);
  const providers = relatedNodes(node.id, index, "out", ["provides"], ["service", "provider", "repository"]);
  const dependencies = relatedNodes(node.id, index, "out", ["imports", "exports"], ["module"]);
  const consumers = relatedNodes(node.id, index, "in", ["imports", "exports"], ["module"]);
  const sentences = ["NestJS module" + sourceClause(node) + "."];
  if (controllers.length || providers.length) {
    sentences.push("It contains " + countLabel(controllers.length, "controller") + " and provides " + countLabel(providers.length, "service or provider", "services or providers") + ".");
  }
  if (dependencies.length) sentences.push("It depends on " + nameList(dependencies) + ".");
  if (consumers.length) sentences.push("It is used by " + nameList(consumers) + ".");
  return sentences.join(" ");
}

function describeController(node: GraphNode, index: GraphIndex): string {
  const methods = relatedNodes(node.id, index, "out", ["has_method"], ["method"]);
  const methodIds = new Set(methods.map((method) => method.id));
  const routes = uniqueNodes(methods.flatMap((method) => (index.incoming.get(method.id) ?? [])
    .filter((edge) => edge.type === "handles")
    .map((edge) => index.nodes.get(edge.from)))
    .filter(isNode));
  const calls = operationTargets(methodIds, index, ["calls"], ["method", "service", "provider", "repository"]);
  const sentences = ["NestJS controller" + sourceClause(node) + "."];
  sentences.push("It exposes " + countLabel(routes.length, "HTTP route") + " through " + countLabel(methods.length, "method") + ".");
  if (calls.length) sentences.push("Its handlers call " + nameList(calls) + ".");
  return sentences.join(" ");
}

function describeProvider(node: GraphNode, index: GraphIndex): string {
  const methods = relatedNodes(node.id, index, "out", ["has_method"], ["method"]);
  const methodIds = new Set(methods.map((method) => method.id));
  const operationIds = callChainIds(methodIds, index);
  const consumers = relatedNodes(node.id, index, "in", ["injects", "provides"], [
    "module", "controller", "service", "provider", "repository",
  ]);
  const dependencies = relatedNodes(node.id, index, "out", ["injects"], [
    "service", "provider", "repository",
  ]);
  const reads = operationTargets(operationIds, index, ["reads"], ["table", "entity", "model", "database"]);
  const writes = operationTargets(operationIds, index, ["writes"], ["table", "entity", "model", "database"]);
  const external = operationTargets(operationIds, index, ["connects_to"], ["external_api"]);
  const kind = node.type === "repository" ? "repository" : node.type === "service" ? "service" : "provider";
  const sentences = ["NestJS " + kind + sourceClause(node) + " with " + countLabel(methods.length, "detected method") + "."];
  if (consumers.length) sentences.push("It is injected into or provided by " + nameList(consumers) + ".");
  if (dependencies.length) sentences.push("It depends on " + nameList(dependencies) + ".");
  if (reads.length) sentences.push("It reads " + nameList(reads) + ".");
  if (writes.length) sentences.push("It writes " + nameList(writes) + ".");
  if (external.length) sentences.push("It connects to " + nameList(external) + ".");
  return sentences.join(" ");
}

function describeMethod(node: GraphNode, index: GraphIndex): string {
  const owners = relatedNodes(node.id, index, "in", ["has_method", "declares"], [
    "module", "controller", "service", "provider", "repository", "file",
  ]);
  const routes = relatedNodes(node.id, index, "in", ["handles"], ["route"]);
  const calls = relatedNodes(node.id, index, "out", ["calls"], ["method", "service", "provider", "repository"]);
  const reads = relatedNodes(node.id, index, "out", ["reads"], ["table", "entity", "model", "database"]);
  const writes = relatedNodes(node.id, index, "out", ["writes"], ["table", "entity", "model", "database"]);
  const external = relatedNodes(node.id, index, "out", ["connects_to"], ["external_api"]);
  const sentences = [
    owners.length
      ? "Method of " + nameList(owners, 2) + sourceClause(node) + "."
      : "Method" + sourceClause(node) + ".",
  ];
  if (routes.length) sentences.push("It handles " + nameList(routes, 2) + ".");
  if (calls.length) sentences.push("It calls " + nameList(calls) + ".");
  if (reads.length) sentences.push("It reads " + nameList(reads) + ".");
  if (writes.length) sentences.push("It writes " + nameList(writes) + ".");
  if (external.length) sentences.push("It connects to " + nameList(external) + ".");
  if (sentences.length === 1) sentences.push(signatureSentence(node));
  return sentences.join(" ");
}

function describeFunction(node: GraphNode, index: GraphIndex): string {
  const owners = relatedNodes(node.id, index, "in", ["declares"], ["file"]);
  const declaration = owners[0] ? " declared in " + owners[0].label : sourceClause(node);
  return "Top-level function" + declaration + ". " + signatureSentence(node);
}

function describeFlow(route: GraphNode, index: GraphIndex): string {
  const ids = flowIds(route.id, index);
  const flowEdges = [...ids].flatMap((id) => index.outgoing.get(id) ?? [])
    .filter((edge) => ids.has(edge.to) && flowEdgeTypes.has(edge.type));
  const handler = flowEdges.find((edge) => edge.from === route.id && edge.type === "handles");
  const handlerNode = handler ? index.nodes.get(handler.to) : undefined;
  const guards = nodesOfTypes(ids, index, ["guard", "pipe", "interceptor", "middleware"]);
  const calls = nodesFromEdges(flowEdges, index, ["calls"], ["method", "service", "provider", "repository"]);
  const reads = nodesFromEdges(flowEdges, index, ["reads"], ["table", "entity", "model", "database"]);
  const writes = nodesFromEdges(flowEdges, index, ["writes"], ["table", "entity", "model", "database"]);
  const external = nodesFromEdges(flowEdges, index, ["connects_to"], ["external_api"]);
  const sentences = [
    handlerNode
      ? route.label + " enters the application through " + handlerNode.label + "."
      : route.label + " is a detected HTTP entry point.",
  ];
  if (guards.length) sentences.push("The request passes through " + nameList(guards) + ".");
  if (calls.length) sentences.push("The execution chain calls " + nameList(calls, 5) + ".");
  if (reads.length) sentences.push("It reads " + nameList(reads) + ".");
  if (writes.length) sentences.push("It writes " + nameList(writes) + ".");
  if (external.length) sentences.push("It connects to " + nameList(external) + ".");
  sentences.push("Atlas detected " + countLabel(ids.size, "stage") + " in this request flow.");
  return sentences.join(" ");
}

function flowIds(rootId: string, index: GraphIndex): Set<string> {
  const ids = new Set([rootId]);
  const queue = [rootId];
  while (queue.length && ids.size < 100) {
    const current = queue.shift();
    if (!current) break;
    for (const edge of index.outgoing.get(current) ?? []) {
      if (!flowEdgeTypes.has(edge.type) || ids.has(edge.to)) continue;
      ids.add(edge.to);
      queue.push(edge.to);
    }
  }
  return ids;
}

function relatedNodes(
  id: string,
  index: GraphIndex,
  direction: "in" | "out",
  edgeTypes: GraphEdgeType[],
  nodeTypes: GraphNodeType[],
): GraphNode[] {
  const allowedEdges = new Set(edgeTypes);
  const allowedNodes = new Set(nodeTypes);
  const edges = direction === "out" ? index.outgoing.get(id) ?? [] : index.incoming.get(id) ?? [];
  return uniqueNodes(edges
    .filter((edge) => allowedEdges.has(edge.type))
    .map((edge) => index.nodes.get(direction === "out" ? edge.to : edge.from))
    .filter((node): node is GraphNode => Boolean(node && allowedNodes.has(node.type))));
}

function operationTargets(
  ownerIds: Set<string>,
  index: GraphIndex,
  edgeTypes: GraphEdgeType[],
  nodeTypes: GraphNodeType[],
): GraphNode[] {
  const allowedEdges = new Set(edgeTypes);
  const allowedNodes = new Set(nodeTypes);
  return uniqueNodes([...ownerIds]
    .flatMap((id) => index.outgoing.get(id) ?? [])
    .filter((edge) => allowedEdges.has(edge.type))
    .map((edge) => index.nodes.get(edge.to))
    .filter((node): node is GraphNode => Boolean(node && allowedNodes.has(node.type))));
}

function callChainIds(startIds: Set<string>, index: GraphIndex): Set<string> {
  const ids = new Set(startIds);
  const queue = [...startIds].map((id) => ({ id, depth: 0 }));
  while (queue.length && ids.size < 200) {
    const current = queue.shift();
    if (!current || current.depth >= 8) continue;
    for (const edge of index.outgoing.get(current.id) ?? []) {
      if (edge.type !== "calls" || ids.has(edge.to)) continue;
      ids.add(edge.to);
      queue.push({ id: edge.to, depth: current.depth + 1 });
    }
  }
  return ids;
}

function nodesFromEdges(
  edges: GraphEdge[],
  index: GraphIndex,
  edgeTypes: GraphEdgeType[],
  nodeTypes: GraphNodeType[],
): GraphNode[] {
  const allowedEdges = new Set(edgeTypes);
  const allowedNodes = new Set(nodeTypes);
  return uniqueNodes(edges
    .filter((edge) => allowedEdges.has(edge.type))
    .map((edge) => index.nodes.get(edge.to))
    .filter((node): node is GraphNode => Boolean(node && allowedNodes.has(node.type))));
}

function nodesOfTypes(ids: Set<string>, index: GraphIndex, types: GraphNodeType[]): GraphNode[] {
  const allowed = new Set(types);
  return uniqueNodes([...ids]
    .map((id) => index.nodes.get(id))
    .filter((node): node is GraphNode => Boolean(node && allowed.has(node.type))));
}

function uniqueNodes(nodes: GraphNode[]): GraphNode[] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()]
    .sort((left, right) => left.label.localeCompare(right.label));
}

function nameList(nodes: GraphNode[], limit = 3): string {
  const names = nodes.slice(0, limit).map((node) => node.label);
  if (nodes.length > limit) names.push(String(nodes.length - limit) + " more");
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(", ") + " and " + names.at(-1);
}

function countLabel(count: number, singular: string, plural = singular + "s"): string {
  return String(count) + " " + (count === 1 ? singular : plural);
}

function sourceClause(node: GraphNode): string {
  return node.file ? " declared in " + node.file : "";
}

function signatureSentence(node: GraphNode): string {
  const parameters = Array.isArray(node.metadata?.parameters) ? node.metadata.parameters.length : 0;
  const returnType = String(node.metadata?.returnType ?? "").trim();
  return "It accepts " + countLabel(parameters, "parameter") + (returnType ? " and returns " + returnType : "") + ".";
}

function isNode(node: GraphNode | undefined): node is GraphNode {
  return Boolean(node);
}
