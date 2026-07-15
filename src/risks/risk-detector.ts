import type { ArchitectureGraph, ArchitectureRisk, GraphEdge, GraphNode } from "../core/types.js";

export function detectRisks(graph: ArchitectureGraph): ArchitectureRisk[] {
  const risks: ArchitectureRisk[] = [];
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = groupEdges(graph.edges, "from");
  const incoming = groupEdges(graph.edges, "to");

  for (const service of graph.nodes.filter((node) => node.type === "service")) {
    const dependencies = (outgoing.get(service.id) ?? []).filter((edge) => edge.type === "injects");
    if (dependencies.length > 5) {
      risks.push(risk("too-many-dependencies", "high", `${service.label} has ${dependencies.length} injected dependencies`, "The service has a large dependency surface and may own too many responsibilities.", "Split the service by cohesive business capability.", service));
    }
    const tested = (incoming.get(service.id) ?? []).some((edge) => edge.type === "tests");
    if (!tested) {
      risks.push(risk("missing-service-test", "medium", `${service.label} has no detected test`, "No *.spec.ts or *.test.ts import was linked to this service.", "Add focused unit tests for the service's public behavior.", service));
    }
    const apiCount = new Set(walkTargets(service.id, graph, new Set(["has_method", "connects_to"]), 2)
      .filter((id) => nodes.get(id)?.type === "external_api")).size;
    if (apiCount > 3) {
      risks.push(risk("too-many-external-apis", "high", `${service.label} connects to ${apiCount} external APIs`, "The service coordinates many remote systems and has a wide failure surface.", "Move integrations behind dedicated adapters and define timeout/fallback policies.", service));
    }
  }

  for (const controller of graph.nodes.filter((node) => node.type === "controller")) {
    const methods = (outgoing.get(controller.id) ?? []).filter((edge) => edge.type === "has_method");
    if (methods.length > 10) {
      risks.push(risk("large-controller", "medium", `${controller.label} exposes ${methods.length} methods`, "The controller may be handling too many responsibilities.", "Split routes into smaller controllers grouped by resource or use case.", controller));
    }
    const directDatabase = methods.some((edge) => (outgoing.get(edge.to) ?? []).some((item) => item.type === "reads" || item.type === "writes"));
    if (directDatabase) {
      risks.push(risk("controller-database-access", "high", `${controller.label} directly accesses the database`, "A controller method has a reads/writes edge to a table.", "Move database access into a service or repository layer.", controller));
    }
  }

  for (const route of graph.nodes.filter((node) => node.type === "route")) {
    const handler = (outgoing.get(route.id) ?? []).find((edge) => edge.type === "handles")?.to;
    if (!handler) continue;
    const callsService = (outgoing.get(handler) ?? []).some((edge) => {
      if (edge.type !== "calls") return false;
      const target = nodes.get(edge.to);
      if (target?.type === "service") return true;
      const className = String(target?.metadata?.class ?? "");
      return graph.nodes.some((node) => node.type === "service" && node.name === className);
    });
    if (!callsService) {
      risks.push(risk("route-without-service", "low", `${route.label} has no detected service call`, "The route handler does not call a known service method.", "Confirm that business logic is delegated to a service layer.", route));
    }
  }

  for (const container of graph.nodes.filter((node) => node.type === "container" && node.framework === "kubernetes")) {
    if (!container.metadata?.resources) {
      risks.push(risk("missing-container-resources", "medium", `${container.label} has no detected resource policy`, "The Kubernetes container has no detected CPU or memory requests/limits.", "Define resource requests and limits for predictable scheduling and capacity planning.", container));
    }
    if (!container.metadata?.readinessProbe || !container.metadata?.livenessProbe) {
      risks.push(risk("missing-container-probes", "high", `${container.label} has incomplete health probes`, "The Kubernetes container is missing a readiness or liveness probe.", "Add both probes so traffic and restarts follow application health.", container));
    }
  }

  for (const image of graph.nodes.filter((node) => node.type === "container_image" && !node.metadata?.baseImage && !node.metadata?.localBuild)) {
    if (!image.label.includes(":") || /:latest$/i.test(image.label)) {
      risks.push(risk("mutable-container-image", "high", `${image.label} uses a mutable image reference`, "The deployment cannot be reliably reproduced from an unpinned container tag.", "Publish and deploy an immutable version or digest.", image));
    }
  }

  for (const migration of graph.nodes.filter((node) => node.type === "migration")) {
    const destructive = (outgoing.get(migration.id) ?? []).filter((edge) => edge.type === "drops");
    if (destructive.length) {
      risks.push(risk("destructive-migration", "high", `${migration.label} contains destructive changes`, `The migration drops ${destructive.length} detected database structure(s).`, "Review rollback, backup, and zero-downtime compatibility before deployment.", migration));
    }
  }

  for (const deployment of graph.nodes.filter((node) => node.type === "deployment" && node.metadata?.environment === "production" && node.framework === "kubernetes")) {
    if (typeof deployment.metadata?.replicas === "number" && deployment.metadata.replicas < 2) {
      risks.push(risk("single-production-replica", "high", `${deployment.label} has one production replica`, "A single replica creates an availability gap during failure or rollout.", "Run at least two replicas when the workload and budget allow it.", deployment));
    }
  }

  for (const cycle of findImportCycles(graph)) {
    const first = nodes.get(cycle[0]);
    risks.push({
      id: `risk:circular-import:${risks.length + 1}`,
      type: "circular-import",
      severity: "high",
      title: "Circular file imports detected",
      description: cycle.join(" -> "),
      recommendation: "Break the cycle by extracting a shared contract or reversing one dependency.",
      nodeId: first?.id,
      file: first?.file,
      metadata: { cycle },
    });
  }

  return risks;
}

function risk(type: string, severity: ArchitectureRisk["severity"], title: string, description: string, recommendation: string, node: GraphNode): ArchitectureRisk {
  return { id: `risk:${type}:${node.id}`, type, severity, title, description, recommendation, nodeId: node.id, file: node.file };
}

function groupEdges(edges: GraphEdge[], key: "from" | "to"): Map<string, GraphEdge[]> {
  const result = new Map<string, GraphEdge[]>();
  for (const edge of edges) result.set(edge[key], [...(result.get(edge[key]) ?? []), edge]);
  return result;
}

function walkTargets(start: string, graph: ArchitectureGraph, allowed: Set<GraphEdge["type"]>, depth: number): string[] {
  const result = new Set<string>();
  let frontier = [start];
  for (let level = 0; level < depth; level += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of graph.edges.filter((item) => item.from === id && allowed.has(item.type))) {
        if (!result.has(edge.to)) { result.add(edge.to); next.push(edge.to); }
      }
    }
    frontier = next;
  }
  return [...result];
}

function findImportCycles(graph: ArchitectureGraph): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges.filter((item) => item.type === "imports" && item.from.startsWith("file:") && item.to.startsWith("file:"))) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
  }
  const cycles = new Map<string, string[]>();
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];
  const visit = (id: string) => {
    if (active.has(id)) {
      const start = stack.indexOf(id);
      const cycle = [...stack.slice(start), id];
      const key = [...new Set(cycle)].sort().join("|");
      cycles.set(key, cycle);
      return;
    }
    if (visited.has(id)) return;
    visited.add(id); active.add(id); stack.push(id);
    for (const target of adjacency.get(id) ?? []) visit(target);
    stack.pop(); active.delete(id);
  };
  for (const id of adjacency.keys()) visit(id);
  return [...cycles.values()].slice(0, 50);
}
