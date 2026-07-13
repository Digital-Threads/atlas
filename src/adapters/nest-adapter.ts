import { readFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import {
  Node,
  Project,
  SyntaxKind,
  type ClassDeclaration,
  type Decorator,
  type MethodDeclaration,
  type SourceFile,
} from "ts-morph";
import type { GraphEdge, GraphNode, GraphNodeType } from "../core/types.js";
import type { AdapterContext, AdapterResult, ArchitectureAdapter } from "./adapter.js";

const httpDecorators: Record<string, string> = {
  Get: "GET", Post: "POST", Put: "PUT", Patch: "PATCH", Delete: "DELETE",
  All: "ALL", Head: "HEAD", Options: "OPTIONS",
};
const readMethods = new Set(["findUnique", "findFirst", "findMany", "count", "aggregate"]);
const writeMethods = new Set([
  "create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany",
]);

interface ClassInfo {
  name: string;
  id: string;
  type: GraphNodeType;
  file: string;
  declaration: ClassDeclaration;
  constructorTypes: Map<string, string>;
}

export class NestAdapter implements ArchitectureAdapter {
  readonly name = "nestjs";

  async detect(context: AdapterContext): Promise<boolean> {
    return context.detectedStacks.some((stack) => stack.name === "nestjs" && stack.confidence >= 0.35);
  }

  async scan(context: AdapterContext): Promise<AdapterResult> {
    const nodes = new Map<string, GraphNode>();
    const edges: AdapterResult["edges"] = [];
    const warnings: string[] = [];
    const addNode = (node: GraphNode) => nodes.set(node.id, { ...nodes.get(node.id), ...node, metadata: { ...nodes.get(node.id)?.metadata, ...node.metadata } });
    const addEdge = (from: string, to: string, type: GraphEdge["type"], metadata?: Record<string, unknown>, source: GraphEdge["source"] = "ast", confidence = 1) => {
      edges.push({ from, to, type, label: type, source, confidence, metadata });
    };

    const tsFiles = context.files.filter((file) => file.extension === ".ts" || file.extension === ".js");
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: { allowJs: true, experimentalDecorators: true, skipLibCheck: true },
    });
    project.addSourceFilesAtPaths(tsFiles.map((file) => file.absolutePath));
    const sourceFiles = project.getSourceFiles();
    const classes = new Map<string, ClassInfo>();

    for (const sourceFile of sourceFiles) {
      const file = relativePath(context.projectRoot, sourceFile.getFilePath());
      for (const declaration of sourceFile.getClasses()) {
        const name = declaration.getName();
        if (!name) continue;
        const type = classifyClass(declaration, file);
        if (!type) continue;
        const id = `${type}:${name}`;
        const constructorTypes = getConstructorTypes(declaration);
        const info: ClassInfo = { name, id, type, file, declaration, constructorTypes };
        classes.set(name, info);
        addNode(classNode(info));
        addEdge(`file:${file}`, id, "declares");
      }
    }

    await parsePrisma(context, addNode, addEdge);

    for (const sourceFile of sourceFiles) {
      const file = relativePath(context.projectRoot, sourceFile.getFilePath());
      parseImports(sourceFile, context.projectRoot, addEdge);
      for (const declaration of sourceFile.getClasses()) {
        const name = declaration.getName();
        const info = name ? classes.get(name) : undefined;
        if (!info) continue;
        parseClass(info, classes, addNode, addEdge);
      }
      if (isTestFile(file)) parseTest(sourceFile, file, classes, addNode, addEdge);
    }

    await parseEnvironmentFiles(context, addNode, addEdge);
    await parsePackageJson(context, addNode, addEdge);

    if (!classes.size) warnings.push("NestJS was detected, but no supported decorated classes were found.");
    return { nodes: [...nodes.values()], edges, warnings };
  }
}

function classifyClass(declaration: ClassDeclaration, file: string): GraphNodeType | null {
  const name = declaration.getName() ?? "";
  const decorators = new Set(declaration.getDecorators().map((item) => item.getName()));
  if (decorators.has("Module")) return "module";
  if (decorators.has("Controller")) return "controller";
  if (decorators.has("Entity")) return "entity";
  if (name.endsWith("Dto") || file.includes(".dto.")) return "dto";
  if (name.endsWith("Guard") || file.includes(".guard.")) return "guard";
  if (name.endsWith("Pipe") || file.includes(".pipe.")) return "pipe";
  if (name.endsWith("Interceptor") || file.includes(".interceptor.")) return "interceptor";
  if (name.endsWith("Middleware") || file.includes(".middleware.")) return "middleware";
  if (decorators.has("Injectable")) {
    if (name.endsWith("Service") || file.includes(".service.")) return "service";
    if (name.endsWith("Repository") || file.includes(".repository.")) return "repository";
    return "provider";
  }
  return null;
}

