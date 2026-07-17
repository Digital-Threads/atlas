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
    const addNode: AddNode = (node) => nodes.set(node.id, {
      ...nodes.get(node.id), ...node, metadata: { ...nodes.get(node.id)?.metadata, ...node.metadata },
    });
    const addEdge: AddEdge = (from, to, type, metadata) => {
      const relationshipKey = typeof metadata?.relationshipKey === "string" ? metadata.relationshipKey : "";
      edges.push({ from, to, type, label: relationshipKey ? `${type}#${relationshipKey}` : type, source: "config", confidence: 1, metadata });
    };
    const contentOf = (file: ScannedFile) => context.readFile(file);

    const packageFile = context.files.find((file) => file.path === "package.json");
    const packageText = packageFile ? await contentOf(packageFile) : "";
    const clickHouseProject = /@clickhouse\/client|clickhouse-js|clickhouse/i.test(packageText);

    await Promise.all([
      forEachConcurrent(context.files.filter((item) => item.extension === ".env"), 16, async (file) => {
        parseEnvironmentContract(file, await contentOf(file), addNode, addEdge);
      }),
      forEachConcurrent(context.files.filter((item) => item.extension === ".sql" || isMigrationFile(item)), 16, async (file) => {
        const content = await contentOf(file);
        const fragments = file.extension === ".sql" ? [content] : extractSqlFragments(content);
        parseSqlFile(file, fragments, clickHouseProject, addNode, addEdge);
      }),
      forEachConcurrent(context.files.filter((item) => [".ts", ".js"].includes(item.extension)), 16, async (file) => {
        const content = await contentOf(file);
        parseSchedules(file, content, addNode, addEdge);
        parseRepeatableJobs(file, content, addNode, addEdge);
        if (/CREATE\s+(?:MATERIALIZED\s+VIEW|TABLE)|ALTER\s+TABLE/i.test(content) && /clickhouse|MergeTree|PARTITION\s+BY/i.test(content)) {
          parseSqlFile(file, extractSqlFragments(content), true, addNode, addEdge);
        }
      }),
      forEachConcurrent(context.files.filter((item) => isWorkflowFile(item.path)), 8, async (file) => {
        parseWorkflow(file, await contentOf(file), addNode, addEdge, warnings);
      }),
      forEachConcurrent(context.files.filter((item) => item.extension.startsWith("dockerfile")), 8, async (file) => {
        parseDockerfile(file, await contentOf(file), context.projectRoot, addNode, addEdge);
      }),
      forEachConcurrent(context.files.filter((item) => [".yml", ".yaml", ".tpl"].includes(item.extension)), 8, async (file) => {
        const content = await contentOf(file);
        if (isWorkflowFile(file.path)) return;
        if (isComposeFile(file.path, content)) parseCompose(file, content, addNode, addEdge, warnings);
        if (isKubernetesFile(file.path, content)) parseKubernetes(file, content, addNode, addEdge, warnings);
      }),
    ]);

    resolveInfrastructureEdges(nodes, edges);
    return { nodes: [...nodes.values()], edges, warnings };
  }
}

