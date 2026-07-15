import type { ArchitectureGraph, ArchitectureRisk, GraphEdge, GraphNode, ScanMetadata } from "../core/types.js";

type ViewerKind = "sync" | "async" | "data" | "external";

interface ViewerNode {
  id: string;
  type: string;
  label: string;
  file: string;
  domain: string;
  desc: string;
  metrics?: Record<string, string | number>;
  severity?: string;
  details?: Record<string, string | number | boolean | string[]>;
}

interface ViewerEdge {
  from: string;
  to: string;
  verb: string;
  kind: ViewerKind;
  relation?: GraphEdge["type"];
  details?: Record<string, string | number | boolean | string[]>;
  count?: number;
  n?: number;
}

interface ViewerFlow {
  title: string;
  summary: string;
  root: string;
  steps: Array<{ id: string; col: number; row: number; stage: string }>;
  links: ViewerEdge[];
  ends: string;
}

interface ViewerFileRole {
  role: string;
  declares: Array<{ id: string; note: string }>;
  usedBy: Array<{ id: string; verb: string }>;
  flowsThrough: Array<{ flow: string; label: string }>;
  calls: Array<{ id: string; verb: string }>;
  dataAndExternal: Array<{ id: string; verb: string }>;
  related: string[];
}

const typeColors: Record<string, string> = {
  project: "#17201d", module: "#bd4e86", controller: "#286aa6", service: "#7452a8",
  provider: "#765d97", repository: "#5068a4", route: "#df642d", method: "#56635e",
  function: "#56635e", guard: "#43635b", dto: "#16798b", pipe: "#16798b",
  interceptor: "#755381", middleware: "#756b56", decorator: "#8c5375", table: "#1e8068",
  database: "#1e8068", entity: "#2b8d70", model: "#1e8068", column: "#5b9f87",
  topic: "#0f7895", broker: "#293b75", queue: "#a66708", processor: "#6e4a9e",
  external: "#c94747", env: "#b27a12", file: "#39433f", folder: "#66716d",
  risk: "#c94747", library: "#4e7184", config: "#8a6f3d", test: "#6f7774", package: "#3f5550",
  schema: "#28745f", index: "#87660e", constraint: "#9b5b45", migration: "#8c4f77",
  materialized_view: "#0f7895", scheduled_job: "#a66708", workflow: "#355f8a",
  pipeline_job: "#4e7184", build_stage: "#66716d", container_image: "#315d72",
  container: "#3f756e", deployment: "#5068a4", infrastructure_service: "#16798b",
  ingress: "#c94747", config_map: "#8a6f3d", secret: "#a83a3a", environment: "#5f6f68",
};

const typeLabels: Record<string, string> = {
  project: "Project", module: "Module", controller: "Controller", service: "Service", provider: "Provider",
  repository: "Repository", route: "HTTP route", method: "Method", function: "Function", guard: "Guard",
  dto: "DTO", pipe: "Pipe", interceptor: "Interceptor", middleware: "Middleware", decorator: "Decorator",
  table: "Table", database: "Database", entity: "Entity", model: "Model", column: "Column",
  topic: "Message topic", broker: "Message broker", queue: "Queue", processor: "Processor",
  external: "External API", env: "Environment variable", file: "Source file", folder: "Folder",
  risk: "Risk", library: "Library", config: "Configuration", test: "Test", package: "Package",
  schema: "Schema", index: "Index", constraint: "Constraint", migration: "Migration",
  materialized_view: "Materialized view", scheduled_job: "Scheduled job", workflow: "Workflow",
  pipeline_job: "Pipeline job", build_stage: "Build stage", container_image: "Container image",
  container: "Container", deployment: "Deployment", infrastructure_service: "Runtime service",
  ingress: "Ingress", config_map: "ConfigMap", secret: "Secret", environment: "Environment",
};