function classNode(info: ClassInfo): GraphNode {
  const methods = info.declaration.getMethods().map((method) => method.getName());
  return {
    id: info.id,
    type: info.type,
    label: info.name,
    name: info.name,
    file: info.file,
    language: "typescript",
    framework: "nestjs",
    confidence: 1,
    source: "ast",
    sourceLocation: location(info.file, info.declaration),
    metadata: {
      decorators: info.declaration.getDecorators().map((item) => item.getName()),
      methods,
      sourcePreview: trimSource(info.declaration.getText()),
    },
  };
}

function parseClass(
  info: ClassInfo,
  classes: Map<string, ClassInfo>,
  addNode: (node: GraphNode) => void,
  addEdge: EdgeAdder,
) {
  parseModule(info, classes, addNode, addEdge);
  parseTypeOrm(info, addNode, addEdge);

  for (const [parameter, typeName] of info.constructorTypes) {
    const target = ensureClass(typeName, classes, info.file, addNode);
    addEdge(info.id, target.id, "injects", { via: "constructor", parameter });
  }

  for (const method of info.declaration.getMethods()) {
    const methodId = `method:${info.name}.${method.getName()}`;
    addNode(methodNode(info, method));
    addEdge(info.id, methodId, "has_method");
    parseRoute(info, method, methodId, addNode, addEdge);
    parseMethodRelations(info, method, methodId, classes, addNode, addEdge);
    parseAppliedDecorators(method.getDecorators(), methodId, classes, info.file, addNode, addEdge);
  }
  parseAppliedDecorators(info.declaration.getDecorators(), info.id, classes, info.file, addNode, addEdge);
}

function parseModule(info: ClassInfo, classes: Map<string, ClassInfo>, addNode: NodeAdder, addEdge: EdgeAdder) {
  const decorator = info.declaration.getDecorator("Module");
  if (!decorator) return;
  const argument = decorator.getArguments()[0];
  if (!argument || !Node.isObjectLiteralExpression(argument)) return;
  const mappings = [
    ["imports", "imports"], ["controllers", "contains"], ["providers", "provides"], ["exports", "exports"],
  ] as const;
  for (const [propertyName, edgeType] of mappings) {
    const property = argument.getProperty(propertyName);
    if (!property || !Node.isPropertyAssignment(property)) continue;
    const initializer = property.getInitializer();
    if (!initializer || !Node.isArrayLiteralExpression(initializer)) continue;
    for (const element of initializer.getElements()) {
      const names = element.getText().match(/[A-Z][A-Za-z0-9_$]*/g) ?? [];
      const targetName = names.at(-1);
      if (!targetName) continue;
      const target = ensureClass(targetName, classes, info.file, addNode, propertyName === "imports" ? "module" : "provider");
      addEdge(info.id, target.id, edgeType, { moduleProperty: propertyName });
    }
  }
}

function parseRoute(info: ClassInfo, method: MethodDeclaration, methodId: string, addNode: NodeAdder, addEdge: EdgeAdder) {
  if (info.type !== "controller") return;
  const controllerPath = decoratorString(info.declaration.getDecorator("Controller"));
  for (const decorator of method.getDecorators()) {
    const httpMethod = httpDecorators[decorator.getName()];
    if (!httpMethod) continue;
    const methodPath = decoratorString(decorator);
    const path = joinRoute(controllerPath, methodPath);
    const routeId = `route:${httpMethod}:${path}`;
    addNode({
      id: routeId, type: "route", label: `${httpMethod} ${path}`, name: `${httpMethod} ${path}`,
      file: info.file, framework: "nestjs", language: "typescript", confidence: 1, source: "ast",
      sourceLocation: location(info.file, method),
      metadata: { httpMethod, path, controller: info.name, handler: method.getName() },
    });
    addEdge(routeId, methodId, "handles");
  }
}

