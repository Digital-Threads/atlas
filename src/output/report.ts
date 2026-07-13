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
