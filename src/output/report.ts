import type { ArchitectureGraph, ArchitectureRisk } from "../core/types.js";

export function generateReport(graph: ArchitectureGraph, risks: ArchitectureRisk[]): string {
  const byType = (type: string) => graph.nodes.filter((node) => node.type === type);
  const lines = [
    `# Atlas Architecture Report: ${graph.project.name}`,
    "",
    `Generated: ${graph.project.createdAt}`,
    `Project root: \`${graph.project.root}\``,
    `Detected stacks: ${graph.project.detectedStacks.join(", ") || "none"}`,
    "",
    "## Summary",
    "",
    `- Nodes: ${graph.stats.totalNodes}`,
    `- Edges: ${graph.stats.totalEdges}`,
    `- Modules: ${byType("module").length}`,
    `- Controllers: ${byType("controller").length}`,
    `- Services: ${byType("service").length}`,
    `- Routes: ${byType("route").length}`,
    `- Tables: ${byType("table").length}`,
    `- Schemas: ${byType("schema").length}`,
    `- Indexes: ${byType("index").length}`,
    `- Migrations: ${byType("migration").length}`,
    `- Scheduled jobs: ${byType("scheduled_job").length}`,
    `- Deployments: ${byType("deployment").length}`,
    `- External APIs: ${byType("external_api").length}`,
    `- Risks: ${risks.length}`,
    "",
  ];
  if (!graph.project.detectedStacks.length || !byType("module").length) {
    lines.push("## Warnings", "", "No supported framework architecture was detected. The report contains the basic project and file graph only.", "");
  }
  addNodeSection(lines, "Modules", byType("module"));
  addNodeSection(lines, "Routes", byType("route"), (node) => `${node.label}${node.file ? ` — \`${node.file}\`` : ""}`);
  addNodeSection(lines, "Controllers", byType("controller"));
  addNodeSection(lines, "Services", byType("service"));
  addNodeSection(lines, "Database Models and Tables", [...byType("model"), ...byType("table")]);
  addNodeSection(lines, "Database Schemas", byType("schema"));
  addNodeSection(lines, "Indexes and Constraints", [...byType("index"), ...byType("constraint")]);
  addNodeSection(lines, "Migrations", byType("migration"));
  addNodeSection(lines, "Materialized Views", byType("materialized_view"));
  addNodeSection(lines, "ClickHouse", graph.nodes.filter((node) => node.framework === "clickhouse" && ["database", "schema", "table", "materialized_view"].includes(node.type)), (node) => {
    const details = [node.metadata?.engine, node.metadata?.partitionBy ? `PARTITION BY ${String(node.metadata.partitionBy)}` : "", node.metadata?.orderBy ? `ORDER BY ${String(node.metadata.orderBy)}` : "", node.metadata?.ttl ? `TTL ${String(node.metadata.ttl)}` : ""].filter(Boolean).join(" · ");
    return `${node.label}${details ? ` — ${details}` : ""}${node.file ? ` — \`${node.file}\`` : ""}`;
  });
  addNodeSection(lines, "Scheduled Jobs", byType("scheduled_job"), (node) => `${node.label} — ${String(node.metadata?.humanSchedule ?? node.metadata?.expression ?? "configured schedule")}${node.file ? ` — \`${node.file}\`` : ""}`);
  addNodeSection(lines, "CI/CD Workflows", [...byType("workflow"), ...byType("pipeline_job")]);
  addNodeSection(lines, "Runtime Environments", byType("environment"));
  addNodeSection(lines, "Deployments and Containers", [...byType("deployment"), ...byType("container")]);
  addNodeSection(lines, "External APIs", byType("external_api"));
  addNodeSection(lines, "Environment Variables", byType("environment_variable"));
  lines.push("## Risks", "");
  if (!risks.length) lines.push("No risks detected by the current rule set.", "");
  for (const item of risks) {
    lines.push(`### ${item.severity.toUpperCase()}: ${item.title}`, "", item.description, "", `Recommendation: ${item.recommendation}`, "");
  }
  lines.push("---", "", "Generated locally by Atlas. No source code was uploaded.", "");
  return lines.join("\n");
}

function addNodeSection(lines: string[], title: string, nodes: ArchitectureGraph["nodes"], format = (node: ArchitectureGraph["nodes"][number]) => `${node.label}${node.file ? ` — \`${node.file}\`` : ""}`) {
  lines.push(`## ${title}`, "");
  if (!nodes.length) lines.push("None detected.", "");
  else for (const node of nodes) lines.push(`- ${format(node)}`);
  lines.push("");
}
