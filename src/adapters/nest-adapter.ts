import { readFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import {
  Node,
  Project,
  SyntaxKind,
  type ClassDeclaration,
  type Decorator,
  type FunctionDeclaration,
  type MethodDeclaration,
  type SourceFile,
} from "ts-morph";
import type { GraphEdge, GraphNode, GraphNodeType } from "../core/types.js";
import type { AdapterContext, AdapterDetectionResult, AdapterResult, ArchitectureAdapter } from "./adapter.js";

const httpDecorators: Record<string, string> = {
  Get: "GET", Post: "POST", Put: "PUT", Patch: "PATCH", Delete: "DELETE",
  All: "ALL", Head: "HEAD", Options: "OPTIONS",
};
const readMethods = new Set(["findUnique", "findFirst", "findMany", "count", "aggregate"]);
const writeMethods = new Set([
  "create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany",
]);
const typeOrmReadMethods = new Set(["find", "findBy", "findOne", "findOneBy", "findAndCount", "count", "countBy", "exist", "exists"]);
const typeOrmWriteMethods = new Set(["save", "insert", "update", "upsert", "delete", "remove", "softDelete", "softRemove", "recover", "restore", "clear"]);

interface ClassInfo {
  name: string;
  id: string;
  type: GraphNodeType;
  file: string;
  declaration: ClassDeclaration;
  constructorTypes: Map<string, string>;
  repositoryEntities: Map<string, string>;
}

export class NestAdapter implements ArchitectureAdapter {
  readonly name = "nestjs";

  async detect(context: AdapterContext): Promise<AdapterDetectionResult> {
    const stack = context.detectedStacks.find((item) => item.name === "nestjs");
    return { detected: Boolean(stack && stack.confidence >= 0.35), confidence: stack?.confidence ?? 0, evidence: stack?.evidence ?? [] };
  }

  async buildNodes(result: AdapterResult): Promise<GraphNode[]> { return result.nodes; }
  async buildEdges(result: AdapterResult): Promise<AdapterResult["edges"]> { return result.edges; }

  async scan(context: AdapterContext): Promise<AdapterResult> {
    const nodes = new Map<string, GraphNode>();
    const edges: AdapterResult["edges"] = [];
    const warnings: string[] = [];
    const addNode = (node: GraphNode) => nodes.set(node.id, { ...nodes.get(node.id), ...node, metadata: { ...nodes.get(node.id)?.metadata, ...node.metadata } });
    const addEdge = (from: string, to: string, type: GraphEdge["type"], metadata?: Record<string, unknown>, source: GraphEdge["source"] = "ast", confidence = 1) => {
      edges.push({ from, to, type, label: type, source, confidence, metadata });
    };

    const tsFiles = context.files.filter((file) => file.extension === ".ts" || file.extension === ".js");
    const tsConfig = context.files.find((file) => file.path === "tsconfig.json");
    const project = new Project(tsConfig ? {
      tsConfigFilePath: tsConfig.absolutePath,
      skipAddingFilesFromTsConfig: true,
    } : {
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
        const { constructorTypes, repositoryEntities } = getConstructorInfo(declaration);
        const info: ClassInfo = { name, id, type, file, declaration, constructorTypes, repositoryEntities };
        classes.set(name, info);
        addNode(classNode(info));
        addEdge(`file:${file}`, id, "declares");
      }
    }

    await parsePrisma(context, addNode, addEdge);

    const globalPrefix = findGlobalPrefix(sourceFiles);
    for (const sourceFile of sourceFiles) {
      const file = relativePath(context.projectRoot, sourceFile.getFilePath());
      parseImports(sourceFile, context.projectRoot, addNode, addEdge);
      parseFunctions(sourceFile, file, addNode, addEdge);
      parseBootstrapGlobals(sourceFile, file, classes, addNode, addEdge);
      for (const declaration of sourceFile.getClasses()) {
        const name = declaration.getName();
        const info = name ? classes.get(name) : undefined;
        if (!info) continue;
        parseClass(info, classes, addNode, addEdge, globalPrefix);
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
      ...(info.type === "dto" ? { fields: dtoFields(info.declaration) } : {}),
      sourcePreview: trimSource(info.declaration.getText()),
    },
  };
}

function parseClass(
  info: ClassInfo,
  classes: Map<string, ClassInfo>,
  addNode: (node: GraphNode) => void,
  addEdge: EdgeAdder,
  globalPrefix: string,
) {
  parseModule(info, classes, addNode, addEdge);
  parseTypeOrm(info, classes, addNode, addEdge);

  for (const [parameter, typeName] of info.constructorTypes) {
    const target = ensureClass(typeName, classes, info.file, addNode);
    addEdge(info.id, target.id, "injects", { via: "constructor", parameter, repositoryEntity: info.repositoryEntities.get(parameter) });
  }

  for (const method of info.declaration.getMethods()) {
    const methodId = `method:${info.name}.${method.getName()}`;
    addNode(methodNode(info, method));
    addEdge(info.id, methodId, "has_method");
    parseRoute(info, method, methodId, globalPrefix, addNode, addEdge);
    parseMethodRelations(info, method, methodId, classes, addNode, addEdge);
    parseAppliedDecorators(method.getDecorators(), methodId, classes, info.file, addNode, addEdge);
  }
  parseMiddlewareConfiguration(info, classes, addNode, addEdge);
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
      if (Node.isObjectLiteralExpression(element)) {
        const provide = element.getProperty("provide");
        if (!provide || !Node.isPropertyAssignment(provide)) continue;
        const token = cleanToken(provide.getInitializer()?.getText() ?? "provider");
        const providerId = `provider:${token}`;
        addNode({ id: providerId, type: "provider", label: token, name: token, file: info.file, framework: "nestjs", source: "config", confidence: 1, metadata: { moduleProvider: element.getText() } });
        addEdge(info.id, providerId, edgeType, { moduleProperty: propertyName, customProvider: true });
        for (const key of ["useClass", "useExisting"]) {
          const implementation = element.getProperty(key);
          if (!implementation || !Node.isPropertyAssignment(implementation)) continue;
          const targetName = implementation.getInitializer()?.getText().match(/[A-Z][A-Za-z0-9_$]*/)?.[0];
          if (!targetName) continue;
          const target = ensureClass(targetName, classes, info.file, addNode);
          addEdge(providerId, target.id, "references", { providerStrategy: key });
        }
        continue;
      }
      const names = element.getText().match(/[A-Z][A-Za-z0-9_$]*/g) ?? [];
      const targetName = propertyName === "imports" ? (names.find((name) => name.endsWith("Module")) ?? names.at(-1)) : names.at(-1);
      if (!targetName) continue;
      const target = ensureClass(targetName, classes, info.file, addNode, propertyName === "imports" ? "module" : "provider");
      addEdge(info.id, target.id, edgeType, { moduleProperty: propertyName });
    }
  }
}

