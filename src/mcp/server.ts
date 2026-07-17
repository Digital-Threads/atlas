import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { GraphQuery } from "../core/graph.js";
import type { ArchitectureGraph } from "../core/types.js";

export async function startMcpServer(projectPath: string, outputPath = ".atlas"): Promise<void> {
  const graphPath = resolve(projectPath, outputPath, "graph.json");
  const graph = JSON.parse(await readFile(graphPath, "utf8")) as ArchitectureGraph;
  const query = new GraphQuery(graph);
  const server = new McpServer({ name: "atlas", version: graph.version });
  const result = (data: Record<string, unknown>) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  });

  server.registerTool("atlas_find_node", {
    description: "Find architecture nodes by name, label, type, file, route, or metadata.",
    inputSchema: { query: z.string().min(1) },
  }, async ({ query: value }) => result({ results: query.findNode(value) }));

  server.registerTool("atlas_get_node", {
    description: "Get one node and its incoming, outgoing, and method relationships.",
    inputSchema: { id: z.string().min(1) },
  }, async ({ id }) => {
    const node = query.getNode(id);
    const outgoing = query.getOutgoing(id);
    const methods = outgoing.filter((edge) => edge.type === "has_method").map((edge) => query.getNode(edge.to)).filter(Boolean);
    return result({ node, incoming: query.getIncoming(id), outgoing, methods });
  });

  server.registerTool("atlas_get_dependencies", {
    description: "Traverse outgoing architecture dependencies from a node.",
    inputSchema: { id: z.string().min(1), depth: z.number().int().min(1).max(10).default(2) },
  }, async ({ id, depth }) => result({ graph: query.findDependencies(id, depth) }));

  server.registerTool("atlas_get_dependents", {
    description: "Traverse incoming architecture dependents of a node.",
    inputSchema: { id: z.string().min(1), depth: z.number().int().min(1).max(10).default(2) },
  }, async ({ id, depth }) => result({ graph: query.findDependents(id, depth) }));

  server.registerTool("atlas_find_path", {
    description: "Find the shortest explainable architecture path between two exact node IDs.",
    inputSchema: {
      from: z.string().min(1),
      to: z.string().min(1),
      direction: z.enum(["outgoing", "both"]).default("outgoing"),
      maxDepth: z.number().int().min(1).max(50).default(20),
    },
  }, async ({ from, to, direction, maxDepth }) => result({
    from: query.getNode(from),
    to: query.getNode(to),
    path: query.findPath(from, to, direction, maxDepth),
  }));

  server.registerTool("atlas_find_routes", { description: "List all detected HTTP routes." }, async () => result({ routes: query.findRoutes() }));

  server.registerTool("atlas_find_flow", {
    description: "Find a route and return its route-to-controller-to-service-to-data flow.",
    inputSchema: { query: z.string().min(1) },
  }, async ({ query: value }) => {
    const route = query.findNode(value).find((node) => node.type === "route");
    return result({ route: route ?? null, flow: route ? query.findFlowFromRoute(route.id) : { nodes: [], edges: [] } });
  });

  server.registerTool("atlas_find_tables", { description: "List detected database tables." }, async () => result({ tables: query.findTables() }));
  server.registerTool("atlas_find_data_model", { description: "List schemas, tables, indexes, constraints, migrations, and ClickHouse structures." }, async () => result({
    schemas: query.findSchemas(), tables: query.findTables(), indexes: query.findIndexes(), constraints: query.findConstraints(), migrations: query.findMigrations(),
  }));
  server.registerTool("atlas_get_table_profile", {
    description: "Return a table with its columns, indexes, constraints, relations, migrations, readers, and writers.",
    inputSchema: { query: z.string().min(1) },
  }, async ({ query: value }) => {
    const table = query.findNode(value).find((node) => node.type === "table");
    return result({ table: table ?? null, profile: table ? query.findTableProfile(table.id) : { nodes: [], edges: [] } });
  });
  server.registerTool("atlas_find_migrations", { description: "List migrations and the structures they create, alter, or drop." }, async () => result({ migrations: query.findMigrations() }));
  server.registerTool("atlas_find_external_apis", { description: "List detected external API hosts." }, async () => result({ externalApis: query.findExternalApis() }));

  server.registerTool("atlas_find_async_flows", {
    description: "List detected Kafka or RabbitMQ topics, Bull/BullMQ queues, and background processors.",
  }, async () => result({ topics: query.findMessageTopics(), queues: query.findQueues(), processors: query.findProcessors() }));

  server.registerTool("atlas_find_async_flow", {
    description: "Find a message topic or queue and return publishers, consumers, processors, and downstream calls.",
    inputSchema: { query: z.string().min(1) },
  }, async ({ query: value }) => {
    const root = query.findNode(value).find((node) => ["message_topic", "queue"].includes(node.type));
    return result({ root: root ?? null, flow: root ? query.findAsyncFlow(root.id) : { nodes: [], edges: [] } });
  });

  server.registerTool("atlas_find_schedules", { description: "List cron, interval, timeout, repeatable queue, and Kubernetes scheduled jobs." }, async () => result({ schedules: query.findScheduledJobs() }));
  server.registerTool("atlas_find_delivery", { description: "List CI/CD workflows and runtime deployments." }, async () => result({ workflows: query.findWorkflows(), deployments: query.findDeployments() }));
  server.registerTool("atlas_find_environments", { description: "List detected development, staging, production, and custom runtime environments." }, async () => result({ environments: query.findEnvironments() }));

  server.registerTool("atlas_search", {
    description: "Search the complete architecture graph.",
    inputSchema: { query: z.string().min(1) },
  }, async ({ query: value }) => result({ results: query.search(value) }));

  server.registerTool("atlas_project_summary", { description: "Return project identity and graph statistics." }, async () => result({ project: graph.project, stats: graph.stats }));

  await server.connect(new StdioServerTransport());
  console.error(`Atlas MCP server ready: ${graphPath}`);
}