async function forEachConcurrent<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  }));
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
    const clickHouseDialect = /(?:Replicated|Replacing|Summing|Aggregating|Collapsing|VersionedCollapsing)?MergeTree|ENGINE\s*=\s*Kafka|DateTime64|LowCardinality\s*\(|Nullable\s*\(|\bUInt(?:8|16|32|64|128|256)\b|\bTTL\s+/i.test(statement);
    const clickhouse = clickHouseDialect || (clickHouseProject && /clickhouse/i.test(file.path));
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
  if (isDynamicSqlName(qualified)) return;
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
    if (isDynamicSqlName(name)) continue;
    const rest = column[3];
    const columnId = `column:${qualified}.${name}`;
    addNode({ id: columnId, type: "column", label: `${qualified}.${name}`, name, file: file.path, framework: clickhouse ? "clickhouse" : "sql", source: "config", confidence: 1, metadata: {
      type: column[2], nullable: !/\bNOT\s+NULL\b/i.test(rest), primaryKey: /\bPRIMARY\s+KEY\b/i.test(rest), unique: /\bUNIQUE\b/i.test(rest),
      ...(rest.match(/\bDEFAULT\s+([^,]+)/i)?.[1] ? { default: rest.match(/\bDEFAULT\s+([^,]+)/i)![1].trim() } : {}),
    } });
    addEdge(tableId, columnId, "has_column");
    const reference = rest.match(/\bREFERENCES\s+([^\s(]+)\s*(?:\(([^)]*)\))?/i);
    if (reference) {
      const target = splitQualifiedName(sqlName(reference[1]));
      const targetId = tableNodeId(target.schema, target.table);
      addSchemaAndTable(databaseId, target.schema, target.table, targetId, file.path, clickhouse, addNode, addEdge);
      const targetColumns = sqlColumns(reference[2]);
      addEdge(tableId, targetId, "references", {
        relationshipKey: name,
        sourceColumns: [name],
        targetColumns,
        orm: "sql",
      });
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
  const reference = match[4].match(/REFERENCES\s+([^\s(]+)\s*(?:\(([^)]*)\))?/i);
  if (reference) {
    const target = splitQualifiedName(sqlName(reference[1]));
    const targetId = tableNodeId(target.schema, target.table);
    addSchemaAndTable(databaseId, target.schema, target.table, targetId, file, clickhouse, addNode, addEdge);
    addEdge(tableId, targetId, "references", {
      relationshipKey: columns.join(",") || name,
      constraint: name,
      sourceColumns: columns,
      targetColumns: sqlColumns(reference[2]),
      orm: "sql",
    });
  }
  return true;
}

function parseAlterTable(statement: string, file: ScannedFile, databaseId: string, migrationId: string | null, clickhouse: boolean, addNode: AddNode, addEdge: AddEdge) {
  const match = statement.match(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s]+)\s+([\s\S]*)/i);
  if (!match) return;
  const qualified = sqlName(match[1]);
  if (isDynamicSqlName(qualified)) return;
  const { schema, table } = splitQualifiedName(qualified);
  const tableId = tableNodeId(schema, table);
  addSchemaAndTable(databaseId, schema, table, tableId, file.path, clickhouse, addNode, addEdge);
  if (migrationId) addEdge(migrationId, tableId, /\bDROP\s+TABLE\b/i.test(statement) ? "drops" : "alters", { statement: compactSql(match[2]) });
  const foreignKey = match[2].match(/(?:ADD\s+)?(?:CONSTRAINT\s+([`"\w.-]+)\s+)?FOREIGN\s+KEY\s*\(([^)]*)\)\s+REFERENCES\s+([^\s(]+)\s*\(([^)]*)\)/i);
  const addColumn = foreignKey ? null : match[2].match(/ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([`"\w.]+)\s+([^\s,]+)/i);
  if (addColumn) {
    const name = sqlName(addColumn[1]);
    const columnId = `column:${qualified}.${name}`;
    addNode({ id: columnId, type: "column", label: `${qualified}.${name}`, name, file: file.path, framework: clickhouse ? "clickhouse" : "sql", source: "config", confidence: 0.9, metadata: { type: addColumn[2], addedByMigration: migrationId } });
    addEdge(tableId, columnId, "has_column");
    if (migrationId) addEdge(migrationId, columnId, "creates");
  }
  if (foreignKey) {
    const sourceColumns = sqlColumns(foreignKey[2]);
    const target = splitQualifiedName(sqlName(foreignKey[3]));
    const targetId = tableNodeId(target.schema, target.table);
    const targetColumns = sqlColumns(foreignKey[4]);
    addSchemaAndTable(databaseId, target.schema, target.table, targetId, file.path, clickhouse, addNode, addEdge);
    addEdge(tableId, targetId, "references", {
      relationshipKey: sourceColumns.join(",") || sqlName(foreignKey[1] ?? "foreign_key"),
      ...(foreignKey[1] ? { constraint: sqlName(foreignKey[1]) } : {}),
      sourceColumns,
      targetColumns,
      orm: "sql",
      ...(match[2].match(/ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/i)?.[1] ? { onDelete: match[2].match(/ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/i)![1].toUpperCase() } : {}),
      ...(match[2].match(/ON\s+UPDATE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/i)?.[1] ? { onUpdate: match[2].match(/ON\s+UPDATE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION)/i)![1].toUpperCase() } : {}),
    });
  }
}

function sqlColumns(value?: string): string[] {
  return (value ?? "").split(",").map((item) => sqlName(item.trim())).filter(Boolean);
}

function parseCreateIndex(statement: string, file: ScannedFile, migrationId: string | null, addNode: AddNode, addEdge: AddEdge) {
  const match = statement.match(/CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?([^\s]+)\s+ON\s+([^\s(]+)\s*\(([^)]*)\)([\s\S]*)/i);
  if (!match) return;
  const indexName = sqlName(match[2]);
  const qualified = sqlName(match[3]);
  if (isDynamicSqlName(indexName) || isDynamicSqlName(qualified)) return;
  const target = splitQualifiedName(qualified);
  const id = `index:${qualified}.${indexName}`;
  addNode({ id, type: "index", label: indexName, name: indexName, file: file.path, source: "config", confidence: 1, metadata: { unique: Boolean(match[1]), columns: splitTopLevel(match[4]).map(normalizeIndexColumn), predicate: match[5].match(/WHERE\s+([\s\S]*)/i)?.[1]?.trim() } });
  addEdge(id, tableNodeId(target.schema, target.table), "indexes");
  if (migrationId) addEdge(migrationId, id, "creates");
}

function parseMaterializedView(statement: string, file: ScannedFile, databaseId: string, migrationId: string | null, clickhouse: boolean, addNode: AddNode, addEdge: AddEdge) {
  const match = statement.match(/CREATE\s+MATERIALIZED\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)([\s\S]*)/i);
  if (!match) return;
  const name = sqlName(match[1]);
  if (isDynamicSqlName(name)) return;
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
      const steps = Array.isArray(job.steps) ? job.steps.map(asDict).filter(Boolean) as Dict[] : [];
      const actions = steps.map((step) => String(step.uses ?? "")).filter(Boolean);
      addNode({ id: jobId, type: "pipeline_job", label: jobName, name: jobName, file: file.path, framework: gitlab ? "gitlab-ci" : "github-actions", source: "config", confidence: 1, metadata: {
        stage: job.stage, runner: job["runs-on"], environment, needs: job.needs, condition: job.if,
        timeoutMinutes: job["timeout-minutes"], strategy: job.strategy, permissions: job.permissions,
        actions, serviceCount: Object.keys(asDict(job.services) ?? {}).length,
      } });
      addEdge(workflowId, jobId, "contains");
      if (environment) addEdge(jobId, `environment:${environment}`, "runs_in");
      for (const dependency of stringList(job.needs)) addEdge(jobId, `pipeline_job:${cleanId(file.path)}:${cleanId(dependency)}`, "depends_on");
      if (typeof job.uses === "string") {
        const target = workflowReference(file.path, job.uses);
        addNode({ id: target.id, type: "workflow", label: target.label, name: target.label, file: target.file, framework: "github-actions", source: "config", confidence: target.local ? 1 : 0.9, metadata: { reusable: true, reference: job.uses } });
        addEdge(jobId, target.id, "uses", { reusableWorkflow: true });
      }
      for (const action of actions) {
        const actionId = `config:action:${cleanId(action)}`;
        addNode({ id: actionId, type: "config", label: action, name: action, file: file.path, framework: "github-action", source: "config", confidence: 1, metadata: { kind: "action" } });
        addEdge(jobId, actionId, "uses");
      }
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
  const composeConfigs = asDict(doc?.configs) ?? {};
  const composeSecrets = asDict(doc?.secrets) ?? {};
  const composeNetworks = asDict(doc?.networks) ?? {};
  const composeVolumes = asDict(doc?.volumes) ?? {};
  for (const [name, value] of Object.entries(composeConfigs)) {
    const id = composeResourceId("config_map", file.path, name, environment);
    addNode({ id, type: "config_map", label: name, name, file: file.path, framework: "docker-compose", source: "config", confidence: 1, metadata: { environment, kind: "compose-config", external: asDict(value)?.external === true, valuesStored: false } });
    addEdge(id, `environment:${environment}`, "runs_in");
  }
  for (const [name, value] of Object.entries(composeSecrets)) {
    const id = composeResourceId("secret", file.path, name, environment);
    addNode({ id, type: "secret", label: name, name, file: file.path, framework: "docker-compose", source: "config", confidence: 1, metadata: { environment, kind: "compose-secret", external: asDict(value)?.external === true, valuesStored: false } });
    addEdge(id, `environment:${environment}`, "runs_in");
  }
  for (const [kind, resources] of [["network", composeNetworks], ["volume", composeVolumes]] as const) {
    for (const [name, value] of Object.entries(resources)) {
      const id = `config:compose-${kind}:${cleanId(file.path)}:${cleanId(name)}`;
      addNode({ id, type: "config", label: name, name, file: file.path, framework: "docker-compose", source: "config", confidence: 1, metadata: { environment, kind, external: asDict(value)?.external === true } });
      addEdge(id, `environment:${environment}`, "runs_in");
    }
  }
  for (const [name, rawService] of Object.entries(services)) {
    const service = asDict(rawService); if (!service) continue;
    const id = `container:${cleanId(file.path)}:${cleanId(name)}`;
    addNode({ id, type: "container", label: name, name, file: file.path, framework: "docker-compose", source: "config", confidence: 1, metadata: {
      image: service.image, build: service.build, command: service.command, ports: service.ports,
      volumes: service.volumes, environment, healthcheck: service.healthcheck, restart: service.restart,
      profiles: service.profiles, networkMode: service.network_mode,
    } });
    addEdge(`file:${file.path}`, id, "declares");
    addEdge(id, `environment:${environment}`, "runs_in");
    if (typeof service.image === "string") {
      const imageId = `container_image:${cleanId(service.image)}`;
      addNode({ id: imageId, type: "container_image", label: service.image, name: service.image, file: file.path, source: "config", confidence: 1 });
      addEdge(id, imageId, "uses");
    }
    for (const dependency of stringList(service.depends_on)) addEdge(id, `container:${cleanId(file.path)}:${cleanId(dependency)}`, "depends_on");
    for (const name of stringList(service.networks)) addEdge(id, `config:compose-network:${cleanId(file.path)}:${cleanId(name)}`, "connects_to");
    for (const item of stringList(service.volumes)) {
      const name = item.split(":")[0];
      if (name && !/^[./~]/.test(name) && Object.hasOwn(composeVolumes, name)) addEdge(id, `config:compose-volume:${cleanId(file.path)}:${cleanId(name)}`, "uses");
    }
    for (const name of composeReferenceNames(service.configs)) addEdge(id, composeResourceId("config_map", file.path, name, environment), "configures");
    for (const name of composeReferenceNames(service.secrets)) addEdge(id, composeResourceId("secret", file.path, name, environment), "configures");
    for (const envFile of stringList(service.env_file)) {
      const envId = `config:env-file:${cleanId(file.path)}:${cleanId(envFile)}`;
      addNode({ id: envId, type: "config", label: envFile, name: envFile, file: file.path, framework: "docker-compose", source: "config", confidence: 1, metadata: { environment, kind: "env-file", valuesStored: false } });
      addEdge(id, envId, "configures");
    }
    for (const name of environmentNames(service.environment)) {
      const envId = `environment_variable:${name}`;
      addNode({ id: envId, type: "environment_variable", label: name, name, file: file.path, source: "config", confidence: 1, metadata: { valueStored: false, environment } });
      addEdge(id, envId, "configures");
    }
  }
}

function parseKubernetes(file: ScannedFile, content: string, addNode: AddNode, addEdge: AddEdge, warnings: string[]) {
  const documents = parseYaml(content, file.path, warnings);
  for (const value of documents) {
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
    } else if (kind === "Kustomization") {
      parseKustomization(file, doc, environment, addNode, addEdge);
    } else if (kind === "HorizontalPodAutoscaler") {
      const spec = asDict(doc.spec) ?? {};
      const target = asDict(spec.scaleTargetRef) ?? {};
      const id = `config:kubernetes-hpa:${cleanId(name)}:${environment ?? "default"}`;
      addNode({ id, type: "config", label: name, name, file: file.path, framework: "kubernetes", source: "config", confidence: 1, metadata: { kind, environment, minReplicas: spec.minReplicas, maxReplicas: spec.maxReplicas, metrics: spec.metrics } });
      if (environment) addEdge(id, `environment:${environment}`, "runs_in");
      if (typeof target.name === "string") addEdge(id, `deployment:${cleanId(target.name)}:${environment ?? "default"}`, "configures");
    } else if (["NetworkPolicy", "PersistentVolumeClaim", "ServiceAccount"].includes(kind)) {
      const id = `config:kubernetes-${cleanId(kind)}:${cleanId(name)}:${environment ?? "default"}`;
      addNode({ id, type: "config", label: name, name, file: file.path, framework: "kubernetes", source: "config", confidence: 1, metadata: { kind, environment } });
      if (environment) addEdge(id, `environment:${environment}`, "runs_in");
    } else if (kind === "Application" && /argoproj\.io/i.test(String(doc.apiVersion ?? ""))) {
      parseArgoApplication(file, name, doc, environment, addNode, addEdge);
    }
  }
  if (!documents.some((value) => typeof asDict(value)?.kind === "string")) parseHelmMetadata(file, documents, addNode, addEdge);
}

function parseWorkload(file: ScannedFile, kind: string, name: string, doc: Dict, environment: string | null, addNode: AddNode, addEdge: AddEdge) {
  const id = `deployment:${cleanId(name)}:${environment ?? "default"}`;
  const spec = asDict(doc.spec) ?? {};
  const template = asDict(spec.template) ?? {};
  const podSpec = asDict(template.spec) ?? {};
  const containers = Array.isArray(podSpec.containers) ? podSpec.containers.map(asDict).filter(Boolean) as Dict[] : [];
  const initContainers = Array.isArray(podSpec.initContainers) ? podSpec.initContainers.map(asDict).filter(Boolean) as Dict[] : [];
  addNode({ id, type: "deployment", label: name, name, file: file.path, framework: "kubernetes", source: "config", confidence: 1, metadata: {
    kind, environment, replicas: spec.replicas, strategy: spec.strategy ?? spec.updateStrategy,
    labels: asDict(asDict(template.metadata)?.labels), containerCount: containers.length,
    initContainerCount: initContainers.length, serviceAccountName: podSpec.serviceAccountName,
    nodeSelector: podSpec.nodeSelector, affinity: podSpec.affinity, tolerations: podSpec.tolerations,
  } });
  addEdge(`file:${file.path}`, id, "declares");
  if (environment) addEdge(id, `environment:${environment}`, "runs_in");
  const volumes = kubernetesVolumes(podSpec, environment);
  const runtimeContainers: Dict[] = [...initContainers.map((item) => ({ ...item, atlasInit: true })), ...containers];
  for (const raw of runtimeContainers) {
    const containerName = String(raw.name ?? "container");
    const containerId = `container:${cleanId(name)}:${cleanId(containerName)}:${environment ?? "default"}`;
    addNode({ id: containerId, type: "container", label: containerName, name: containerName, file: file.path, framework: "kubernetes", source: "config", confidence: 1, metadata: { image: raw.image, command: raw.command, args: raw.args, ports: raw.ports, resources: raw.resources, readinessProbe: raw.readinessProbe, livenessProbe: raw.livenessProbe, startupProbe: raw.startupProbe, securityContext: raw.securityContext, volumeMounts: raw.volumeMounts, initContainer: raw.atlasInit === true, environment } });
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
    for (const mount of Array.isArray(raw.volumeMounts) ? raw.volumeMounts.map(asDict).filter(Boolean) as Dict[] : []) {
      const volume = volumes.get(String(mount.name ?? ""));
      if (volume) addEdge(containerId, volume.id, volume.secret || volume.configMap ? "configures" : "uses", { mountPath: mount.mountPath, readOnly: mount.readOnly });
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

function workflowReference(sourceFile: string, reference: string): { id: string; label: string; file: string; local: boolean } {
  const local = reference.startsWith("./");
  const file = local ? reference.replace(/^\.\//, "") : sourceFile;
  const label = local ? basename(file) : reference;
  return { id: `workflow:${cleanId(local ? file : reference)}`, label, file, local };
}

function composeResourceId(type: "config_map" | "secret", file: string, name: string, environment: string): string {
  return `${type}:compose:${cleanId(file)}:${cleanId(name)}:${environment}`;
}

function composeReferenceNames(value: unknown): string[] {
  if (!Array.isArray(value)) return stringList(value);
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    const record = asDict(item);
    return typeof record?.source === "string" ? [record.source] : [];
  });
}

function parseKustomization(file: ScannedFile, doc: Dict, environment: string | null, addNode: AddNode, addEdge: AddEdge) {
  const metadata = asDict(doc.metadata) ?? {};
  const name = String(metadata.name ?? basename(file.path));
  const id = `config:kustomization:${cleanId(file.path)}`;
  const resources = stringList(doc.resources);
  const patches = [...stringList(doc.patches), ...stringList(doc.patchesStrategicMerge)];
  const images = Array.isArray(doc.images) ? doc.images.map(asDict).filter(Boolean) as Dict[] : [];
  addNode({ id, type: "config", label: name, name, file: file.path, framework: "kustomize", source: "config", confidence: 1, metadata: { kind: "Kustomization", environment, namespace: doc.namespace, resources, patches, imageCount: images.length } });
  if (environment) addEdge(id, `environment:${environment}`, "runs_in");
  for (const image of images) {
    const value = String(image.newName ?? image.name ?? "") + (image.newTag ? `:${String(image.newTag)}` : "");
    if (!value) continue;
    const imageId = `container_image:${cleanId(value)}`;
    addNode({ id: imageId, type: "container_image", label: value, name: value, file: file.path, source: "config", confidence: 1, metadata: { environment, overriddenBy: "kustomize" } });
    addEdge(id, imageId, "uses");
  }
}

function parseArgoApplication(file: ScannedFile, name: string, doc: Dict, fallbackEnvironment: string | null, addNode: AddNode, addEdge: AddEdge) {
  const spec = asDict(doc.spec) ?? {};
  const destination = asDict(spec.destination) ?? {};
  const source = asDict(spec.source) ?? {};
  const environment = normalizeEnvironment(String(destination.namespace ?? "")) ?? fallbackEnvironment;
  if (environment) addEnvironment(environment, file.path, addNode);
  const id = `deployment:argocd:${cleanId(name)}:${environment ?? "default"}`;
  addNode({ id, type: "deployment", label: name, name, file: file.path, framework: "argocd", source: "config", confidence: 1, metadata: {
    kind: "Argo CD Application", environment, repository: source.repoURL, revision: source.targetRevision,
    path: source.path, chart: source.chart, destinationServer: destination.server, syncPolicy: spec.syncPolicy,
  } });
  if (environment) addEdge(id, `environment:${environment}`, "runs_in");
}

function parseHelmMetadata(file: ScannedFile, documents: unknown[], addNode: AddNode, addEdge: AddEdge) {
  if (!/(^|\/)(helm|charts?)(\/|$)/i.test(file.path)) return;
  const doc = asDict(documents[0]);
  if (!doc) return;
  const chart = /(^|\/)Chart\.ya?ml$/i.test(file.path);
  const values = /(^|\/)values(?:\.[^.]+)?\.ya?ml$/i.test(file.path);
  if (!chart && !values) return;
  const environment = environmentFromPath(file.path);
  if (environment) addEnvironment(environment, file.path, addNode);
  const name = chart ? String(doc.name ?? basename(file.path)) : basename(file.path);
  const id = `config:helm:${cleanId(file.path)}`;
  addNode({ id, type: "config", label: name, name, file: file.path, framework: "helm", source: "config", confidence: 1, metadata: {
    kind: chart ? "helm-chart" : "helm-values", environment, version: chart ? doc.version : undefined,
    appVersion: chart ? doc.appVersion : undefined, keys: values ? Object.keys(doc) : undefined,
    valuesStored: false,
  } });
  if (environment) addEdge(id, `environment:${environment}`, "runs_in");
}

function kubernetesVolumes(podSpec: Dict, environment: string | null): Map<string, { id: string; secret: boolean; configMap: boolean }> {
  const result = new Map<string, { id: string; secret: boolean; configMap: boolean }>();
  const volumes = Array.isArray(podSpec.volumes) ? podSpec.volumes.map(asDict).filter(Boolean) as Dict[] : [];
  for (const volume of volumes) {
    const name = String(volume.name ?? "");
    if (!name) continue;
    const secret = asDict(volume.secret);
    const configMap = asDict(volume.configMap);
    const claim = asDict(volume.persistentVolumeClaim);
    if (typeof secret?.secretName === "string") result.set(name, { id: `secret:${cleanId(secret.secretName)}:${environment ?? "default"}`, secret: true, configMap: false });
    else if (typeof configMap?.name === "string") result.set(name, { id: `config_map:${cleanId(configMap.name)}:${environment ?? "default"}`, secret: false, configMap: true });
    else if (typeof claim?.claimName === "string") result.set(name, { id: `config:kubernetes-PersistentVolumeClaim:${cleanId(claim.claimName)}:${environment ?? "default"}`, secret: false, configMap: false });
  }
  return result;
}

function extractSqlFragments(content: string): string[] {
  const constants = new Map<string, string>();
  for (const match of content.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([`'"])([^\r\n]*?)\2\s*;?/g)) {
    constants.set(match[1], match[3]);
  }
  const resolveTemplates = (value: string) => value.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (placeholder, name: string) => constants.get(name) ?? placeholder);
  const values = new Set<string>();
  for (const match of content.matchAll(/(?:query|execute)\s*\(\s*([`'"])([\s\S]*?)\1/g)) values.add(resolveTemplates(match[2]));
  for (const match of content.matchAll(/([`'"])(CREATE\s+(?:MATERIALIZED\s+VIEW|TABLE|INDEX)|ALTER\s+TABLE)[\s\S]*?\1/gi)) values.add(resolveTemplates(match[0].slice(1, -1)));
  return [...values];
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
function normalizeIndexColumn(value: string): string {
  const trimmed = value.trim();
  return /^([`"])[^'"`]+\1$/.test(trimmed) ? sqlName(trimmed) : trimmed;
}
function isDynamicSqlName(value: string): boolean { return /\$\{|[{}]/.test(value); }
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