export function generateViewerData(
  graph: ArchitectureGraph,
  metadata: ScanMetadata,
  risks: ArchitectureRisk[],
): string {
  const graphNodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const domainByNode = inferDomains(graph);
  const viewerNodes = graph.nodes.map((node) => toViewerNode(node, domainByNode.get(node.id) ?? "core"));
  const existingRiskIds = new Set(graph.nodes.filter((node) => node.type === "risk").map((node) => node.id));
  const riskNodes = risks.flatMap((risk) => {
    const id = risk.id.startsWith("risk:") ? risk.id : `risk:${risk.id}`;
    if (existingRiskIds.has(id)) return [];
    return [{
    id,
    type: "risk",
    label: risk.title,
    file: risk.file ?? graphNodeMap.get(risk.nodeId ?? "")?.file ?? "",
    domain: domainByNode.get(risk.nodeId ?? "") ?? domainFromFile(risk.file ?? ""),
    desc: `${risk.description} Recommendation: ${risk.recommendation}`,
    severity: risk.severity,
    } satisfies ViewerNode];
  });
  const nodes = [...viewerNodes, ...riskNodes];
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges = graph.edges
    .filter((edge) => nodeMap.has(edge.from) && nodeMap.has(edge.to))
    .map(toViewerEdge);

  const domains = buildDomains(nodes, domainByNode);
  const flows = buildFlows(nodes, edges, "route");
  const asyncFlows = buildFlows(nodes, edges, "async");
  const routeFlowIndex = Object.fromEntries(Object.entries(flows).map(([id, flow]) => [flow.root, id]));
  const fileRoles = buildFileRoles(nodes, edges, flows, asyncFlows);
  const sources = buildSources(graph.nodes);
  const fileSource = buildFileSource(nodes, sources);
  const mapEdges = buildMapEdges(edges, nodeMap);

  const counts = (type: string) => nodes.filter((node) => node.type === type).length;
  const project = {
    name: graph.project.name,
    stack: metadata.detectedStacks.map((stack) => stack.name).join(" · ") || graph.project.detectedStacks.join(" · ") || "Detected project",
    scanned: `Scanned ${new Date(graph.project.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`,
    stats: {
      files: metadata.filesScanned,
      modules: counts("module"),
      routes: counts("route"),
      services: counts("service") + counts("provider") + counts("repository"),
      tables: counts("table") || counts("entity") + counts("model"),
      topics: counts("topic"),
      queues: counts("queue"),
      processors: counts("processor"),
      schedules: counts("scheduled_job"),
      migrations: counts("migration"),
      deployments: counts("deployment"),
      external: counts("external"),
      risks: riskNodes.length,
      relationships: edges.length,
    },
  };

  const data = {
    project, typeColors, typeLabels, nodes, edges, domains, mapEdges,
    moduleProfiles: {}, flows, routeFlowIndex, asyncFlows, fileRoles, sources, fileSource,
  };
  return `window.__ATLAS_DATA__=${JSON.stringify(data)};\n`;
}

function toViewerNode(node: GraphNode, domain: string): ViewerNode {
  const type = viewerType(node.type);
  const metadata = node.metadata ?? {};
  const baseDescription = String(metadata.plainDescription ?? metadata.description ?? metadata.plainFlowDescription
    ?? metadata.flowDescription ?? metadata.plainAsyncFlowDescription ?? metadata.asyncFlowDescription ?? "");
  const desc = type === "risk" && metadata.recommendation
    ? `${baseDescription} Recommendation: ${String(metadata.recommendation)}`
    : baseDescription;
  const metrics: Record<string, string | number> = {};
  const details = safeDetails(metadata);
  if (Array.isArray(metadata.methods)) metrics.methods = metadata.methods.length;
  if (node.sourceLocation?.startLine && node.sourceLocation?.endLine) metrics.lines = node.sourceLocation.endLine - node.sourceLocation.startLine + 1;
  return {
    id: node.id,
    type,
    label: node.label,
    file: node.file ?? node.sourceLocation?.file ?? "",
    domain,
    desc: desc || fallbackDescription(type, node.label),
    ...(details ? { details } : {}),
    ...(Object.keys(metrics).length ? { metrics } : {}),
    ...(type === "risk" && typeof metadata.severity === "string" ? { severity: metadata.severity } : {}),
  };
}