function parseMethodRelations(
  info: ClassInfo,
  method: MethodDeclaration,
  methodId: string,
  classes: Map<string, ClassInfo>,
  addNode: NodeAdder,
  addEdge: EdgeAdder,
) {
  for (const parameter of method.getParameters()) {
    const typeName = simpleType(parameter.getTypeNode()?.getText() ?? parameter.getType().getText());
    const target = classes.get(typeName);
    if (target?.type === "dto") {
      addEdge(methodId, target.id, "uses", { parameter: parameter.getName() });
      addEdge(methodId, target.id, "validates", { decorators: parameter.getDecorators().map((item) => item.getName()) });
    }
  }

  for (const call of method.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression().getText();
    const serviceCall = expression.match(/^this\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/);
    if (serviceCall) {
      const [, property, targetMethod] = serviceCall;
      const typeName = info.constructorTypes.get(property);
      if (typeName) {
        const target = ensureClass(typeName, classes, info.file, addNode);
        const targetMethodId = `method:${target.name}.${targetMethod}`;
        addNode({ id: targetMethodId, type: "method", label: `${target.name}.${targetMethod}`, name: targetMethod, file: target.file, framework: "nestjs", language: "typescript", confidence: classes.has(typeName) ? 1 : 0.75, source: classes.has(typeName) ? "ast" : "heuristic", metadata: { class: target.name, method: targetMethod } });
        addEdge(target.id, targetMethodId, "has_method");
        addEdge(methodId, targetMethodId, "calls", { via: property });
      }
    }

    const prismaCall = expression.match(/^this\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/);
    if (prismaCall) {
      const [, property, modelName, operation] = prismaCall;
      const typeName = info.constructorTypes.get(property) ?? "";
      if (/Prisma/i.test(typeName) && (readMethods.has(operation) || writeMethods.has(operation))) {
        const tableId = findTableId(modelName, addNode);
        addEdge(methodId, tableId, readMethods.has(operation) ? "reads" : "writes", { operation, via: property });
      }
    }
  }

  const text = method.getText();
  for (const envName of extractEnvNames(text)) {
    const id = `environment_variable:${envName}`;
    addNode({ id, type: "environment_variable", label: envName, name: envName, confidence: 1, source: "static_analysis", metadata: { valueStored: false } });
    addEdge(methodId, id, "uses");
  }
  for (const api of extractExternalApis(text)) {
    const id = `external_api:${api}`;
    addNode({ id, type: "external_api", label: api, name: api, confidence: 0.95, source: "static_analysis" });
    addEdge(methodId, id, "connects_to");
  }
}

function parseTypeOrm(info: ClassInfo, addNode: NodeAdder, addEdge: EdgeAdder) {
  if (info.type !== "entity") return;
  const tableName = decoratorString(info.declaration.getDecorator("Entity")) || info.name;
  const tableId = `table:${tableName}`;
  addNode({ id: tableId, type: "table", label: tableName, name: tableName, file: info.file, framework: "typeorm", confidence: 1, source: "ast" });
  addEdge(info.id, tableId, "references");
  for (const property of info.declaration.getProperties()) {
    const decorators = property.getDecorators().map((item) => item.getName());
    if (!decorators.some((name) => ["Column", "PrimaryColumn", "PrimaryGeneratedColumn"].includes(name))) continue;
    const columnId = `column:${tableName}.${property.getName()}`;
    addNode({ id: columnId, type: "column", label: `${tableName}.${property.getName()}`, name: property.getName(), file: info.file, framework: "typeorm", source: "ast", confidence: 1, metadata: { type: property.getTypeNode()?.getText(), decorators } });
    addEdge(tableId, columnId, "has_column");
  }
}

