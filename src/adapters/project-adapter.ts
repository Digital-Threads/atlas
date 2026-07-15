import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadAll } from "js-yaml";
import type { GraphEdge, GraphNode, ScannedFile } from "../core/types.js";
import type { AdapterContext, AdapterDetectionResult, AdapterResult, ArchitectureAdapter } from "./adapter.js";

type AddNode = (node: GraphNode) => void;
type AddEdge = (from: string, to: string, type: GraphEdge["type"], metadata?: Record<string, unknown>) => void;
type Dict = Record<string, unknown>;

const secretName = /(secret|password|passwd|token|api[_-]?key|private[_-]?key|credential|dsn|database_url)/i;
const environmentAliases: Record<string, string> = {
  local: "local", dev: "development", development: "development", stage: "staging",
  staging: "staging", prod: "production", production: "production",
};

export class ProjectAdapter implements ArchitectureAdapter {
  readonly name = "project-configuration";

  async detect(context: AdapterContext): Promise<AdapterDetectionResult> {
    const evidence = context.files.filter((file) => isProjectConfig(file)).map((file) => file.path);
    return { detected: evidence.length > 0, confidence: evidence.length ? 1 : 0, evidence: evidence.slice(0, 20) };
  }

  async buildNodes(result: AdapterResult): Promise<GraphNode[]> { return result.nodes; }
  async buildEdges(result: AdapterResult): Promise<AdapterResult["edges"]> { return result.edges; }

  async scan(context: AdapterContext): Promise<AdapterResult> {
    const nodes = new Map<string, GraphNode>();
    const edges: AdapterResult["edges"] = [];
    const warnings: string[] = [];
    const contents = new Map<string, string>();
    const addNode: AddNode = (node) => nodes.set(node.id, {
      ...nodes.get(node.id), ...node, metadata: { ...nodes.get(node.id)?.metadata, ...node.metadata },
    });
    const addEdge: AddEdge = (from, to, type, metadata) => {
      edges.push({ from, to, type, label: type, source: "config", confidence: 1, metadata });
    };
    const contentOf = async (file: ScannedFile) => {
      if (contents.has(file.path)) return contents.get(file.path)!;
      const content = await readFile(file.absolutePath, "utf8").catch(() => "");
      contents.set(file.path, content);
      return content;
    };

    const packageFile = context.files.find((file) => file.path === "package.json");
    const packageText = packageFile ? await contentOf(packageFile) : "";
    const clickHouseProject = /@clickhouse\/client|clickhouse-js|clickhouse/i.test(packageText);

    for (const file of context.files.filter((item) => item.extension === ".env")) {
      parseEnvironmentContract(file, await contentOf(file), addNode, addEdge);
    }

    for (const file of context.files.filter((item) => item.extension === ".sql" || isMigrationFile(item))) {
      const content = await contentOf(file);
      const fragments = file.extension === ".sql" ? [content] : extractSqlFragments(content);
      parseSqlFile(file, fragments, clickHouseProject, addNode, addEdge);
    }

    for (const file of context.files.filter((item) => [".ts", ".js"].includes(item.extension))) {
      const content = await contentOf(file);
      parseSchedules(file, content, addNode, addEdge);
      parseRepeatableJobs(file, content, addNode, addEdge);
      if (/CREATE\s+(?:MATERIALIZED\s+VIEW|TABLE)|ALTER\s+TABLE/i.test(content) && /clickhouse|MergeTree|PARTITION\s+BY/i.test(content)) {
        parseSqlFile(file, extractSqlFragments(content), true, addNode, addEdge);
      }
    }

    for (const file of context.files.filter((item) => isWorkflowFile(item.path))) {
      parseWorkflow(file, await contentOf(file), addNode, addEdge, warnings);
    }

    for (const file of context.files.filter((item) => item.extension.startsWith("dockerfile"))) {
      parseDockerfile(file, await contentOf(file), context.projectRoot, addNode, addEdge);
    }

    for (const file of context.files.filter((item) => [".yml", ".yaml", ".tpl"].includes(item.extension))) {
      const content = await contentOf(file);
      if (isWorkflowFile(file.path)) continue;
      if (isComposeFile(file.path, content)) parseCompose(file, content, addNode, addEdge, warnings);
      if (isKubernetesFile(file.path, content)) parseKubernetes(file, content, addNode, addEdge, warnings);
    }

    resolveInfrastructureEdges(nodes, edges);
    return { nodes: [...nodes.values()], edges, warnings };
  }
}

function isProjectConfig(file: ScannedFile): boolean {
  return file.extension === ".sql" || file.extension === ".env" || file.extension.startsWith("dockerfile")
    || isWorkflowFile(file.path) || [".yml", ".yaml", ".tpl"].includes(file.extension)
    || [".ts", ".js"].includes(file.extension);
}

function isMigrationFile(file: ScannedFile): boolean {
  return [".ts", ".js"].includes(file.extension) && /(^|\/)(migrations?|database\/migrations?)(\/|$)/i.test(file.path);
}

function isWorkflowFile(path: string): boolean {
  return /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i.test(path) || /(^|\/)\.gitlab-ci\.ya?ml$/i.test(path);
}

function isComposeFile(path: string, content: string): boolean {
  return /(^|\/)(docker-)?compose(?:\.[^.]+)?\.ya?ml$/i.test(path) || /^services:\s*$/m.test(content);
}

function isKubernetesFile(path: string, content: string): boolean {
  return /(^|\/)(k8s|kubernetes|helm|charts?|manifests?|overlays?)(\/|$)/i.test(path)
    || /^kind:\s*(Deployment|StatefulSet|DaemonSet|Service|Ingress|ConfigMap|Secret|CronJob|Job)\s*$/m.test(content);
}