function viewerType(type: GraphNode["type"]): string {
  if (type === "message_topic") return "topic";
  if (type === "message_broker") return "broker";
  if (type === "external_api") return "external";
  if (type === "environment_variable") return "env";
  return type;
}

function toViewerEdge(edge: GraphEdge): ViewerEdge {
  const customLabel = edge.label && edge.label !== edge.type ? edge.label : "";
  const details = safeDetails(edge.metadata ?? {});
  return {
    from: edge.from,
    to: edge.to,
    verb: customLabel || edgeVerb(edge.type),
    kind: edgeKind(edge.type),
    relation: edge.type,
    ...(details ? { details } : {}),
  };
}

function edgeKind(type: GraphEdge["type"]): ViewerKind {
  if (["publishes_to", "delivers_to", "enqueues", "processes", "schedules", "triggers"].includes(type)) return "async";
  if (["reads", "writes", "has_column", "creates", "alters", "drops", "indexes"].includes(type)) return "data";
  if (type === "connects_to") return "external";
  return "sync";
}

function edgeVerb(type: GraphEdge["type"]): string {
  const labels: Partial<Record<GraphEdge["type"], string>> = {
    contains: "contains", imports: "imports", exports: "exports", declares: "declares", provides: "provides",
    injects: "injects", calls: "calls", uses: "uses", reads: "reads", writes: "writes", handles: "handled by",
    depends_on: "depends on", decorates: "applies", validates: "validates with", returns: "returns",
    references: "references", connects_to: "calls", tests: "tests", has_method: "declares",
    has_column: "has column", publishes_to: "publishes", delivers_to: "delivered to", enqueues: "enqueues",
    processes: "processed by",
    creates: "creates", alters: "alters", drops: "drops", indexes: "indexes",
    schedules: "runs", triggers: "triggers", builds: "builds", publishes: "publishes",
    deploys: "deploys", exposes: "exposes", configures: "configures", runs_in: "runs in",
    targets: "targets",
  };
  return labels[type] ?? type.replaceAll("_", " ");
}

function safeDetails(metadata: Record<string, unknown>): Record<string, string | number | boolean | string[]> | null {
  const excluded = new Set([
    "sourcePreview", "description", "plainDescription", "descriptionSource", "plainDescriptionSource",
    "flowDescription", "plainFlowDescription", "flowDescriptionSource",
    "asyncFlowDescription", "plainAsyncFlowDescription", "asyncFlowDescriptionSource", "methods", "fields",
  ]);
  const result: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (excluded.has(key) || value === undefined || value === null) continue;
    if (["string", "number", "boolean"].includes(typeof value)) result[key] = value as string | number | boolean;
    else if (Array.isArray(value) && value.length <= 40 && value.every((item) => ["string", "number", "boolean"].includes(typeof item))) result[key] = value.map(String);
  }
  return Object.keys(result).length ? result : null;
}

function inferDomains(graph: ArchitectureGraph): Map<string, string> {
  const result = new Map<string, string>();
  for (const node of graph.nodes) result.set(node.id, domainFromFile(node.file ?? node.sourceLocation?.file ?? ""));
  const modules = graph.nodes.filter((node) => node.type === "module");
  for (const moduleNode of modules) {
    const domain = domainFromFile(moduleNode.file ?? "") || slug(moduleNode.label.replace(/Module$/i, ""));
    result.set(moduleNode.id, domain);
    const related = graph.edges.filter((edge) => edge.from === moduleNode.id && ["contains", "provides", "declares"].includes(edge.type));
    for (const edge of related) result.set(edge.to, domain);
  }
  return result;
}