function parseRoute(info: ClassInfo, method: MethodDeclaration, methodId: string, globalPrefix: string, addNode: NodeAdder, addEdge: EdgeAdder) {
  if (info.type !== "controller") return;
  const controllerPath = decoratorString(info.declaration.getDecorator("Controller"));
  for (const decorator of method.getDecorators()) {
    const httpMethod = httpDecorators[decorator.getName()];
    if (!httpMethod) continue;
    const methodPath = decoratorString(decorator);
    const path = joinRoute(globalPrefix, controllerPath, methodPath);
    const routeId = `route:${httpMethod}:${path}`;
    addNode({
      id: routeId, type: "route", label: `${httpMethod} ${path}`, name: `${httpMethod} ${path}`,
      file: info.file, framework: "nestjs", language: "typescript", confidence: 1, source: "ast",
      sourceLocation: location(info.file, method),
      metadata: { method: httpMethod, httpMethod, path, controller: info.name, handler: method.getName() },
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
      addEdge(methodId, target.id, "validates", {
        decorators: parameter.getDecorators().map((item) => item.getName()),
        fields: dtoFields(target.declaration),
      });
    }
  }

  const explicitReturnType = method.getReturnTypeNode()?.getText() ?? "";
  for (const returnType of referencedTypeNames(explicitReturnType)) {
    const target = classes.get(returnType);
    if (target) addEdge(methodId, target.id, "returns");
  }

  for (const call of method.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression().getText();
    const localCall = expression.match(/^this\.([A-Za-z_$][\w$]*)$/);
    if (localCall) {
      const targetMethod = info.declaration.getMethod(localCall[1]);
      if (targetMethod) {
        const targetMethodId = `method:${info.name}.${targetMethod.getName()}`;
        addNode(methodNode(info, targetMethod));
        addEdge(info.id, targetMethodId, "has_method");
        addEdge(methodId, targetMethodId, "calls", { via: "this" });
      }
    }

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
        const entityName = info.repositoryEntities.get(property);
        if (entityName && (typeOrmReadMethods.has(targetMethod) || typeOrmWriteMethods.has(targetMethod))) {
          const { id: tableId, name: tableName } = tableForEntity(entityName, classes);
          addNode({ id: tableId, type: "table", label: tableName, name: tableName, framework: "typeorm", source: "heuristic", confidence: 0.9 });
          addEdge(targetMethodId, tableId, typeOrmReadMethods.has(targetMethod) ? "reads" : "writes", { operation: targetMethod, via: property, orm: "typeorm" });
        }
      }
    }

    const prismaCall = expression.match(/^this\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/);
    if (prismaCall) {
      const [, property, modelName, operation] = prismaCall;
      const typeName = info.constructorTypes.get(property) ?? "";
      if (/Prisma/i.test(typeName) && (readMethods.has(operation) || writeMethods.has(operation))) {
        const tableId = findTableId(modelName, addNode);
        const operationId = `method:${typeName}.${modelName}.${operation}`;
        addNode({ id: operationId, type: "method", label: `${typeName}.${modelName}.${operation}`, name: operation, file: info.file, framework: "prisma", source: "ast", confidence: 1, metadata: { class: typeName, model: modelName, method: operation, databaseOperation: true } });
        const prismaService = ensureClass(typeName, classes, info.file, addNode, "service");
        addEdge(prismaService.id, operationId, "has_method", { generatedFromUsage: true });
        addEdge(methodId, operationId, "calls", { via: property, orm: "prisma" });
        addEdge(operationId, tableId, readMethods.has(operation) ? "reads" : "writes", { operation, via: property, orm: "prisma" });
      }
    }

    if (isExternalHttpCall(expression, info)) {
      const argumentsText = call.getArguments().map((argument) => argument.getText()).join(" ");
      for (const api of extractExternalApis(argumentsText)) {
        const id = `external_api:${api}`;
        addNode({ id, type: "external_api", label: api, name: api, confidence: 0.98, source: "static_analysis", metadata: { client: expression } });
        addEdge(methodId, id, "connects_to", { client: expression });
      }
      for (const envName of extractEnvNames(argumentsText)) {
        const envId = `environment_variable:${envName}`;
        const externalId = `external_api:unknown:${envName}`;
        addNode({ id: envId, type: "environment_variable", label: envName, name: envName, source: "static_analysis", confidence: 1, metadata: { valueStored: false } });
        addNode({ id: externalId, type: "external_api", label: `Unknown API (${envName})`, name: envName, source: "heuristic", confidence: 0.7, metadata: { hostUnknown: true, configuredBy: envName, client: expression } });
        addEdge(envId, externalId, "connects_to", { hostUnknown: true });
        addEdge(methodId, externalId, "connects_to", { client: expression, configuredBy: envName }, "heuristic", 0.7);
      }
    }
  }

  const text = method.getText();
  for (const envName of extractEnvNames(text)) {
    const id = `environment_variable:${envName}`;
    addNode({ id, type: "environment_variable", label: envName, name: envName, confidence: 1, source: "static_analysis", metadata: { valueStored: false } });
    addEdge(methodId, id, "uses");
  }
}