async function parsePrisma(context: AdapterContext, addNode: NodeAdder, addEdge: EdgeAdder) {
  const schema = context.files.find((file) => file.path.endsWith("schema.prisma"));
  if (!schema) return;
  const content = await readFile(schema.absolutePath, "utf8").catch(() => "");
  if (!content) return;
  addNode({ id: "database:prisma", type: "database", label: "Prisma", name: "Prisma", file: schema.path, framework: "prisma", source: "config", confidence: 1 });
  for (const match of content.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\}/g)) {
    const [, modelName, body] = match;
    const modelId = `model:${modelName}`;
    const tableId = `table:${modelName}`;
    addNode({ id: modelId, type: "model", label: modelName, name: modelName, file: schema.path, framework: "prisma", source: "config", confidence: 1 });
    addNode({ id: tableId, type: "table", label: modelName, name: modelName, file: schema.path, framework: "prisma", source: "config", confidence: 1 });
    addEdge("database:prisma", modelId, "contains");
    addEdge(modelId, tableId, "references");
    for (const line of body.split(/\r?\n/)) {
      const field = line.trim().match(/^(\w+)\s+([\w\[\]?]+)/);
      if (!field) continue;
      const [, fieldName, fieldType] = field;
      const columnId = `column:${modelName}.${fieldName}`;
      addNode({ id: columnId, type: "column", label: `${modelName}.${fieldName}`, name: fieldName, file: schema.path, framework: "prisma", source: "config", confidence: 1, metadata: { type: fieldType } });
      addEdge(tableId, columnId, "has_column");
    }
  }
}

function parseImports(sourceFile: SourceFile, projectRoot: string, addEdge: EdgeAdder) {
  const from = `file:${relativePath(projectRoot, sourceFile.getFilePath())}`;
  for (const declaration of sourceFile.getImportDeclarations()) {
    const target = declaration.getModuleSpecifierSourceFile();
    if (!target || !target.getFilePath().startsWith(resolve(projectRoot))) continue;
    addEdge(from, `file:${relativePath(projectRoot, target.getFilePath())}`, "imports", { specifier: declaration.getModuleSpecifierValue() });
  }
}

function parseTest(sourceFile: SourceFile, file: string, classes: Map<string, ClassInfo>, addNode: NodeAdder, addEdge: EdgeAdder) {
  const id = `test:${file}`;
  addNode({ id, type: "test", label: basename(file), name: basename(file), file, language: "typescript", source: "static_analysis", confidence: 1 });
  addEdge(`file:${file}`, id, "declares");
  for (const declaration of sourceFile.getImportDeclarations()) {
    for (const namedImport of declaration.getNamedImports()) {
      const target = classes.get(namedImport.getName());
      if (target) addEdge(id, target.id, "tests");
    }
  }
}

async function parseEnvironmentFiles(context: AdapterContext, addNode: NodeAdder, addEdge: EdgeAdder) {
  for (const file of context.files.filter((item) => item.extension === ".env")) {
    const content = await readFile(file.absolutePath, "utf8").catch(() => "");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (!match) continue;
      const id = `environment_variable:${match[1]}`;
      addNode({ id, type: "environment_variable", label: match[1], name: match[1], file: file.path, source: "config", confidence: 1, metadata: { valueStored: false } });
      addEdge(`file:${file.path}`, id, "declares", { valueStored: false }, "config");
    }
  }
}

async function parsePackageJson(context: AdapterContext, addNode: NodeAdder, addEdge: EdgeAdder) {
  const packageFile = context.files.find((file) => file.path === "package.json");
  if (!packageFile) return;
  try {
    const packageJson = JSON.parse(await readFile(packageFile.absolutePath, "utf8"));
    const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
    for (const [name, version] of Object.entries(dependencies)) {
      const id = `library:${name}`;
      addNode({ id, type: "library", label: name, name, file: "package.json", source: "package_json", confidence: 1, metadata: { version, devDependency: Boolean(packageJson.devDependencies?.[name]) } });
      addEdge("project:root", id, "depends_on", undefined, "package_json");
    }
  } catch {
    return;
  }
}

function parseAppliedDecorators(decorators: Decorator[], ownerId: string, classes: Map<string, ClassInfo>, file: string, addNode: NodeAdder, addEdge: EdgeAdder) {
  for (const decorator of decorators) {
    if (!(["UseGuards", "UsePipes", "UseInterceptors"] as string[]).includes(decorator.getName())) continue;
    const targetType: GraphNodeType = decorator.getName() === "UseGuards" ? "guard" : decorator.getName() === "UsePipes" ? "pipe" : "interceptor";
    for (const argument of decorator.getArguments()) {
      const targetName = argument.getText().match(/[A-Z][A-Za-z0-9_$]*/)?.[0];
      if (!targetName) continue;
      const target = ensureClass(targetName, classes, file, addNode, targetType);
      addEdge(ownerId, target.id, "decorates", { decorator: decorator.getName() });
    }
  }
}