function domainFromFile(file: string): string {
  const parts = file.replaceAll("\\", "/").split("/").filter(Boolean);
  const src = parts.indexOf("src");
  const candidates = src >= 0 ? parts.slice(src + 1) : parts;
  const filtered = candidates.filter((part) => !["app", "apps", "lib", "libs", "modules", "common", "shared"].includes(part));
  const first = filtered.find((part) => !part.includes("."));
  return slug(first || "core");
}

function buildDomains(nodes: ViewerNode[], domainByNode: Map<string, string>) {
  const modules = nodes.filter((node) => node.type === "module");
  const routeCounts = new Map<string, number>();
  const serviceCounts = new Map<string, number>();
  for (const node of nodes) {
    if (node.type === "route") routeCounts.set(node.domain, (routeCounts.get(node.domain) ?? 0) + 1);
    if (["service", "provider", "repository"].includes(node.type)) serviceCounts.set(node.domain, (serviceCounts.get(node.domain) ?? 0) + 1);
  }
  const grouped = new Map<string, ViewerNode[]>();
  for (const moduleNode of modules) {
    const domain = domainByNode.get(moduleNode.id) ?? moduleNode.domain;
    grouped.set(domain, [...(grouped.get(domain) ?? []), moduleNode]);
  }
  return [...grouped.entries()]
    .sort(([a, aModules], [b, bModules]) => {
      const score = (id: string, domainModules: ViewerNode[]) => domainModules.length * 2
        + (routeCounts.get(id) ?? 0) * 4 + (serviceCounts.get(id) ?? 0) * 3;
      return score(b, bModules) - score(a, aModules) || a.localeCompare(b);
    })
    .map(([id, domainModules], index) => {
      const allModules = domainModules.map((node) => node.id);
      const modulesForMap = allModules.slice(0, 3);
      return {
        id,
        name: titleCase(id),
        desc: domainModules.map((node) => node.label.replace(/Module$/i, "")).slice(0, 3).join(", "),
        modules: modulesForMap,
        allModules,
        hidden: allModules.length - modulesForMap.length,
        light: index >= 7,
        counts: `${domainModules.length} module${domainModules.length === 1 ? "" : "s"} · ${routeCounts.get(id) ?? 0} routes · ${serviceCounts.get(id) ?? 0} services`,
      };
    });
}

function buildMapEdges(edges: ViewerEdge[], nodes: Map<string, ViewerNode>): ViewerEdge[] {
  const dataOwners = buildMapDataOwners(edges, nodes);
  const grouped = new Map<string, ViewerEdge>();
  for (const edge of edges) {
    if (["has_column", "creates", "alters", "drops", "indexes"].includes(edge.relation ?? "")) continue;
    const from = nodes.get(edge.from), to = nodes.get(edge.to);
    if (!from || !to) continue;
    const fromId = mapEndpoint(from, dataOwners), toId = mapEndpoint(to, dataOwners);
    if (!fromId || !toId || fromId === toId) continue;
    const key = `${fromId}>${toId}:${edge.kind}:${edge.relation ?? ""}`;
    const current = grouped.get(key);
    if (current) current.count = (current.count ?? 1) + 1;
    else grouped.set(key, {
      from: fromId,
      to: toId,
      verb: edge.verb,
      kind: edge.kind,
      relation: edge.relation,
      count: 1,
    });
  }
  const ranked = [...grouped.values()].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  const structureEdges = ranked.filter((edge) => edge.kind === "sync").slice(0, 40);
  const dataEdges = ranked.filter((edge) => edge.kind === "data").slice(0, 30);
  const externalEdges = ranked.filter((edge) => edge.kind === "external").slice(0, 20);
  const asyncEdges = ranked.filter((edge) => edge.kind === "async").slice(0, 50);
  // Separate budgets prevent large schemas from displacing async and external behavior.
  return [...structureEdges, ...dataEdges, ...externalEdges, ...asyncEdges];
}