function parseTypeOrm(info: ClassInfo, classes: Map<string, ClassInfo>, addNode: NodeAdder, addEdge: EdgeAdder) {
  if (info.type !== "entity") return;
  const tableName = decoratorString(info.declaration.getDecorator("Entity")) || info.name;
  const tableId = `table:${tableName}`;
  addNode({ id: "database:typeorm", type: "database", label: "TypeORM", name: "TypeORM", framework: "typeorm", source: "config", confidence: 1 });
  addNode({ id: tableId, type: "table", label: tableName, name: tableName, file: info.file, framework: "typeorm", confidence: 1, source: "ast" });
  addEdge("database:typeorm", tableId, "contains");
  addEdge(info.id, tableId, "references");
  for (const property of info.declaration.getProperties()) {
    const decorators = property.getDecorators().map((item) => item.getName());
    if (decorators.some((name) => ["Column", "PrimaryColumn", "PrimaryGeneratedColumn"].includes(name))) {
      const columnId = `column:${tableName}.${property.getName()}`;
      addNode({ id: columnId, type: "column", label: `${tableName}.${property.getName()}`, name: property.getName(), file: info.file, framework: "typeorm", source: "ast", confidence: 1, metadata: { type: property.getTypeNode()?.getText(), decorators } });
      addEdge(tableId, columnId, "has_column");
    }
    const relation = decorators.find((name) => ["ManyToOne", "OneToMany", "OneToOne", "ManyToMany"].includes(name));
    if (relation) {
      const targetName = referencedTypeNames(property.getTypeNode()?.getText() ?? "").find((name) => name !== info.name);
      if (!targetName) continue;
      const { id: targetTableId, name: targetTableName } = tableForEntity(targetName, classes);
      addNode({ id: targetTableId, type: "table", label: targetTableName, name: targetTableName, framework: "typeorm", source: "heuristic", confidence: 0.85 });
      addEdge(tableId, targetTableId, "references", { relation, property: property.getName(), orm: "typeorm" }, "ast", 1);
    }
  }
}

