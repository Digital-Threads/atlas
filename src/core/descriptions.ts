import type { ArchitectureGraph, GraphEdge, GraphEdgeType, GraphNode, GraphNodeType } from "./types.js";

const flowEdgeTypes = new Set<GraphEdgeType>([
  "handles", "calls", "reads", "writes", "uses", "connects_to",
  "validates", "returns", "decorates", "publishes_to", "delivers_to", "enqueues",
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
    const plainDescription = String(node.metadata?.plainDescription ?? "") || describePlainNode(node, index);
    const plainFlowDescription = node.type === "route" ? describePlainFlow(node, index) : "";
    const asyncFlowDescription = ["message_topic", "queue"].includes(node.type) ? describeAsyncFlow(node, index) : "";
    const plainAsyncFlowDescription = ["message_topic", "queue"].includes(node.type) ? describePlainAsyncFlow(node, index) : "";
    if (!description && !flowDescription && !plainDescription && !plainFlowDescription && !asyncFlowDescription && !plainAsyncFlowDescription) return node;
    return {
      ...node,
      metadata: {
        ...node.metadata,
        ...(description ? { description } : {}),
        ...(flowDescription ? { flowDescription } : {}),
        ...(plainDescription ? { plainDescription } : {}),
        ...(plainFlowDescription ? { plainFlowDescription } : {}),
        ...(asyncFlowDescription ? { asyncFlowDescription } : {}),
        ...(plainAsyncFlowDescription ? { plainAsyncFlowDescription } : {}),
        ...(plainDescription || plainFlowDescription
          ? { plainDescriptionSource: "inferred_from_code_structure" }
          : {}),
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
  if (["service", "provider", "repository", "use_case", "port", "adapter"].includes(node.type)) return describeProvider(node, index);
  if (node.type === "method") return describeMethod(node, index);
  if (node.type === "function") return describeFunction(node, index);
  if (node.type === "route") return describeFlow(node, index);
  if (["message_broker", "message_topic", "queue", "processor"].includes(node.type)) return describeAsyncNode(node, index);
  if (isIntelligenceNode(node.type)) return describeIntelligenceNode(node, index, false);
  return "";
}

function describePlainNode(node: GraphNode, index: GraphIndex): string {
  if (node.type === "module") return describePlainModule(node, index);
  if (node.type === "controller") return describePlainController(node, index);
  if (["service", "provider", "repository", "use_case", "port", "adapter"].includes(node.type)) return describePlainProvider(node, index);
  if (node.type === "method") return describePlainMethod(node, index);
  if (node.type === "function") return describePlainFunction(node);
  if (node.type === "route") return describePlainFlow(node, index);
  if (["message_broker", "message_topic", "queue", "processor"].includes(node.type)) return describePlainAsyncNode(node, index);
  if (isIntelligenceNode(node.type)) return describeIntelligenceNode(node, index, true);
  return "";
}

function isIntelligenceNode(type: GraphNodeType): boolean {
  return [
    "database", "schema", "table", "column", "index", "constraint", "migration", "materialized_view",
    "scheduled_job", "workflow", "pipeline_job", "build_stage", "container_image", "container", "deployment",
    "infrastructure_service", "ingress", "config_map", "secret", "environment", "environment_variable", "config",
  ].includes(type);
}

function describeIntelligenceNode(node: GraphNode, index: GraphIndex, plain: boolean): string {
  const outgoing = index.outgoing.get(node.id) ?? [];
  const incoming = index.incoming.get(node.id) ?? [];
  const countOutgoing = (types: GraphEdgeType[]) => outgoing.filter((edge) => types.includes(edge.type)).length;
  const countIncoming = (types: GraphEdgeType[]) => incoming.filter((edge) => types.includes(edge.type)).length;
  const details = node.metadata ?? {};
  const environment = typeof details.environment === "string" ? ` in ${details.environment}` : "";
  const file = plain ? "" : sourceClause(node);

  switch (node.type) {
    case "database": return `Database${file} containing ${countOutgoing(["contains"])} detected schemas or structures.`;
    case "schema": return `Database namespace${file} containing ${countOutgoing(["contains"])} detected tables.`;
    case "table": {
      const columns = countOutgoing(["has_column"]);
      const relations = countOutgoing(["references"]) + countIncoming(["references"]);
      return plain
        ? `Stores ${humanWords(node.label).toLowerCase()} data in ${columns} detected columns and connects to ${relations} other tables.`
        : `Database table${file} with ${columns} detected columns and ${relations} relationships.`;
    }
    case "column": return plain
      ? `Stores one value for ${humanWords(node.name ?? node.label).toLowerCase()}${details.type ? ` using the ${String(details.type)} data type` : ""}.`
      : `Database column${file}${details.type ? ` of type ${String(details.type)}` : ""}.`;
    case "index": return plain
      ? `Helps the database find rows faster${Array.isArray(details.columns) ? ` by ${details.columns.join(", ")}` : ""}.`
      : `Database index${file}${details.unique ? " enforcing uniqueness" : ""}.`;
    case "constraint": return plain
      ? `Protects stored data with the ${humanWords(String(details.kind ?? "configured rule")).toLowerCase()} rule.`
      : `Database constraint${file} of type ${String(details.kind ?? "configured")}.`;
    case "migration": return plain
      ? `Changes the database structure through ${countOutgoing(["creates", "alters", "drops"])} detected operations.`
      : `Database migration${file} with ${String(details.statements ?? countOutgoing(["creates", "alters", "drops"]))} detected statements.`;
    case "materialized_view": return plain
      ? `Precomputes query results for faster analytics and reads from ${countOutgoing(["reads"])} detected sources.`
      : `Materialized database view${file}${details.engine ? ` using ${String(details.engine)}` : ""}.`;
    case "scheduled_job": return plain
      ? `Starts automatically ${String(details.humanSchedule ?? details.expression ?? "on its configured schedule")}${details.timeZone ? ` in the ${String(details.timeZone)} timezone` : ""}.`
      : `Scheduled job${file}: ${String(details.humanSchedule ?? details.expression ?? "configured schedule")}.`;
    case "workflow": return plain
      ? `Automates delivery through ${countOutgoing(["contains"])} detected pipeline jobs.`
      : `CI/CD workflow${file} containing ${countOutgoing(["contains"])} detected jobs.`;
    case "pipeline_job": return plain
      ? `Runs one CI/CD job${environment} and passes work to ${countOutgoing(["builds", "publishes", "deploys"])} detected delivery targets.`
      : `CI/CD pipeline job${file}${environment}.`;
    case "build_stage": return plain
      ? `Builds one stage of the application container image.`
      : `Docker build stage${file}${details.baseImage ? ` based on ${String(details.baseImage)}` : ""}.`;
    case "container_image": return plain
      ? `Packages the application and its runtime dependencies for deployment.`
      : `Container image${file}.`;
    case "container": return plain
      ? `Runs ${node.label}${environment}${details.image ? ` from image ${String(details.image)}` : ""}.`
      : `Runtime container${file}${environment}${details.image ? ` using ${String(details.image)}` : ""}.`;
    case "deployment": return plain
      ? `Keeps ${String(details.replicas ?? "the configured number of")} application instances running${environment}.`
      : `${String(details.kind ?? "Runtime")} deployment${file}${environment}.`;
    case "infrastructure_service": return plain
      ? `Provides stable network access to a deployed workload${environment}.`
      : `Runtime network service${file}${environment}.`;
    case "ingress": return plain
      ? `Routes traffic from outside the cluster to ${countOutgoing(["exposes"])} detected internal services${environment}.`
      : `Kubernetes ingress${file}${environment}.`;
    case "config_map": return plain
      ? `Provides non-secret runtime settings${environment}; ${Array.isArray(details.keys) ? details.keys.length : 0} setting names were detected.`
      : `${node.framework === "docker-compose" ? "Docker Compose config" : "Kubernetes ConfigMap"}${file}${environment}; values are not stored by Atlas.`;
    case "secret": return plain
      ? `Provides protected runtime settings${environment}; Atlas keeps names only and never stores their values.`
      : `${node.framework === "docker-compose" ? "Docker Compose secret" : "Kubernetes Secret"}${file}${environment}; values are never stored by Atlas.`;
    case "config": return plain
      ? `Defines ${humanWords(String(details.kind ?? node.label)).toLowerCase()}${environment} and connects it to ${outgoing.length + incoming.length} detected architecture elements.`
      : `${humanWords(String(details.kind ?? "configuration"))}${file}${environment}.`;
    case "environment": return plain
      ? `Groups the delivery and runtime configuration for ${node.label}.`
      : `Runtime environment${file}.`;
    case "environment_variable": return plain
      ? `${details.purpose ? String(details.purpose) : "Provides a named runtime setting"}. ${details.sensitive ? "Its value is hidden." : "Atlas records only safe example values."}`
      : `Environment variable contract${file}${details.sensitive ? "; value redacted" : ""}.`;
    default: return "";
  }
}

function describePlainModule(node: GraphNode, index: GraphIndex): string {
  const providers = relatedNodes(node.id, index, "out", ["provides"], ["service", "provider", "repository", "use_case", "port", "adapter"]);
  const consumers = relatedNodes(node.id, index, "in", ["imports", "exports"], ["module"]);
  const sentences = ["Groups the parts of the application related to " + subjectFromNode(node) + "."];
  if (providers.length) sentences.push("It makes " + countLabel(providers.length, "capability", "capabilities") + " available to the application.");
  if (consumers.length) sentences.push("It is used by " + countLabel(consumers.length, "other area") + " of the system.");
  return sentences.join(" ");
}

function describePlainController(node: GraphNode, index: GraphIndex): string {
  const methods = relatedNodes(node.id, index, "out", ["has_method"], ["method"]);
  const routes = uniqueNodes(methods.flatMap((method) => (index.incoming.get(method.id) ?? [])
    .filter((edge) => edge.type === "handles")
    .map((edge) => index.nodes.get(edge.from)))
    .filter(isNode));
  return "Receives API requests related to " + subjectFromNode(node)
    + " and sends each request to the appropriate application operation. It exposes "
    + countLabel(routes.length, "endpoint") + ".";
}

function describePlainProvider(node: GraphNode, index: GraphIndex): string {
  const methods = relatedNodes(node.id, index, "out", ["has_method"], ["method"]);
  const consumers = relatedNodes(node.id, index, "in", ["injects", "provides"], [
    "module", "controller", "service", "provider", "repository", "use_case", "port", "adapter",
  ]);
  const dependencies = relatedNodes(node.id, index, "out", ["injects"], [
    "service", "provider", "repository", "use_case", "port", "adapter",
  ]);
  const subject = subjectFromNode(node);
  const lead = node.type === "port"
    ? "Defines a boundary required by the application for " + subject + "."
    : node.type === "adapter"
      ? "Connects an application port to infrastructure related to " + subject + "."
      : node.type === "use_case"
        ? "Coordinates one application use case related to " + subject + "."
        : node.type === "repository"
    ? "Handles stored data related to " + subject + "."
    : node.type === "service"
      ? "Contains the application's operations and rules related to " + subject + "."
      : "Provides reusable application behavior related to " + subject + ".";
  const sentences = [lead];
  if (methods.length) sentences.push("It offers " + countLabel(methods.length, "operation") + ".");
  if (consumers.length) sentences.push("It is used by " + countLabel(consumers.length, "part") + " of the system.");
  if (dependencies.length) sentences.push("It relies on " + countLabel(dependencies.length, "supporting component") + ".");
  return sentences.join(" ");
}

function describePlainMethod(node: GraphNode, index: GraphIndex): string {
  const routes = relatedNodes(node.id, index, "in", ["handles"], ["route"]);
  const asyncSources = relatedNodes(node.id, index, "in", ["delivers_to"], ["message_topic", "queue"]);
  const calls = relatedNodes(node.id, index, "out", ["calls"], ["method", "service", "provider", "repository"]);
  const sentences = asyncSources.length
    ? ["Handles asynchronous work received from " + plainNameList(asyncSources) + ".", methodSentence(methodName(node), ownerSubject(node))]
    : [methodSentence(methodName(node), ownerSubject(node))];
  if (routes.length) sentences.push("It is directly used by " + countLabel(routes.length, "API endpoint") + ".");
  if (calls.length) sentences.push("It coordinates " + countLabel(calls.length, "following operation") + ".");
  return sentences.join(" ");
}

function describePlainFunction(node: GraphNode): string {
  const name = methodName(node);
  if (/^(bootstrap|main|start)$/i.test(name)) return "Starts and configures the application.";
  return methodSentence(name, subjectFromNode(node));
}

function describePlainFlow(route: GraphNode, index: GraphIndex): string {
  const ids = flowIds(route.id, index);
  const flowEdges = [...ids].flatMap((id) => index.outgoing.get(id) ?? [])
    .filter((edge) => ids.has(edge.to) && flowEdgeTypes.has(edge.type));
  const handlerEdge = flowEdges.find((edge) => edge.from === route.id && edge.type === "handles");
  const handler = handlerEdge ? index.nodes.get(handlerEdge.to) : undefined;
  const guards = nodesOfTypes(ids, index, ["guard", "pipe", "interceptor", "middleware"]);
  const calls = nodesFromEdges(flowEdges, index, ["calls"], ["method", "service", "provider", "repository"])
    .filter((node) => node.id !== handler?.id);
  const reads = nodesFromEdges(flowEdges, index, ["reads"], ["table", "entity", "model", "database"]);
  const writes = nodesFromEdges(flowEdges, index, ["writes"], ["table", "entity", "model", "database"]);
  const external = nodesFromEdges(flowEdges, index, ["connects_to"], ["external_api"]);
  const published = nodesFromEdges(flowEdges, index, ["publishes_to"], ["message_topic"]);
  const queued = nodesFromEdges(flowEdges, index, ["enqueues"], ["queue"]);
  const routeText = String(route.metadata?.path ?? route.label);
  const handlerName = handler ? methodName(handler) : route.label;
  const handlerSubject = handler ? ownerSubject(handler) : "request";
  const requestSubject = /:[A-Za-z0-9_]*id\b/i.test(routeText)
    ? "a " + singularize(handlerSubject)
    : handlerSubject;
  const actor = /(^|\/)admin(\/|$)|admin/i.test(routeText + " " + handlerName)
    ? "An administrator"
    : "A user or connected client";
  const requestAction = actionPhrase(handlerName.replace(/Admin(istrator)?/gi, ""), requestSubject);
  const sentences = [actor + " asks the system to " + requestAction + "."];
  if (guards.length) {
    const authorization = guards.some((node) => /auth|permission|role|access|jwt/i.test(node.label));
    sentences.push(authorization
      ? "The system checks that the caller is allowed to do this."
      : "The system checks the request before continuing.");
  }
  const steps = uniqueStrings(calls.map(plainFlowStep)).slice(0, 4);
  if (steps.length) sentences.push("It then " + naturalList(steps) + ".");
  if (reads.length) sentences.push("It reads the required data from " + plainNameList(reads) + ".");
  if (writes.length) sentences.push("It saves changes to " + plainNameList(writes) + ".");
  if (external.length) sentences.push("It also communicates with " + plainNameList(external) + ".");
  if (published.length) sentences.push("It publishes an asynchronous message to " + plainNameList(published) + ".");
  if (queued.length) sentences.push("It schedules background work in " + plainNameList(queued) + ".");
  if (!steps.length && !reads.length && !writes.length && !external.length && !published.length && !queued.length) {
    sentences.push("Atlas did not detect any later processing steps in the static code path.");
  }
  return sentences.join(" ");
}

function describePlainAsyncNode(node: GraphNode, index: GraphIndex): string {
  if (node.type === "message_broker") {
    const topics = relatedNodes(node.id, index, "out", ["contains"], ["message_topic"]);
    return "Carries asynchronous messages between parts of the system through " + countLabel(topics.length, "topic") + ".";
  }
  if (node.type === "message_topic" || node.type === "queue") return describePlainAsyncFlow(node, index);
  const queues = relatedNodes(node.id, index, "in", ["processes"], ["queue"]);
  const methods = relatedNodes(node.id, index, "out", ["has_method"], ["method"]);
  return "Runs background work from " + (queues.length ? plainNameList(queues) : "a configured queue")
    + ". It contains " + countLabel(methods.length, "processing operation") + ".";
}

function describePlainAsyncFlow(root: GraphNode, index: GraphIndex): string {
  const topic = root.type === "message_topic";
  const transport = String(root.metadata?.transport ?? "kafka");
  const publishers = relatedNodes(root.id, index, "in", [topic ? "publishes_to" : "enqueues"], ["method", "service", "provider", "controller", "processor"]);
  const handlers = relatedNodes(root.id, index, "out", ["delivers_to"], ["method"]);
  const processors = relatedNodes(root.id, index, "out", ["processes"], ["processor"]);
  const handlerIds = new Set(handlers.map((handler) => handler.id));
  const next = operationTargets(handlerIds, index, ["calls"], ["method", "service", "provider", "repository"]);
  const sentences: string[] = [];
  if (publishers.length) {
    sentences.push(nameList(publishers, 3) + (publishers.length === 1 ? " sends" : " send") + " asynchronous work to " + root.label + ".");
  } else {
    sentences.push("Asynchronous work arrives at " + root.label + " from outside the detected code path.");
  }
  if (handlers.length) {
    sentences.push((topic ? (transport === "kafka" ? "Kafka delivers the message to " : "The message transport delivers it to ") : "The queue delivers the job to ") + nameList(handlers, 4) + ".");
  } else {
    sentences.push("No consumer was detected for this " + (topic ? "topic" : "queue") + ".");
  }
  if (processors.length) sentences.push("Background processing is owned by " + nameList(processors, 4) + ".");
  if (next.length) sentences.push("Processing continues through " + nameList(next, 4) + ".");
  return sentences.join(" ");
}

function describeAsyncNode(node: GraphNode, index: GraphIndex): string {
  if (node.type === "message_broker") {
    const topics = relatedNodes(node.id, index, "out", ["contains"], ["message_topic"]);
    const transport = String(node.metadata?.transport ?? "messaging");
    return (transport === "kafka" ? "Kafka message broker" : "NestJS message transport") + " with " + countLabel(topics.length, "detected topic") + ".";
  }
  if (node.type === "message_topic" || node.type === "queue") return describeAsyncFlow(node, index);
  const queues = relatedNodes(node.id, index, "in", ["processes"], ["queue"]);
  const methods = relatedNodes(node.id, index, "out", ["has_method"], ["method"]);
  return "NestJS Bull processor" + sourceClause(node) + " with " + countLabel(methods.length, "detected method")
    + (queues.length ? ". It processes " + nameList(queues) + "." : ".");
}

function describeAsyncFlow(root: GraphNode, index: GraphIndex): string {
  const topic = root.type === "message_topic";
  const transport = String(root.metadata?.transport ?? "kafka");
  const publishers = relatedNodes(root.id, index, "in", [topic ? "publishes_to" : "enqueues"], ["method", "service", "provider", "controller", "processor"]);
  const handlers = relatedNodes(root.id, index, "out", ["delivers_to"], ["method"]);
  const processors = relatedNodes(root.id, index, "out", ["processes"], ["processor"]);
  const sentences = [
    (topic ? (transport === "kafka" ? "Kafka topic " : "Message pattern ") : "Bull queue ") + root.label + sourceClause(root) + ".",
    "It has " + countLabel(publishers.length, "detected publisher") + ", " + countLabel(handlers.length, "detected consumer") + ", and " + countLabel(processors.length, "processor") + ".",
  ];
  if (publishers.length) sentences.push("Published by " + nameList(publishers, 5) + ".");
  if (handlers.length) sentences.push("Delivered to " + nameList(handlers, 5) + ".");
  if (processors.length) sentences.push("Processed by " + nameList(processors, 5) + ".");
  return sentences.join(" ");
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
    "service", "provider", "repository", "use_case", "port", "adapter",
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
  const asyncSources = relatedNodes(node.id, index, "in", ["delivers_to"], ["message_topic", "queue"]);
  const published = relatedNodes(node.id, index, "out", ["publishes_to"], ["message_topic"]);
  const queued = relatedNodes(node.id, index, "out", ["enqueues"], ["queue"]);
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
  if (asyncSources.length) sentences.push("It handles asynchronous work from " + nameList(asyncSources) + ".");
  if (published.length) sentences.push("It publishes to " + nameList(published) + ".");
  if (queued.length) sentences.push("It enqueues work in " + nameList(queued) + ".");
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

function subjectFromNode(node: GraphNode): string {
  const raw = String(node.name || node.label || "");
  const stripped = raw
    .replace(/^.*[./:#]/, "")
    .replace(/(Controller|Repository|Provider|Service|Module|UseCase|Handler|Factory|Resolver|Gateway|Function)$/i, "");
  const subject = humanWords(stripped || raw).toLowerCase();
  return subject && !/^(app|application|main)$/.test(subject) ? subject : "the application as a whole";
}

function ownerSubject(node: GraphNode): string {
  const label = String(node.label || "");
  const owner = label.includes(".") ? label.slice(0, label.lastIndexOf(".")) : "";
  if (!owner) return subjectFromNode(node);
  return subjectFromNode({ ...node, name: owner, label: owner });
}

function methodName(node: GraphNode): string {
  const metadataName = String(node.metadata?.method ?? node.metadata?.name ?? "").trim();
  if (metadataName) return metadataName;
  const raw = String(node.name || node.label || "operation");
  return raw.includes(".") ? raw.slice(raw.lastIndexOf(".") + 1) : raw.replace(/^.*[:#/]/, "");
}

function methodSentence(name: string, fallbackSubject: string): string {
  const phrase = actionPhrase(name, fallbackSubject);
  return capitalize(conjugateAction(phrase)) + ".";
}

function actionPhrase(name: string, fallbackSubject: string): string {
  const words = identifierWords(name)
    .filter((word) => !/^(async|rest|handler|method)$/i.test(word));
  const admin = words.some((word) => /^admin(istrator)?$/i.test(word));
  const meaningful = words.filter((word) => !/^admin(istrator)?$/i.test(word));
  let first = (meaningful.shift() || "process").toLowerCase();
  const verbs: Record<string, string> = {
    get: "retrieve", find: "find", fetch: "retrieve", load: "load", list: "list", read: "read",
    create: "create", add: "add", build: "build", generate: "generate", make: "create",
    update: "update", edit: "update", change: "change", set: "set", save: "save",
    delete: "delete", remove: "remove", destroy: "delete", clear: "clear",
    validate: "check", check: "check", can: "check", is: "check", has: "check",
    calculate: "calculate", calc: "calculate", compute: "calculate", count: "count",
    send: "send", publish: "publish", notify: "notify", emit: "publish",
    process: "process", handle: "process", run: "run", execute: "run", start: "start", stop: "stop",
    log: "record", record: "record", sync: "synchronize", import: "import", export: "export",
  };
  if (/^(run|execute|handle|process)$/.test(first) && meaningful[0] && verbs[meaningful[0].toLowerCase()]) {
    first = String(meaningful.shift()).toLowerCase();
  }
  const verb = verbs[first] || "perform";
  let object = meaningful.join(" ").toLowerCase();
  object = object.replace(/\buser items\b/g, "a user's items");
  if (!object) object = fallbackSubject && fallbackSubject !== "the application as a whole" ? fallbackSubject : "this operation";
  if (object === "one" && fallbackSubject) object = "one " + singularize(fallbackSubject) + " record";
  if (object === "many" && fallbackSubject) object = "many " + singularize(fallbackSubject) + " records";
  if (object === "all" && fallbackSubject) object = "all " + pluralize(fallbackSubject);
  if (/^by\b/.test(object) && fallbackSubject) object = fallbackSubject + " " + object;
  if (!verbs[first]) object = humanWords(name).toLowerCase() + (fallbackSubject ? " for " + fallbackSubject : "");
  return verb + " " + object + (admin ? " for an administrative task" : "");
}

function conjugateAction(phrase: string): string {
  const [verb, ...rest] = phrase.split(" ");
  const forms: Record<string, string> = {
    retrieve: "retrieves", find: "finds", load: "loads", list: "lists", read: "reads",
    create: "creates", add: "adds", build: "builds", generate: "generates", update: "updates",
    change: "changes", set: "sets", save: "saves", delete: "deletes", remove: "removes",
    clear: "clears", check: "checks", calculate: "calculates", count: "counts", send: "sends",
    publish: "publishes", notify: "notifies", process: "processes", run: "runs", start: "starts",
    stop: "stops", record: "records", synchronize: "synchronizes", import: "imports", export: "exports",
    perform: "performs",
  };
  return (forms[verb] || verb) + (rest.length ? " " + rest.join(" ") : "");
}

function plainFlowStep(node: GraphNode): string {
  const owner = ownerSubject(node);
  const method = methodName(node);
  if (/transaction/i.test(node.label + " " + method)) return "runs the change inside a database transaction";
  if (/log|telemetry|audit/i.test(node.label + " " + method)) return "records what happened for monitoring";
  let phrase = actionPhrase(method.replace(/Admin(istrator)?/gi, ""), owner);
  if (/^(destroy|findOne|findMany|create|save)$/i.test(method) && !/\brecords?\b/.test(phrase)) phrase += " records";
  return conjugateAction(phrase);
}

function humanWords(value: string): string {
  return identifierWords(value).join(" ") || "this part of the application";
}

function identifierWords(value: string): string[] {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function capitalize(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function naturalList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "continues processing the request";
  return values.slice(0, -1).join(", ") + " and " + values.at(-1);
}

function plainNameList(nodes: GraphNode[], limit = 3): string {
  const names = nodes.slice(0, limit).map((node) => {
    const name = humanWords(node.label).toLowerCase();
    if (["table", "entity", "model"].includes(node.type)) return singularize(name) + " records";
    if (node.type === "database") return name + " database";
    return name;
  });
  if (nodes.length > limit) names.push(String(nodes.length - limit) + " other data sources");
  return naturalList(names);
}

function singularize(value: string): string {
  if (/ies$/i.test(value)) return value.slice(0, -3) + "y";
  if (/sses$/i.test(value)) return value.slice(0, -2);
  if (/s$/i.test(value) && !/ss$/i.test(value)) return value.slice(0, -1);
  return value;
}

function pluralize(value: string): string {
  if (/s$/i.test(value)) return value;
  if (/[^aeiou]y$/i.test(value)) return value.slice(0, -1) + "ies";
  return value + "s";
}

function isNode(node: GraphNode | undefined): node is GraphNode {
  return Boolean(node);
}