function methodNode(info: ClassInfo, method: MethodDeclaration): GraphNode {
  const methodName = method.getName();
  return {
    id: `method:${info.name}.${methodName}`, type: "method", label: `${info.name}.${methodName}`, name: methodName,
    file: info.file, language: "typescript", framework: "nestjs", source: "ast", confidence: 1,
    sourceLocation: location(info.file, method),
    metadata: {
      class: info.name,
      method: methodName,
      parameters: method.getParameters().map((parameter) => ({ name: parameter.getName(), type: parameter.getTypeNode()?.getText() ?? "unknown" })),
      returnType: method.getReturnTypeNode()?.getText() ?? method.getReturnType().getText(method),
      sourcePreview: trimSource(method.getText()),
    },
  };
}

function getConstructorTypes(declaration: ClassDeclaration): Map<string, string> {
  const result = new Map<string, string>();
  for (const constructor of declaration.getConstructors()) {
    for (const parameter of constructor.getParameters()) {
      result.set(parameter.getName(), simpleType(parameter.getTypeNode()?.getText() ?? parameter.getType().getText()));
    }
  }
  return result;
}

function ensureClass(name: string, classes: Map<string, ClassInfo>, file: string, addNode: NodeAdder, fallbackType: GraphNodeType = "provider") {
  const existing = classes.get(name);
  if (existing) return existing;
  const type = inferType(name, fallbackType);
  const inferred = { name, id: `${type}:${name}`, type, file, declaration: undefined as unknown as ClassDeclaration, constructorTypes: new Map<string, string>() };
  addNode({ id: inferred.id, type, label: name, name, file, framework: "nestjs", language: "typescript", confidence: 0.7, source: "heuristic" });
  return inferred;
}

function inferType(name: string, fallback: GraphNodeType): GraphNodeType {
  if (name.endsWith("Service")) return "service";
  if (name.endsWith("Controller")) return "controller";
  if (name.endsWith("Module")) return "module";
  if (name.endsWith("Dto")) return "dto";
  if (name.endsWith("Guard")) return "guard";
  if (name.endsWith("Pipe")) return "pipe";
  if (name.endsWith("Interceptor")) return "interceptor";
  if (name.endsWith("Repository")) return "repository";
  return fallback;
}

function extractEnvNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(match[1]);
  for (const match of text.matchAll(/(?:configService|this\.configService)\.get(?:<[^>]+>)?\s*\(\s*["'`]([A-Z][A-Z0-9_]*)["'`]/g)) names.add(match[1]);
  return names;
}

function extractExternalApis(text: string): Set<string> {
  const names = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s"'`)]+/g)) {
    try { names.add(new URL(match[0]).host); } catch { /* malformed literal */ }
  }
  return names;
}

function findTableId(modelName: string, addNode: NodeAdder): string {
  const name = modelName.charAt(0).toUpperCase() + modelName.slice(1);
  const id = `table:${name}`;
  addNode({ id, type: "table", label: name, name, framework: "prisma", source: "heuristic", confidence: 0.9 });
  return id;
}

function decoratorString(decorator?: Decorator): string {
  const argument = decorator?.getArguments()[0];
  if (!argument) return "";
  return argument.getText().replace(/^['"`]|['"`]$/g, "");
}

function joinRoute(prefix: string, path: string): string {
  const joined = `/${prefix}/${path}`.replace(/\/+/g, "/");
  return joined.length > 1 && joined.endsWith("/") ? joined.slice(0, -1) : joined;
}

function simpleType(value: string): string {
  return value.replace(/^typeof\s+/, "").split(/[<|&\[\].]/)[0].trim().split(".").at(-1) ?? value;
}

function location(file: string, node: Node) {
  return { file, startLine: node.getStartLineNumber(), endLine: node.getEndLineNumber() };
}

function relativePath(root: string, file: string): string {
  return relative(resolve(root), resolve(file)).replaceAll("\\", "/");
}

function trimSource(source: string): string {
  return source.length > 4000 ? `${source.slice(0, 4000)}\n...` : source;
}

function isTestFile(file: string): boolean {
  return /\.(spec|test)\.[jt]s$/.test(file);
}

type NodeAdder = (node: GraphNode) => void;
type EdgeAdder = (
  from: string,
  to: string,
  type: GraphEdge["type"],
  metadata?: Record<string, unknown>,
  source?: GraphEdge["source"],
  confidence?: number,
) => void;