async function parsePrisma(context: AdapterContext, addNode: NodeAdder, addEdge: EdgeAdder) {
  const schema = context.files.find((file) => file.path.endsWith("schema.prisma"));
  if (!schema) return;
  const content = await readFile(schema.absolutePath, "utf8").catch(() => "");
  if (!content) return;
  addNode({ id: "database:prisma", type: "database", label: "Prisma", name: "Prisma", file: schema.path, framework: "prisma", source: "config", confidence: 1 });
  const models = [...content.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\}/g)].map((match) => ({ name: match[1], body: match[2] }));
  const modelNames = new Set(models.map((model) => model.name));
  for (const { name: modelName, body } of models) {
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
      const relatedModel = fieldType.replace(/[\[\]?]/g, "");
      if (modelNames.has(relatedModel)) {
        addEdge(tableId, `table:${relatedModel}`, "references", { relation: fieldType.includes("[]") ? "has_many" : "belongs_to", field: fieldName, orm: "prisma" }, "config", 1);
        continue;
      }
      const columnId = `column:${modelName}.${fieldName}`;
      addNode({ id: columnId, type: "column", label: `${modelName}.${fieldName}`, name: fieldName, file: schema.path, framework: "prisma", source: "config", confidence: 1, metadata: { type: fieldType } });
      addEdge(tableId, columnId, "has_column");
    }
  }
}