function buildMapDataOwners(edges: ViewerEdge[], nodes: Map<string, ViewerNode>): Map<string, string> {
  const owners = new Map<string, string>();
  const contains = edges.filter((edge) => edge.relation === "contains");
  const dataTypes = new Set(["schema", "table", "entity", "model", "materialized_view"]);
  for (const edge of contains) {
    if (nodes.get(edge.from)?.type === "database" && dataTypes.has(nodes.get(edge.to)?.type ?? "")) owners.set(edge.to, edge.from);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of contains) {
      const owner = owners.get(edge.from);
      if (owner && !owners.has(edge.to) && dataTypes.has(nodes.get(edge.to)?.type ?? "")) {
        owners.set(edge.to, owner);
        changed = true;
      }
    }
  }
  return owners;
}

function mapEndpoint(node: ViewerNode, dataOwners: Map<string, string>): string {
  if (["topic", "queue", "processor", "broker"].includes(node.type)) return node.id;
  if (node.type === "database") return node.id;
  if (["schema", "table", "entity", "model", "materialized_view"].includes(node.type)) return dataOwners.get(node.id) ?? node.id;
  if (["external", "env"].includes(node.type)) return node.id;
  return node.domain ? `d.${node.domain}` : "";
}

function buildFlows(nodes: ViewerNode[], edges: ViewerEdge[], mode: "route" | "async"): Record<string, ViewerFlow> {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const roots = nodes.filter((node) => mode === "route" ? node.type === "route" : ["topic", "queue"].includes(node.type));
  const result: Record<string, ViewerFlow> = {};
  for (const root of roots) {
    const visited = new Map([[root.id, 0]]);
    const queue = [root.id];
    const selectedEdges: ViewerEdge[] = [];
    while (queue.length && visited.size < 32) {
      const current = queue.shift()!;
      const depth = visited.get(current)!;
      if (depth >= 6) continue;
      const nextEdges = edges.filter((edge) => edge.from === current && flowEdgeForViewer(edge));
      for (const edge of nextEdges.slice(0, 10)) {
        if (!nodeMap.has(edge.to)) continue;
        selectedEdges.push(edge);
        if (!visited.has(edge.to)) { visited.set(edge.to, depth + 1); queue.push(edge.to); }
      }
    }
    if (visited.size < 2) continue;
    const rows = new Map<number, number>();
    const steps = [...visited.entries()].map(([id, col]) => {
      const row = rows.get(col) ?? 0; rows.set(col, row + 1);
      return { id, col, row, stage: stageName(nodeMap.get(id)!.type, mode) };
    });
    const links = selectedEdges.filter((edge, index, all) => all.findIndex((other) => other.from === edge.from && other.to === edge.to && other.kind === edge.kind) === index);
    let sequence = 1;
    const numbered = links.map((edge) => ({ ...edge, ...(visited.get(edge.to) === (visited.get(edge.from) ?? 0) + 1 ? { n: sequence++ } : {}) }));
    const id = mode === "route" ? `flow.${slug(root.id)}` : root.id;
    result[id] = {
      title: `${root.label} — full ${mode === "route" ? "request" : "asynchronous"} flow`,
      summary: root.desc,
      root: root.id,
      steps,
      links: numbered,
      ends: flowEnding([...visited.keys()].map((id) => nodeMap.get(id)!).filter(Boolean)),
    };
  }
  return result;
}

function flowEdgeForViewer(edge: ViewerEdge): boolean {
  return edge.kind !== "sync" || !["contains", "declares", "has method"].includes(edge.verb);
}