function parseEnvironmentContract(file: ScannedFile, content: string, addNode: AddNode, addEdge: AddEdge) {
  const example = /(?:example|sample|template|defaults?)$/i.test(file.path);
  const environment = environmentFromPath(file.path);
  if (environment) addEnvironment(environment, file.path, addNode);
  let pendingComment = "";
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("#")) { pendingComment = line.replace(/^#+\s*/, ""); continue; }
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) { if (line) pendingComment = ""; continue; }
    const [, name, rawValue] = match;
    const sensitive = secretName.test(name);
    const value = unquote(rawValue.replace(/\s+#.*$/, "").trim());
    const id = `environment_variable:${name}`;
    addNode({
      id, type: "environment_variable", label: name, name, file: file.path, source: "config", confidence: 1,
      metadata: {
        valueStored: Boolean(example && !sensitive && value), sensitive, example, required: example && !value,
        ...(example && !sensitive && value ? { exampleValue: value } : {}),
        ...(pendingComment ? { purpose: pendingComment } : {}),
        ...(environment ? { environment } : {}),
      },
    });
    addEdge(`file:${file.path}`, id, "declares", { valueStored: Boolean(example && !sensitive && value) });
    if (environment) addEdge(id, `environment:${environment}`, "runs_in");
    pendingComment = "";
  }
}

function parseSqlFile(file: ScannedFile, fragments: string[], clickHouseProject: boolean, addNode: AddNode, addEdge: AddEdge) {
  const statements = fragments.flatMap(splitSqlStatements).filter(Boolean);
  if (!statements.length) return;
  const migration = isMigrationFile(file) || /(^|\/)(migrations?|ddl)(\/|$)/i.test(file.path);
  const migrationId = `migration:${file.path}`;
  if (migration) {
    addNode({ id: migrationId, type: "migration", label: basename(file.path), name: basename(file.path), file: file.path, source: "config", confidence: 1, metadata: { statements: statements.length } });
    addEdge(`file:${file.path}`, migrationId, "declares");
  }
  for (const statement of statements) {
    const clickhouse = clickHouseProject || /MergeTree|ReplacingMergeTree|Replicated\w*MergeTree|PARTITION\s+BY|TTL\s+/i.test(statement);
    const databaseId = clickhouse ? "database:clickhouse" : "database:sql";
    addNode({ id: databaseId, type: "database", label: clickhouse ? "ClickHouse" : "SQL database", name: clickhouse ? "ClickHouse" : "SQL database", file: file.path, framework: clickhouse ? "clickhouse" : "sql", source: "config", confidence: clickhouse ? 1 : 0.7 });
    parseCreateTable(statement, file, databaseId, migration ? migrationId : null, clickhouse, addNode, addEdge);
    parseAlterTable(statement, file, databaseId, migration ? migrationId : null, clickhouse, addNode, addEdge);
    parseCreateIndex(statement, file, migration ? migrationId : null, addNode, addEdge);
    parseMaterializedView(statement, file, databaseId, migration ? migrationId : null, clickhouse, addNode, addEdge);
  }
}

function parseCreateTable(statement: string, file: ScannedFile, databaseId: string, migrationId: string | null, clickhouse: boolean, addNode: AddNode, addEdge: AddEdge) {
  const match = statement.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)\s*\(/i);
  if (!match) return;
  const qualified = sqlName(match[1]);
  const { schema, table } = splitQualifiedName(qualified);
  const tableId = tableNodeId(schema, table);
  addSchemaAndTable(databaseId, schema, table, tableId, file.path, clickhouse, addNode, addEdge);
  const open = statement.indexOf("(", match.index! + match[0].length - 1);
  const close = matchingParen(statement, open);
  if (open < 0 || close < 0) return;
  const body = statement.slice(open + 1, close);
  const tableMeta = clickhouse ? clickHouseMetadata(statement.slice(close + 1)) : {};
  addNode({ id: tableId, type: "table", label: qualified, name: table, file: file.path, framework: clickhouse ? "clickhouse" : "sql", source: "config", confidence: 1, metadata: tableMeta });
  if (migrationId) addEdge(migrationId, tableId, "creates");
  for (const definition of splitTopLevel(body)) {
    const trimmed = definition.trim();
    const constraint = parseTableConstraint(trimmed, qualified, tableId, databaseId, clickhouse, file.path, addNode, addEdge);
    if (constraint) continue;
    const column = trimmed.match(/^([`"\w.]+)\s+([^\s,]+(?:\s*\([^)]*\))?)([\s\S]*)$/);
    if (!column) continue;
    const name = sqlName(column[1]);
    const rest = column[3];
    const columnId = `column:${qualified}.${name}`;
    addNode({ id: columnId, type: "column", label: `${qualified}.${name}`, name, file: file.path, framework: clickhouse ? "clickhouse" : "sql", source: "config", confidence: 1, metadata: {
      type: column[2], nullable: !/\bNOT\s+NULL\b/i.test(rest), primaryKey: /\bPRIMARY\s+KEY\b/i.test(rest), unique: /\bUNIQUE\b/i.test(rest),
      ...(rest.match(/\bDEFAULT\s+([^,]+)/i)?.[1] ? { default: rest.match(/\bDEFAULT\s+([^,]+)/i)![1].trim() } : {}),
    } });
    addEdge(tableId, columnId, "has_column");
    const reference = rest.match(/\bREFERENCES\s+([^\s(]+)/i);
    if (reference) {
      const target = splitQualifiedName(sqlName(reference[1]));
      const targetId = tableNodeId(target.schema, target.table);
      addSchemaAndTable(databaseId, target.schema, target.table, targetId, file.path, clickhouse, addNode, addEdge);
      addEdge(tableId, targetId, "references", { column: name });
    }
  }
}

function parseTableConstraint(definition: string, qualified: string, tableId: string, databaseId: string, clickhouse: boolean, file: string, addNode: AddNode, addEdge: AddEdge): boolean {
  const match = definition.match(/^(?:CONSTRAINT\s+([`"\w.-]+)\s+)?(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK)\s*(?:\(([^)]*)\))?([\s\S]*)$/i);
  if (!match) return false;
  const kind = match[2].toLowerCase().replace(/\s+/g, "_");
  const columns = (match[3] ?? "").split(",").map((item) => sqlName(item.trim())).filter(Boolean);
  const name = match[1] ? sqlName(match[1]) : `${kind}_${columns.join("_") || "rule"}`;
  const id = `constraint:${qualified}.${name}`;
  addNode({ id, type: "constraint", label: name, name, file, source: "config", confidence: 1, metadata: { kind, columns, expression: match[4].trim() } });
  addEdge(tableId, id, "contains");
  const reference = match[4].match(/REFERENCES\s+([^\s(]+)/i);
  if (reference) {
    const target = splitQualifiedName(sqlName(reference[1]));
    const targetId = tableNodeId(target.schema, target.table);
    addSchemaAndTable(databaseId, target.schema, target.table, targetId, file, clickhouse, addNode, addEdge);
    addEdge(tableId, targetId, "references", { constraint: name, columns });
  }
  return true;
}

function parseAlterTable(statement: string, file: ScannedFile, databaseId: string, migrationId: string | null, clickhouse: boolean, addNode: AddNode, addEdge: AddEdge) {
  const match = statement.match(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s]+)\s+([\s\S]*)/i);
  if (!match) return;
  const qualified = sqlName(match[1]);
  const { schema, table } = splitQualifiedName(qualified);
  const tableId = tableNodeId(schema, table);
  addSchemaAndTable(databaseId, schema, table, tableId, file.path, clickhouse, addNode, addEdge);
  if (migrationId) addEdge(migrationId, tableId, /\bDROP\s+TABLE\b/i.test(statement) ? "drops" : "alters", { statement: compactSql(match[2]) });
  const addColumn = match[2].match(/ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([`"\w.]+)\s+([^\s,]+)/i);
  if (addColumn) {
    const name = sqlName(addColumn[1]);
    const columnId = `column:${qualified}.${name}`;
    addNode({ id: columnId, type: "column", label: `${qualified}.${name}`, name, file: file.path, framework: clickhouse ? "clickhouse" : "sql", source: "config", confidence: 0.9, metadata: { type: addColumn[2], addedByMigration: migrationId } });
    addEdge(tableId, columnId, "has_column");
    if (migrationId) addEdge(migrationId, columnId, "creates");
  }
}

function parseCreateIndex(statement: string, file: ScannedFile, migrationId: string | null, addNode: AddNode, addEdge: AddEdge) {
  const match = statement.match(/CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s]+)\s+ON\s+([^\s(]+)\s*\(([^)]*)\)([\s\S]*)/i);
  if (!match) return;
  const indexName = sqlName(match[2]);
  const qualified = sqlName(match[3]);
  const target = splitQualifiedName(qualified);
  const id = `index:${qualified}.${indexName}`;
  addNode({ id, type: "index", label: indexName, name: indexName, file: file.path, source: "config", confidence: 1, metadata: { unique: Boolean(match[1]), columns: splitTopLevel(match[4]).map((item) => item.trim()), predicate: match[5].match(/WHERE\s+([\s\S]*)/i)?.[1]?.trim() } });
  addEdge(id, tableNodeId(target.schema, target.table), "indexes");
  if (migrationId) addEdge(migrationId, id, "creates");
}

function parseMaterializedView(statement: string, file: ScannedFile, databaseId: string, migrationId: string | null, clickhouse: boolean, addNode: AddNode, addEdge: AddEdge) {
  const match = statement.match(/CREATE\s+MATERIALIZED\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)([\s\S]*)/i);
  if (!match) return;
  const name = sqlName(match[1]);
  const id = `materialized_view:${name}`;
  addNode({ id, type: "materialized_view", label: name, name, file: file.path, framework: clickhouse ? "clickhouse" : "sql", source: "config", confidence: 1, metadata: clickHouseMetadata(match[2]) });
  addEdge(databaseId, id, "contains");
  if (migrationId) addEdge(migrationId, id, "creates");
  const target = match[2].match(/\bTO\s+([^\s(]+)/i);
  if (target) { const q = splitQualifiedName(sqlName(target[1])); addEdge(id, tableNodeId(q.schema, q.table), "writes"); }
  const source = match[2].match(/\bFROM\s+([^\s(]+)/i);
  if (source) { const q = splitQualifiedName(sqlName(source[1])); addEdge(id, tableNodeId(q.schema, q.table), "reads"); }
}

function addSchemaAndTable(databaseId: string, schema: string, table: string, tableId: string, file: string, clickhouse: boolean, addNode: AddNode, addEdge: AddEdge) {
  const schemaId = `schema:${clickhouse ? "clickhouse." : ""}${schema}`;
  addNode({ id: schemaId, type: "schema", label: schema, name: schema, file, framework: clickhouse ? "clickhouse" : "sql", source: "config", confidence: 1 });
  addNode({ id: tableId, type: "table", label: schema === "public" ? table : `${schema}.${table}`, name: table, file, framework: clickhouse ? "clickhouse" : "sql", source: "config", confidence: 0.9, metadata: { schema } });
  addEdge(databaseId, schemaId, "contains");
  addEdge(schemaId, tableId, "contains");
}

function parseSchedules(file: ScannedFile, content: string, addNode: AddNode, addEdge: AddEdge) {
  const classes = [...content.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)];
  const decorators = /@(Cron|Interval|Timeout)\s*\(([^)]*(?:\)[^)]*)?)\)\s*(?:public\s+|private\s+|protected\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of content.matchAll(decorators)) {
    const className = [...classes].reverse().find((item) => (item.index ?? 0) < (match.index ?? 0))?.[1] ?? basename(file.path);
    const [, kind, rawExpression, method] = match;
    const rawSchedule = rawExpression.split(",")[0].trim();
    const expression = expressionValue(rawSchedule) ?? (/^[\d_]+$/.test(rawSchedule) ? rawSchedule.replaceAll("_", "") : rawSchedule);
    const timeZone = rawExpression.match(/timeZone\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
    const id = `scheduled_job:${className}.${method}:${kind.toLowerCase()}`;
    const methodId = `method:${className}.${method}`;
    addNode({ id: methodId, type: "method", label: `${className}.${method}`, name: method, file: file.path, source: "heuristic", confidence: 0.8 });
    addNode({ id, type: "scheduled_job", label: `${className}.${method}`, name: method, file: file.path, framework: "nestjs-schedule", source: "ast", confidence: 1, metadata: { kind: kind.toLowerCase(), expression, humanSchedule: humanSchedule(kind, expression), ...(timeZone ? { timeZone } : {}) } });
    addEdge(`file:${file.path}`, id, "declares");
    addEdge(id, methodId, "schedules", { expression, timeZone });
  }
}

function parseRepeatableJobs(file: ScannedFile, content: string, addNode: AddNode, addEdge: AddEdge) {
  const repeat = /\.add\s*\(\s*(['"`])([^'"`]+)\1[\s\S]{0,1200}?repeat\s*:\s*\{([\s\S]{0,400}?)\}/g;
  for (const match of content.matchAll(repeat)) {
    const job = match[2];
    const body = match[3];
    const expression = body.match(/(?:pattern|cron)\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? body.match(/every\s*:\s*([\d_]+)/)?.[1]?.replaceAll("_", "");
    const id = `scheduled_job:bull:${cleanId(job)}`;
    addNode({ id, type: "scheduled_job", label: job, name: job, file: file.path, framework: "bull", source: "ast", confidence: 0.9, metadata: { kind: "repeatable_job", expression, humanSchedule: expression ? humanSchedule("Cron", expression) : "Repeatable queue job" } });
    addEdge(`file:${file.path}`, id, "declares");
  }
}

function parseWorkflow(file: ScannedFile, content: string, addNode: AddNode, addEdge: AddEdge, warnings: string[]) {
  const docs = parseYaml(content, file.path, warnings);
  for (const value of docs) {
    const doc = asDict(value);
    if (!doc) continue;
    const gitlab = /\.gitlab-ci\.ya?ml$/i.test(file.path);
    const name = String(doc.name ?? (gitlab ? "GitLab CI" : basename(file.path)));
    const workflowId = `workflow:${cleanId(file.path)}`;
    addNode({ id: workflowId, type: "workflow", label: name, name, file: file.path, framework: gitlab ? "gitlab-ci" : "github-actions", source: "config", confidence: 1, metadata: { triggers: doc.on ?? doc.workflow ?? null } });
    addEdge(`file:${file.path}`, workflowId, "declares");
    const jobs = gitlab ? Object.fromEntries(Object.entries(doc).filter(([key, item]) => !["stages", "variables", "workflow", "include", "default", "image", "services", "before_script", "after_script", "cache"].includes(key) && asDict(item))) : asDict(doc.jobs) ?? {};
    for (const [jobName, rawJob] of Object.entries(jobs)) {
      const job = asDict(rawJob); if (!job) continue;
      const jobId = `pipeline_job:${cleanId(file.path)}:${cleanId(jobName)}`;
      const environment = normalizeEnvironment(typeof job.environment === "string" ? job.environment : String(asDict(job.environment)?.name ?? ""));
      if (environment) addEnvironment(environment, file.path, addNode);
      addNode({ id: jobId, type: "pipeline_job", label: jobName, name: jobName, file: file.path, framework: gitlab ? "gitlab-ci" : "github-actions", source: "config", confidence: 1, metadata: { stage: job.stage, runner: job["runs-on"], environment, needs: job.needs } });
      addEdge(workflowId, jobId, "contains");
      if (environment) addEdge(jobId, `environment:${environment}`, "runs_in");
      for (const dependency of stringList(job.needs)) addEdge(jobId, `pipeline_job:${cleanId(file.path)}:${cleanId(dependency)}`, "depends_on");
      const steps = Array.isArray(job.steps) ? job.steps.map(asDict).filter(Boolean) as Dict[] : [];
      const script = [...steps.map((step) => `${step.uses ?? ""}\n${step.run ?? ""}`), ...stringList(job.script)].join("\n");
      parseDeliveryCommands(jobId, script, file.path, environment, addNode, addEdge);
    }
  }
}

function parseDeliveryCommands(jobId: string, script: string, file: string, environment: string | null, addNode: AddNode, addEdge: AddEdge) {
  const imageMatches = [
    ...[...script.matchAll(/docker\s+build[^\n]*?(?:-t|--tag)\s+([^\s]+)/gi)].map((match) => ({ image: match[1], operation: "builds" as const })),
    ...[...script.matchAll(/docker\s+push\s+([^\s]+)/gi)].map((match) => ({ image: match[1], operation: "publishes" as const })),
    ...[...script.matchAll(/\btags?\s*:\s*([^\s]+)/gi)].map((match) => ({ image: match[1], operation: "builds" as const })),
  ];
  for (const match of imageMatches) {
    const image = match.image.replace(/["',]+$/, "");
    const id = `container_image:${cleanId(image)}`;
    addNode({ id, type: "container_image", label: image, name: image, file, source: "config", confidence: 0.9, metadata: { environment } });
    addEdge(jobId, id, match.operation);
  }
  if (/kubectl|helm\s+(?:upgrade|install)|kustomize/i.test(script)) {
    const id = `deployment:workflow:${cleanId(jobId)}`;
    addNode({ id, type: "deployment", label: environment ? `Deploy to ${environment}` : "Deployment", name: "deployment", file, source: "config", confidence: 0.7, metadata: { environment } });
    addEdge(jobId, id, "deploys");
    if (environment) addEdge(id, `environment:${environment}`, "runs_in");
  }
}

function parseDockerfile(file: ScannedFile, content: string, projectRoot: string, addNode: AddNode, addEdge: AddEdge) {
  const logical = content.replace(/\\\r?\n\s*/g, " ").split(/\r?\n/);
  let stageId: string | null = null;
  let stageIndex = 0;
  const stages = new Map<string, string>();
  const finalImageId = `container_image:${cleanId(basename(projectRoot))}`;
  for (const line of logical) {
    const instruction = line.trim().match(/^([A-Za-z]+)\s+([\s\S]+)$/);
    if (!instruction || line.trim().startsWith("#")) continue;
    const command = instruction[1].toUpperCase(), value = instruction[2].trim();
    if (command === "FROM") {
      const from = value.match(/^([^\s]+)(?:\s+AS\s+([^\s]+))?/i); if (!from) continue;
      stageIndex += 1;
      const stage = from[2] ?? `stage-${stageIndex}`;
      stageId = `build_stage:${cleanId(file.path)}:${cleanId(stage)}`;
      addNode({ id: stageId, type: "build_stage", label: stage, name: stage, file: file.path, source: "config", confidence: 1, metadata: { baseImage: from[1], order: stageIndex } });
      addEdge(`file:${file.path}`, stageId, "declares");
      const priorStage = stages.get(from[1].toLowerCase());
      if (priorStage) {
        addEdge(stageId, priorStage, "depends_on");
      } else {
        const baseId = `container_image:${cleanId(from[1])}`;
        addNode({ id: baseId, type: "container_image", label: from[1], name: from[1], file: file.path, source: "config", confidence: 1, metadata: { baseImage: true } });
        addEdge(stageId, baseId, "depends_on");
      }
      stages.set(stage.toLowerCase(), stageId);
      continue;
    }
    if (!stageId) continue;
    if (["EXPOSE", "CMD", "ENTRYPOINT", "HEALTHCHECK", "USER", "WORKDIR"].includes(command)) {
      addNode({ id: stageId, type: "build_stage", label: stageId.split(":").at(-1)!, name: stageId.split(":").at(-1)!, file: file.path, source: "config", confidence: 1, metadata: { [command.toLowerCase()]: value } });
    }
  }
  if (stageId) {
    addNode({ id: finalImageId, type: "container_image", label: basename(projectRoot), name: basename(projectRoot), file: file.path, source: "config", confidence: 0.8, metadata: { localBuild: true } });
    addEdge(stageId, finalImageId, "builds");
  }
}

function parseCompose(file: ScannedFile, content: string, addNode: AddNode, addEdge: AddEdge, warnings: string[]) {
  const doc = asDict(parseYaml(content, file.path, warnings)[0]);
  const services = asDict(doc?.services); if (!services) return;
  const environment = environmentFromPath(file.path) ?? "local";
  addEnvironment(environment, file.path, addNode);
  for (const [name, rawService] of Object.entries(services)) {
    const service = asDict(rawService); if (!service) continue;
    const id = `container:${cleanId(file.path)}:${cleanId(name)}`;
    addNode({ id, type: "container", label: name, name, file: file.path, framework: "docker-compose", source: "config", confidence: 1, metadata: { image: service.image, build: service.build, ports: service.ports, volumes: service.volumes, environment } });
    addEdge(`file:${file.path}`, id, "declares");
    addEdge(id, `environment:${environment}`, "runs_in");
    if (typeof service.image === "string") {
      const imageId = `container_image:${cleanId(service.image)}`;
      addNode({ id: imageId, type: "container_image", label: service.image, name: service.image, file: file.path, source: "config", confidence: 1 });
      addEdge(id, imageId, "uses");
    }
    for (const dependency of stringList(service.depends_on)) addEdge(id, `container:${cleanId(file.path)}:${cleanId(dependency)}`, "depends_on");
    for (const name of environmentNames(service.environment)) {
      const envId = `environment_variable:${name}`;
      addNode({ id: envId, type: "environment_variable", label: name, name, file: file.path, source: "config", confidence: 1, metadata: { valueStored: false, environment } });
      addEdge(id, envId, "configures");
    }
  }
}

function parseKubernetes(file: ScannedFile, content: string, addNode: AddNode, addEdge: AddEdge, warnings: string[]) {
  for (const value of parseYaml(content, file.path, warnings)) {
    const doc = asDict(value); if (!doc || typeof doc.kind !== "string") continue;
    const metadata = asDict(doc.metadata) ?? {};
    const name = String(metadata.name ?? basename(file.path));
    const kind = doc.kind;
    const environment = normalizeEnvironment(String(metadata.namespace ?? "")) ?? environmentFromPath(file.path);
    if (environment) addEnvironment(environment, file.path, addNode);
    if (["Deployment", "StatefulSet", "DaemonSet", "Job"].includes(kind)) {
      parseWorkload(file, kind, name, doc, environment, addNode, addEdge);
    } else if (kind === "CronJob") {
      parseCronJob(file, name, doc, environment, addNode, addEdge);
    } else if (kind === "Service") {
      const id = `infrastructure_service:${cleanId(name)}:${environment ?? "default"}`;
      const spec = asDict(doc.spec) ?? {};
      addNode({ id, type: "infrastructure_service", label: name, name, file: file.path, framework: "kubernetes", source: "config", confidence: 1, metadata: { kind, environment, ports: spec.ports, selector: spec.selector } });
      addEdge(`file:${file.path}`, id, "declares");
      if (environment) addEdge(id, `environment:${environment}`, "runs_in");
    } else if (kind === "Ingress") {
      const id = `ingress:${cleanId(name)}:${environment ?? "default"}`;
      const spec = asDict(doc.spec) ?? {};
      addNode({ id, type: "ingress", label: name, name, file: file.path, framework: "kubernetes", source: "config", confidence: 1, metadata: { environment, rules: spec.rules, tls: spec.tls } });
      addEdge(`file:${file.path}`, id, "declares");
      if (environment) addEdge(id, `environment:${environment}`, "runs_in");
      for (const service of ingressServices(spec)) addEdge(id, `infrastructure_service:${cleanId(service)}:${environment ?? "default"}`, "exposes");
    } else if (["ConfigMap", "Secret"].includes(kind)) {
      const secret = kind === "Secret";
      const id = `${secret ? "secret" : "config_map"}:${cleanId(name)}:${environment ?? "default"}`;
      const data = asDict(doc.data) ?? asDict(doc.stringData) ?? {};
      addNode({ id, type: secret ? "secret" : "config_map", label: name, name, file: file.path, framework: "kubernetes", source: "config", confidence: 1, metadata: { environment, keys: Object.keys(data), valuesStored: false } });
      addEdge(`file:${file.path}`, id, "declares");
      if (environment) addEdge(id, `environment:${environment}`, "runs_in");
    }
  }
}

function parseWorkload(file: ScannedFile, kind: string, name: string, doc: Dict, environment: string | null, addNode: AddNode, addEdge: AddEdge) {
  const id = `deployment:${cleanId(name)}:${environment ?? "default"}`;
  const spec = asDict(doc.spec) ?? {};
  const template = asDict(spec.template) ?? {};
  const podSpec = asDict(template.spec) ?? {};
  const containers = Array.isArray(podSpec.containers) ? podSpec.containers.map(asDict).filter(Boolean) as Dict[] : [];
  addNode({ id, type: "deployment", label: name, name, file: file.path, framework: "kubernetes", source: "config", confidence: 1, metadata: { kind, environment, replicas: spec.replicas, strategy: spec.strategy, labels: asDict(asDict(template.metadata)?.labels), containerCount: containers.length } });
  addEdge(`file:${file.path}`, id, "declares");
  if (environment) addEdge(id, `environment:${environment}`, "runs_in");
  for (const raw of containers) {
    const containerName = String(raw.name ?? "container");
    const containerId = `container:${cleanId(name)}:${cleanId(containerName)}:${environment ?? "default"}`;
    addNode({ id: containerId, type: "container", label: containerName, name: containerName, file: file.path, framework: "kubernetes", source: "config", confidence: 1, metadata: { image: raw.image, ports: raw.ports, resources: raw.resources, readinessProbe: raw.readinessProbe, livenessProbe: raw.livenessProbe, environment } });
    addEdge(id, containerId, "contains");
    if (typeof raw.image === "string") {
      const imageId = `container_image:${cleanId(raw.image)}`;
      addNode({ id: imageId, type: "container_image", label: raw.image, name: raw.image, file: file.path, source: "config", confidence: 1 });
      addEdge(containerId, imageId, "uses");
    }
    for (const reference of configReferences(raw)) {
      const targetId = `${reference.secret ? "secret" : "config_map"}:${cleanId(reference.name)}:${environment ?? "default"}`;
      addEdge(containerId, targetId, "configures", { optional: reference.optional });
    }
  }
}

function parseCronJob(file: ScannedFile, name: string, doc: Dict, environment: string | null, addNode: AddNode, addEdge: AddEdge) {
  const spec = asDict(doc.spec) ?? {};
  const id = `scheduled_job:kubernetes:${cleanId(name)}:${environment ?? "default"}`;
  const expression = String(spec.schedule ?? "");
  addNode({ id, type: "scheduled_job", label: name, name, file: file.path, framework: "kubernetes", source: "config", confidence: 1, metadata: { kind: "cronjob", expression, humanSchedule: humanSchedule("Cron", expression), timeZone: spec.timeZone, concurrencyPolicy: spec.concurrencyPolicy, suspend: spec.suspend, environment } });
  addEdge(`file:${file.path}`, id, "declares");
  if (environment) addEdge(id, `environment:${environment}`, "runs_in");
  const jobTemplate = asDict(spec.jobTemplate) ?? {};
  const jobSpec = asDict(jobTemplate.spec) ?? {};
  const template = asDict(jobSpec.template) ?? {};
  const podSpec = asDict(template.spec) ?? {};
  const containers = Array.isArray(podSpec.containers) ? podSpec.containers.map(asDict).filter(Boolean) as Dict[] : [];
  for (const raw of containers) {
    const containerName = String(raw.name ?? "job");
    const containerId = `container:cronjob:${cleanId(name)}:${cleanId(containerName)}:${environment ?? "default"}`;
    addNode({ id: containerId, type: "container", label: containerName, name: containerName, file: file.path, framework: "kubernetes-cronjob", source: "config", confidence: 1, metadata: { image: raw.image, command: raw.command, args: raw.args, resources: raw.resources, environment } });
    addEdge(id, containerId, "triggers");
    if (typeof raw.image === "string") {
      const imageId = `container_image:${cleanId(raw.image)}`;
      addNode({ id: imageId, type: "container_image", label: raw.image, name: raw.image, file: file.path, source: "config", confidence: 1, metadata: { environment } });
      addEdge(containerId, imageId, "uses");
    }
    for (const reference of configReferences(raw)) {
      addEdge(containerId, `${reference.secret ? "secret" : "config_map"}:${cleanId(reference.name)}:${environment ?? "default"}`, "configures", { optional: reference.optional });
    }
  }
}

function resolveInfrastructureEdges(nodes: Map<string, GraphNode>, edges: AdapterResult["edges"]) {
  const existing = new Set(nodes.keys());
  const deployments = [...nodes.values()].filter((node) => node.type === "deployment");
  const services = [...nodes.values()].filter((node) => node.type === "infrastructure_service");
  for (const service of services) {
    const selector = asDict(service.metadata?.selector);
    if (!selector) continue;
    const target = deployments.find((deployment) => {
      const labels = asDict(deployment.metadata?.labels);
      return labels && Object.entries(selector).every(([key, value]) => labels[key] === value)
        && deployment.metadata?.environment === service.metadata?.environment;
    });
    if (target) edges.push({ from: service.id, to: target.id, type: "targets", label: "targets", source: "config", confidence: 1 });
  }
  for (let index = edges.length - 1; index >= 0; index -= 1) {
    const sourceExists = existing.has(edges[index].from) || edges[index].from.startsWith("file:");
    if (!sourceExists || !existing.has(edges[index].to)) edges.splice(index, 1);
  }
}

function parseYaml(content: string, file: string, warnings: string[]): unknown[] {
  try {
    const sanitized = content.replace(/\{\{[\s\S]*?\}\}/g, "ATLAS_TEMPLATE_VALUE");
    return loadAll(sanitized).filter(Boolean);
  } catch (error) {
    warnings.push(`Could not parse YAML ${file}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function addEnvironment(environment: string, file: string, addNode: AddNode) {
  addNode({ id: `environment:${environment}`, type: "environment", label: environment[0].toUpperCase() + environment.slice(1), name: environment, file, source: "config", confidence: 1, metadata: { environment } });
}

function environmentFromPath(path: string): string | null {
  const parts = path.toLowerCase().split(/[/.\-_]/);
  for (const part of parts) if (environmentAliases[part]) return environmentAliases[part];
  return null;
}

function normalizeEnvironment(value: string): string | null {
  const clean = value.trim().toLowerCase();
  if (!clean) return null;
  return environmentAliases[clean] ?? (/(prod)/.test(clean) ? "production" : /(stag|stage)/.test(clean) ? "staging" : /(dev)/.test(clean) ? "development" : clean.replace(/[^a-z0-9_-]+/g, "-"));
}

function extractSqlFragments(content: string): string[] {
  const values: string[] = [];
  for (const match of content.matchAll(/(?:query|execute)\s*\(\s*([`'"])([\s\S]*?)\1/g)) values.push(match[2]);
  for (const match of content.matchAll(/([`'"])(CREATE\s+(?:MATERIALIZED\s+VIEW|TABLE|INDEX)|ALTER\s+TABLE)[\s\S]*?\1/gi)) values.push(match[0].slice(1, -1));
  return values;
}

function splitSqlStatements(content: string): string[] {
  const out: string[] = []; let start = 0, depth = 0, quote = "";
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quote) { if (char === quote && content[index - 1] !== "\\") quote = ""; continue; }
    if (["'", '"', "`"].includes(char)) { quote = char; continue; }
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === ";" && depth === 0) { out.push(content.slice(start, index).trim()); start = index + 1; }
  }
  if (content.slice(start).trim()) out.push(content.slice(start).trim());
  return out;
}

function splitTopLevel(content: string): string[] {
  const out: string[] = []; let start = 0, depth = 0, quote = "";
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quote) { if (char === quote && content[index - 1] !== "\\") quote = ""; continue; }
    if (["'", '"', "`"].includes(char)) { quote = char; continue; }
    if (char === "(") depth += 1; else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) { out.push(content.slice(start, index)); start = index + 1; }
  }
  out.push(content.slice(start)); return out.filter((item) => item.trim());
}

function matchingParen(content: string, open: number): number {
  let depth = 0, quote = "";
  for (let index = open; index < content.length; index += 1) {
    const char = content[index];
    if (quote) { if (char === quote && content[index - 1] !== "\\") quote = ""; continue; }
    if (["'", '"', "`"].includes(char)) { quote = char; continue; }
    if (char === "(") depth += 1; else if (char === ")" && --depth === 0) return index;
  }
  return -1;
}

function clickHouseMetadata(tail: string): Record<string, unknown> {
  const capture = (pattern: RegExp) => tail.match(pattern)?.[1]?.trim();
  return {
    engine: capture(/\bENGINE\s*=\s*([^\s]+(?:\([^)]*\))?)/i),
    partitionBy: capture(/\bPARTITION\s+BY\s+([\s\S]*?)(?=\bORDER\s+BY\b|\bPRIMARY\s+KEY\b|\bTTL\b|\bSETTINGS\b|$)/i),
    orderBy: capture(/\bORDER\s+BY\s+([\s\S]*?)(?=\bPRIMARY\s+KEY\b|\bTTL\b|\bSETTINGS\b|$)/i),
    primaryKey: capture(/\bPRIMARY\s+KEY\s+([\s\S]*?)(?=\bTTL\b|\bSETTINGS\b|$)/i),
    ttl: capture(/\bTTL\s+([\s\S]*?)(?=\bSETTINGS\b|$)/i),
  };
}

function splitQualifiedName(value: string): { schema: string; table: string } {
  const parts = value.split(".").filter(Boolean);
  return { schema: parts.length > 1 ? parts.slice(0, -1).join(".") : "public", table: parts.at(-1) ?? value };
}

function tableNodeId(schema: string, table: string): string { return `table:${schema === "public" ? table : `${schema}.${table}`}`; }
function sqlName(value: string): string { return value.trim().replace(/^[`"]|[`"]$/g, "").replaceAll('"."', ".").replaceAll("`.", "."); }
function compactSql(value: string): string { return value.replace(/\s+/g, " ").trim().slice(0, 500); }
function unquote(value: string): string { return value.replace(/^(['"`])([\s\S]*)\1$/, "$2"); }
function expressionValue(value: string): string | null { const match = value.trim().match(/^['"`]([^'"`]*)['"`]$/); return match?.[1] ?? null; }
function cleanId(value: string): string { return value.trim().replace(/[^A-Za-z0-9_.:@/-]+/g, "-").replaceAll("/", ":"); }
function asDict(value: unknown): Dict | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Dict : null; }
function stringList(value: unknown): string[] { return Array.isArray(value) ? value.map(String) : typeof value === "string" ? [value] : value && typeof value === "object" ? Object.keys(value) : []; }
function environmentNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.split("=")[0]).filter(Boolean);
  return value && typeof value === "object" ? Object.keys(value) : [];
}

function ingressServices(spec: Dict): string[] {
  const names: string[] = [];
  const defaultBackend = asDict(spec.defaultBackend); const defaultService = asDict(defaultBackend?.service);
  if (typeof defaultService?.name === "string") names.push(defaultService.name);
  const rules = Array.isArray(spec.rules) ? spec.rules.map(asDict).filter(Boolean) as Dict[] : [];
  for (const rule of rules) {
    const http = asDict(rule.http); const paths = Array.isArray(http?.paths) ? http.paths.map(asDict).filter(Boolean) as Dict[] : [];
    for (const path of paths) { const service = asDict(asDict(path.backend)?.service); if (typeof service?.name === "string") names.push(service.name); }
  }
  return [...new Set(names)];
}

function configReferences(container: Dict): Array<{ name: string; secret: boolean; optional?: unknown }> {
  const refs: Array<{ name: string; secret: boolean; optional?: unknown }> = [];
  const from = Array.isArray(container.envFrom) ? container.envFrom.map(asDict).filter(Boolean) as Dict[] : [];
  for (const item of from) {
    const config = asDict(item.configMapRef); if (typeof config?.name === "string") refs.push({ name: config.name, secret: false, optional: config.optional });
    const secret = asDict(item.secretRef); if (typeof secret?.name === "string") refs.push({ name: secret.name, secret: true, optional: secret.optional });
  }
  const env = Array.isArray(container.env) ? container.env.map(asDict).filter(Boolean) as Dict[] : [];
  for (const item of env) {
    const valueFrom = asDict(item.valueFrom);
    const config = asDict(valueFrom?.configMapKeyRef); if (typeof config?.name === "string") refs.push({ name: config.name, secret: false, optional: config.optional });
    const secret = asDict(valueFrom?.secretKeyRef); if (typeof secret?.name === "string") refs.push({ name: secret.name, secret: true, optional: secret.optional });
  }
  return refs;
}

function humanSchedule(kind: string, expression: string): string {
  if (kind === "Interval") return `Every ${durationLabel(Number(expression))}`;
  if (kind === "Timeout") return `Once, ${durationLabel(Number(expression))} after startup`;
  const aliases: Record<string, string> = {
    "* * * * *": "Every minute", "0 * * * *": "Every hour", "0 0 * * *": "Every day at 00:00",
    "0 0 * * 0": "Every Sunday at 00:00", "0 0 1 * *": "On the first day of every month",
    "CronExpression.EVERY_MINUTE": "Every minute", "CronExpression.EVERY_HOUR": "Every hour",
    "CronExpression.EVERY_DAY_AT_MIDNIGHT": "Every day at midnight",
  };
  return aliases[expression] ?? `Cron: ${expression}`;
}

function durationLabel(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return "the configured interval";
  if (milliseconds % 86_400_000 === 0) return `${milliseconds / 86_400_000} day(s)`;
  if (milliseconds % 3_600_000 === 0) return `${milliseconds / 3_600_000} hour(s)`;
  if (milliseconds % 60_000 === 0) return `${milliseconds / 60_000} minute(s)`;
  if (milliseconds % 1_000 === 0) return `${milliseconds / 1_000} second(s)`;
  return `${milliseconds} ms`;
}