function parseImports(sourceFile: SourceFile, projectRoot: string, addNode: NodeAdder, addEdge: EdgeAdder) {
  const from = `file:${relativePath(projectRoot, sourceFile.getFilePath())}`;
  for (const declaration of sourceFile.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    const target = declaration.getModuleSpecifierSourceFile();
    if (target?.getFilePath().startsWith(resolve(projectRoot))) {
      addEdge(from, `file:${relativePath(projectRoot, target.getFilePath())}`, "imports", { specifier });
      continue;
    }
    const packageName = importedPackageName(specifier);
    if (!packageName) continue;
    const id = `library:${packageName}`;
    addNode({ id, type: "library", label: packageName, name: packageName, source: "ast", confidence: 1, metadata: { imported: true } });
    addEdge(from, id, "imports", { specifier });
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
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
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
    const packageNodeId = "package:root";
    addNode({
      id: packageNodeId,
      type: "package",
      label: String(packageJson.name ?? "package.json"),
      name: String(packageJson.name ?? "package.json"),
      file: "package.json",
      source: "package_json",
      confidence: 1,
      metadata: { version: packageJson.version, scripts: packageJson.scripts ?? {}, packageManager: packageJson.packageManager },
    });
    addEdge("file:package.json", packageNodeId, "declares", undefined, "package_json");
    addEdge("project:root", packageNodeId, "contains", undefined, "package_json");
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

function getConstructorInfo(declaration: ClassDeclaration): Pick<ClassInfo, "constructorTypes" | "repositoryEntities"> {
  const constructorTypes = new Map<string, string>();
  const repositoryEntities = new Map<string, string>();
  for (const constructor of declaration.getConstructors()) {
    for (const parameter of constructor.getParameters()) {
      const repositoryDecorator = parameter.getDecorator("InjectRepository");
      const repositoryEntity = repositoryDecorator?.getArguments()[0]?.getText().match(/[A-Z][A-Za-z0-9_$]*/)?.[0];
      if (repositoryEntity) {
        const repositoryName = `${repositoryEntity}Repository`;
        constructorTypes.set(parameter.getName(), repositoryName);
        repositoryEntities.set(parameter.getName(), repositoryEntity);
        continue;
      }
      const injectDecorator = parameter.getDecorator("Inject");
      const token = injectDecorator?.getArguments()[0]?.getText().replace(/^['"`]|['"`]$/g, "");
      constructorTypes.set(parameter.getName(), token || simpleType(parameter.getTypeNode()?.getText() ?? parameter.getType().getText()));
    }
  }
  return { constructorTypes, repositoryEntities };
}

function ensureClass(name: string, classes: Map<string, ClassInfo>, file: string, addNode: NodeAdder, fallbackType: GraphNodeType = "provider") {
  const existing = classes.get(name);
  if (existing) return existing;
  const type = inferType(name, fallbackType);
  const inferred = { name, id: `${type}:${name}`, type, file, declaration: undefined as unknown as ClassDeclaration, constructorTypes: new Map<string, string>(), repositoryEntities: new Map<string, string>() };
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
  for (const match of text.matchAll(/process\.env\s*\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g)) names.add(match[1]);
  for (const match of text.matchAll(/(?:configService|this\.configService)\.get(?:<[^>]+>)?\s*\(\s*["'`]([A-Z][A-Z0-9_]*)["'`]/g)) names.add(match[1]);
  for (const match of text.matchAll(/\{([^}]+)\}\s*=\s*process\.env/g)) {
    for (const item of match[1].split(",")) {
      const name = item.trim().match(/^([A-Z][A-Z0-9_]*)/)?.[1];
      if (name) names.add(name);
    }
  }
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

function joinRoute(...parts: string[]): string {
  const joined = `/${parts.join("/")}`.replace(/\/+/g, "/");
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

function dtoFields(declaration: ClassDeclaration) {
  return declaration.getProperties().map((property) => ({
    name: property.getName(),
    type: property.getTypeNode()?.getText() ?? property.getType().getText(property),
    optional: property.hasQuestionToken(),
    validators: property.getDecorators().map((decorator) => decorator.getName()),
  }));
}

function parseFunctions(sourceFile: SourceFile, file: string, addNode: NodeAdder, addEdge: EdgeAdder) {
  for (const declaration of sourceFile.getFunctions()) {
    const name = declaration.getName();
    if (!name) continue;
    const id = `function:${file}:${name}`;
    addNode(functionNode(declaration, id, file));
    addEdge(`file:${file}`, id, "declares");
    if (isCustomDecorator(declaration.getText())) addDecoratorNode(name, file, declaration, addNode, addEdge);
  }
  for (const declaration of sourceFile.getVariableDeclarations()) {
    const name = declaration.getName();
    if (!isCustomDecorator(declaration.getInitializer()?.getText() ?? "")) continue;
    addDecoratorNode(name, file, declaration, addNode, addEdge);
  }
}

function isCustomDecorator(text: string): boolean {
  return /\b(?:createParamDecorator|SetMetadata|applyDecorators)\s*\(/.test(text);
}

function addDecoratorNode(name: string, file: string, declaration: Node, addNode: NodeAdder, addEdge: EdgeAdder) {
  const id = `decorator:${name}`;
  addNode({
    id, type: "decorator", label: name, name, file, language: "typescript", framework: "nestjs",
    source: "ast", confidence: 1, sourceLocation: location(file, declaration),
    metadata: { sourcePreview: trimSource(declaration.getText()) },
  });
  addEdge(`file:${file}`, id, "declares");
}

function functionNode(declaration: FunctionDeclaration, id: string, file: string): GraphNode {
  return {
    id, type: "function", label: declaration.getName() ?? "anonymous", name: declaration.getName(), file,
    language: "typescript", source: "ast", confidence: 1, sourceLocation: location(file, declaration),
    metadata: {
      parameters: declaration.getParameters().map((parameter) => ({ name: parameter.getName(), type: parameter.getTypeNode()?.getText() ?? "unknown" })),
      returnType: declaration.getReturnTypeNode()?.getText() ?? declaration.getReturnType().getText(declaration),
      sourcePreview: trimSource(declaration.getText()),
    },
  };
}

function findGlobalPrefix(sourceFiles: SourceFile[]): string {
  for (const sourceFile of sourceFiles) {
    for (const match of sourceFile.getText().matchAll(/\.setGlobalPrefix\(\s*['"`]([^'"`]+)['"`]/g)) return match[1];
  }
  return "";
}

function parseBootstrapGlobals(sourceFile: SourceFile, file: string, classes: Map<string, ClassInfo>, addNode: NodeAdder, addEdge: EdgeAdder) {
  const globals = new Map<string, GraphNodeType>([
    ["useGlobalGuards", "guard"], ["useGlobalPipes", "pipe"],
    ["useGlobalInterceptors", "interceptor"], ["use", "middleware"],
  ]);
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const method = call.getExpression().getText().split(".").at(-1) ?? "";
    const type = globals.get(method);
    if (!type) continue;
    for (const argument of call.getArguments()) {
      const name = argument.getText().match(/[A-Z][A-Za-z0-9_$]*/)?.[0];
      if (!name) continue;
      const target = ensureClass(name, classes, file, addNode, type);
      addEdge("project:root", target.id, "decorates", { global: true, bootstrapMethod: method });
    }
  }
}

function parseMiddlewareConfiguration(info: ClassInfo, classes: Map<string, ClassInfo>, addNode: NodeAdder, addEdge: EdgeAdder) {
  if (info.type !== "module") return;
  for (const method of info.declaration.getMethods()) {
    for (const call of method.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (!call.getExpression().getText().endsWith(".apply")) continue;
      for (const argument of call.getArguments()) {
        const name = argument.getText().match(/[A-Z][A-Za-z0-9_$]*/)?.[0];
        if (!name) continue;
        const target = ensureClass(name, classes, info.file, addNode, "middleware");
        addEdge(info.id, target.id, "uses", { via: "MiddlewareConsumer.apply" });
      }
    }
  }
}

function importedPackageName(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function cleanToken(value: string): string {
  const unquoted = value.replace(/^['"`]|['"`]$/g, "");
  return unquoted.replace(/[^A-Za-z0-9_.$:@/-]+/g, "_").replace(/^_+|_+$/g, "") || "provider";
}

function referencedTypeNames(value: string): string[] {
  const ignored = new Set(["Promise", "Array", "Record", "Partial", "Readonly", "Observable", "String", "Number", "Boolean", "Date"]);
  return [...new Set(value.match(/[A-Z][A-Za-z0-9_$]*/g) ?? [])].filter((name) => !ignored.has(name));
}

function isExternalHttpCall(expression: string, info: ClassInfo): boolean {
  if (/^(fetch|axios(?:\.[A-Za-z_$][\w$]*)?|got(?:\.[A-Za-z_$][\w$]*)?|request(?:\.[A-Za-z_$][\w$]*)?)$/.test(expression)) return true;
  const member = expression.match(/^this\.([A-Za-z_$][\w$]*)\.(get|post|put|patch|delete|request|head|options)$/i);
  if (!member) return false;
  const dependencyType = info.constructorTypes.get(member[1]) ?? "";
  return /HttpService|HttpClient|Axios|Got|Request/i.test(dependencyType) || /(http|api|client)/i.test(member[1]);
}

function tableForEntity(entityName: string, classes: Map<string, ClassInfo>): { id: string; name: string } {
  const entity = classes.get(entityName);
  const tableName = entity?.type === "entity" ? (decoratorString(entity.declaration.getDecorator("Entity")) || entityName) : entityName;
  return { id: `table:${tableName}`, name: tableName };
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