function stageName(type: string, mode: "route" | "async"): string {
  const names: Record<string, string> = { route: "Trigger", guard: "Guard", pipe: "Validation", dto: "Input", controller: "Controller", method: "Operation", service: "Business logic", provider: "Provider", repository: "Data access", database: "Database", table: "Data", entity: "Data", model: "Data", topic: "Topic", queue: "Queue", processor: "Processor", external: "External", env: "Configuration" };
  return names[type] ?? (mode === "async" ? "Effect" : "Processing");
}

function flowEnding(nodes: ViewerNode[]): string {
  const effects = nodes.filter((node) => ["table", "entity", "model", "topic", "queue", "external"].includes(node.type));
  return effects.length ? `The flow reaches ${effects.slice(0, 5).map((node) => node.label).join(", ")}.` : "The flow ends at the last detected operation in the static code path.";
}

function buildFileRoles(
  nodes: ViewerNode[],
  edges: ViewerEdge[],
  flows: Record<string, ViewerFlow>,
  asyncFlows: Record<string, ViewerFlow>,
): Record<string, ViewerFileRole> {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const roles: Record<string, ViewerFileRole> = {};
  for (const file of nodes.filter((node) => node.type === "file")) {
    const declarations = nodes.filter((node) => node.file === file.file && node.id !== file.id && !["file", "risk"].includes(node.type));
    const declaredIds = new Set(declarations.map((node) => node.id));
    const incoming = edges.filter((edge) => declaredIds.has(edge.to) && !declaredIds.has(edge.from));
    const outgoing = edges.filter((edge) => declaredIds.has(edge.from) && !declaredIds.has(edge.to));
    const calls = outgoing.filter((edge) => edge.kind === "sync");
    const effects = outgoing.filter((edge) => edge.kind !== "sync");
    const flowEntries = [...Object.entries(flows), ...Object.entries(asyncFlows)]
      .filter(([, flow]) => flow.steps.some((step) => declaredIds.has(step.id)))
      .map(([flow, data]) => ({ flow, label: data.title.split(" — ")[0] }));
    roles[file.id] = {
      role: file.desc,
      declares: declarations.slice(0, 12).map((node) => ({ id: node.id, note: typeLabels[node.type] ?? node.type })),
      usedBy: uniqueRelations(incoming.map((edge) => ({ id: edge.from, verb: edge.verb })), nodeMap).slice(0, 12),
      flowsThrough: flowEntries.slice(0, 12),
      calls: uniqueRelations(calls.map((edge) => ({ id: edge.to, verb: edge.verb })), nodeMap).slice(0, 12),
      dataAndExternal: uniqueRelations(effects.map((edge) => ({ id: edge.to, verb: edge.verb })), nodeMap).slice(0, 12),
      related: nodes.filter((node) => node.type === "file" && node.domain === file.domain && node.id !== file.id).slice(0, 8).map((node) => node.id),
    };
  }
  return roles;
}

function uniqueRelations(items: Array<{ id: string; verb: string }>, nodes: Map<string, ViewerNode>) {
  return items.filter((item, index) => nodes.has(item.id) && items.findIndex((other) => other.id === item.id) === index);
}

function buildSources(nodes: GraphNode[]) {
  return Object.fromEntries(nodes.flatMap((node) => {
    const code = node.metadata?.sourcePreview;
    if (typeof code !== "string" || !code.trim()) return [];
    return [[node.id, { file: node.file ?? node.sourceLocation?.file ?? "", code }]];
  }));
}

function buildFileSource(nodes: ViewerNode[], sources: Record<string, { file: string; code: string }>) {
  const sourceIds = Object.keys(sources);
  return Object.fromEntries(nodes.filter((node) => node.type === "file").flatMap((file) => {
    const source = sourceIds.find((id) => sources[id].file === file.file);
    return source ? [[file.id, source]] : [];
  }));
}

function fallbackDescription(type: string, label: string): string {
  const subject = typeLabels[type] ?? type;
  return `${subject} ${label} detected from the project source code.`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "core";
}

function titleCase(value: string): string {
  return value.split(/[-_]/).map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join(" ");
}
