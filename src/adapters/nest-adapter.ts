import { readFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import {
  Node,
  Project,
  SyntaxKind,
  type ClassDeclaration,
  type CallExpression,
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
const sequelizeReadMethods = new Set([
  "findAll", "findOne", "findByPk", "findAndCountAll", "count", "sum", "max", "min", "aggregate",
]);
const sequelizeWriteMethods = new Set([
  "create", "bulkCreate", "findOrCreate", "findCreateFind", "update", "destroy", "restore", "upsert", "increment", "decrement", "truncate",
]);

interface DrizzleTableInfo {
  variable: string;
  tableName: string;
  tableId: string;
  file: string;
}

interface ClassInfo {
  name: string;
  id: string;
  type: GraphNodeType;
  file: string;
  declaration: ClassDeclaration;
  constructorTypes: Map<string, string>;
  repositoryEntities: Map<string, string>;
  sequelizeModels: Map<string, string>;
  queueTokens: Map<string, string>;
}

interface ClassRegistry {
  byDeclaration: Map<ClassDeclaration, ClassInfo>;
  byName: Map<string, ClassInfo[]>;
  sourceFiles: Map<string, SourceFile>;
  drizzleTables: Map<string, DrizzleTableInfo>;
  size: number;
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
    const candidates: Array<{ name: string; type: GraphNodeType; file: string; declaration: ClassDeclaration }> = [];

    for (const sourceFile of sourceFiles) {
      const file = relativePath(context.projectRoot, sourceFile.getFilePath());
      for (const declaration of sourceFile.getClasses()) {
        const name = declaration.getName();
        if (!name) continue;
        const type = classifyClass(declaration, file);
        if (!type) continue;
        candidates.push({ name, type, file, declaration });
      }
    }

    const nameCounts = new Map<string, number>();
    for (const candidate of candidates) nameCounts.set(candidate.name, (nameCounts.get(candidate.name) ?? 0) + 1);
    const classes: ClassRegistry = {
      byDeclaration: new Map(),
      byName: new Map(),
      sourceFiles: new Map(sourceFiles.map((sourceFile) => [relativePath(context.projectRoot, sourceFile.getFilePath()), sourceFile])),
      drizzleTables: new Map(),
      size: candidates.length,
    };
    for (const candidate of candidates) {
        const { name, type, file, declaration } = candidate;
        const id = nameCounts.get(name) === 1 ? `${type}:${name}` : `${type}:${name}@${file}`;
        const { constructorTypes, repositoryEntities, sequelizeModels, queueTokens } = getConstructorInfo(declaration);
        const info: ClassInfo = { name, id, type, file, declaration, constructorTypes, repositoryEntities, sequelizeModels, queueTokens };
        classes.byDeclaration.set(declaration, info);
        const named = classes.byName.get(name) ?? [];
        named.push(info);
        classes.byName.set(name, named);
        addNode(classNode(info));
        addEdge(`file:${file}`, id, "declares");
    }

    await parsePrisma(context, addNode, addEdge);
    classes.drizzleTables = parseDrizzleSchemas(sourceFiles, context.projectRoot, addNode, addEdge);

    const globalPrefix = findGlobalPrefix(sourceFiles);
    for (const sourceFile of sourceFiles) {
      const file = relativePath(context.projectRoot, sourceFile.getFilePath());
      parseImports(sourceFile, context.projectRoot, addNode, addEdge);
      parseFunctions(sourceFile, file, addNode, addEdge);
      parseBootstrapGlobals(sourceFile, file, classes, addNode, addEdge);
      for (const declaration of sourceFile.getClasses()) {
        const info = classes.byDeclaration.get(declaration);
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
  const normalizedFile = file.replaceAll("\\", "/").toLowerCase();
  if (decorators.has("Module")) return "module";
  if (decorators.has("Processor")) return "processor";
  if (decorators.has("Controller")) return "controller";
  if (decorators.has("Entity")) return "entity";
  if (decorators.has("Table")) return "entity";
  if (/use-?case$/i.test(name) || normalizedFile.includes("/use-cases/")) return "use_case";
  const infrastructureFile = normalizedFile.includes("/infra/") || normalizedFile.includes("/infrastructure/") || normalizedFile.includes("/adapters/");
  if (/(?:Adapter|ClientAdapter)$/i.test(name)
    || (infrastructureFile && decorators.has("Injectable"))) return "adapter";
  const portFile = /\/(?:ports?|application\/ports)(?:\/|\.)/.test(normalizedFile);
  if (/(?:Port|Gateway)$/i.test(name)
    || (portFile && (declaration.isAbstract() || /Repository$/i.test(name)))) return "port";
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
  classes: ClassRegistry,
  addNode: (node: GraphNode) => void,
  addEdge: EdgeAdder,
  globalPrefix: string,
) {
  parseModule(info, classes, addNode, addEdge);
  parseHexagonalRelations(info, classes, addEdge);
  parseTypeOrm(info, classes, addNode, addEdge);
  parseSequelize(info, classes, addNode, addEdge);
  parseAsyncClass(info, addNode, addEdge);

  for (const [parameter, typeName] of info.constructorTypes) {
    const queueName = info.queueTokens.get(parameter);
    if (queueName) {
      const queueId = addQueueNode(queueName, info.file, addNode);
      addEdge(info.id, queueId, "uses", { via: "InjectQueue", parameter });
      continue;
    }
    if (isMessageClient(parameter, typeName)) {
      const transport = messageTransport(parameter, typeName) ?? "nest-microservice";
      const brokerId = addMessageBroker(transport, addNode);
      addEdge(info.id, brokerId, "uses", { via: "constructor", parameter, clientType: typeName, transport });
    }
    const target = ensureClass(typeName, classes, info.file, addNode);
    addEdge(info.id, target.id, "injects", { via: "constructor", parameter, repositoryEntity: info.repositoryEntities.get(parameter) });
  }

  for (const method of info.declaration.getMethods()) {
    const methodId = classMethodId(info, method.getName());
    addNode(methodNode(info, method));
    addEdge(info.id, methodId, "has_method");
    parseRoute(info, method, methodId, globalPrefix, addNode, addEdge);
    parseAsyncConsumer(info, method, methodId, addNode, addEdge);
    parseMethodRelations(info, method, methodId, classes, addNode, addEdge);
    parseAppliedDecorators(method.getDecorators(), methodId, classes, info.file, addNode, addEdge);
  }
  parseMiddlewareConfiguration(info, classes, addNode, addEdge);
  parseAppliedDecorators(info.declaration.getDecorators(), info.id, classes, info.file, addNode, addEdge);
}

function parseHexagonalRelations(info: ClassInfo, classes: ClassRegistry, addEdge: EdgeAdder) {
  const heritage = [
    ...(info.declaration.getExtends() ? [info.declaration.getExtends()!] : []),
    ...info.declaration.getImplements(),
  ];
  for (const item of heritage) {
    const name = item.getExpression().getText().split(".").at(-1);
    if (!name) continue;
    const target = resolveClass(name, classes, info.file);
    if (target?.type === "port") addEdge(info.id, target.id, "implements", { via: item.getText() });
  }
}

function parseModule(info: ClassInfo, classes: ClassRegistry, addNode: NodeAdder, addEdge: EdgeAdder) {
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
      if (propertyName === "imports" && Node.isCallExpression(element) && element.getExpression().getText().endsWith("SequelizeModule.forFeature")) {
        const models = element.getArguments()[0];
        if (models && Node.isArrayLiteralExpression(models)) {
          for (const model of models.getElements()) {
            const modelName = model.getText().match(/[A-Z][A-Za-z0-9_$]*/)?.[0];
            if (!modelName) continue;
            const target = ensureClass(modelName, classes, info.file, addNode, "entity");
            addEdge(info.id, target.id, "uses", { moduleProperty: propertyName, via: "SequelizeModule.forFeature" });
          }
        }
      }
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
  classes: ClassRegistry,
  addNode: NodeAdder,
  addEdge: EdgeAdder,
) {
  const dataRelations = new Set<string>();
  for (const parameter of method.getParameters()) {
    const typeName = simpleType(parameter.getTypeNode()?.getText() ?? parameter.getType().getText());
    const target = resolveClass(typeName, classes, info.file);
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
    const target = resolveClass(returnType, classes, info.file);
    if (target) addEdge(methodId, target.id, "returns");
  }

  for (const call of method.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expression = call.getExpression().getText();
    if (parseAsyncProducerCall(info, call, methodId, addNode, addEdge)) continue;
    const localCall = expression.match(/^this\.([A-Za-z_$][\w$]*)$/);
    if (localCall) {
      const targetMethod = info.declaration.getMethod(localCall[1]);
      if (targetMethod) {
        const targetMethodId = classMethodId(info, targetMethod.getName());
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
        const targetMethodId = classMethodId(target, targetMethod);
        addNode({ id: targetMethodId, type: "method", label: `${target.name}.${targetMethod}`, name: targetMethod, file: target.file, framework: "nestjs", language: "typescript", confidence: classes.byName.has(typeName) ? 1 : 0.75, source: classes.byName.has(typeName) ? "ast" : "heuristic", metadata: { class: target.name, method: targetMethod } });
        addEdge(target.id, targetMethodId, "has_method");
        addEdge(methodId, targetMethodId, "calls", { via: property });
        const entityName = info.repositoryEntities.get(property);
        if (entityName && (typeOrmReadMethods.has(targetMethod) || typeOrmWriteMethods.has(targetMethod))) {
          const { id: tableId, name: tableName } = tableForEntity(entityName, classes, info.file);
          addNode({ id: tableId, type: "table", label: tableName, name: tableName, framework: "typeorm", source: "heuristic", confidence: 0.9 });
          addEdge(targetMethodId, tableId, typeOrmReadMethods.has(targetMethod) ? "reads" : "writes", { operation: targetMethod, via: property, orm: "typeorm" });
        }
        const sequelizeModel = info.sequelizeModels.get(property);
        if (sequelizeModel && (sequelizeReadMethods.has(targetMethod) || sequelizeWriteMethods.has(targetMethod))) {
          const { id: tableId, name: tableName } = tableForSequelizeModel(sequelizeModel, classes, info.file);
          addNode({ id: tableId, type: "table", label: tableName, name: tableName, framework: "sequelize", source: "heuristic", confidence: 0.95 });
          addEdge(targetMethodId, tableId, sequelizeReadMethods.has(targetMethod) ? "reads" : "writes", { operation: targetMethod, via: property, orm: "sequelize" });
        }
      }
    }

    const staticSequelizeCall = expression.match(/^([A-Z][A-Za-z0-9_$]*)\.([A-Za-z_$][\w$]*)$/);
    if (staticSequelizeCall) {
      const [, modelName, operation] = staticSequelizeCall;
      const model = resolveClass(modelName, classes, info.file);
      if (model?.declaration.getDecorator("Table") && (sequelizeReadMethods.has(operation) || sequelizeWriteMethods.has(operation))) {
        const operationId = classMethodId(model, operation);
        const { id: tableId, name: tableName } = tableForSequelizeModel(modelName, classes, info.file);
        addNode({ id: operationId, type: "method", label: `${modelName}.${operation}`, name: operation, file: model.file, framework: "sequelize", language: "typescript", source: "ast", confidence: 1, metadata: { class: modelName, method: operation, databaseOperation: true } });
        addNode({ id: tableId, type: "table", label: tableName, name: tableName, framework: "sequelize", source: "ast", confidence: 1 });
        addEdge(model.id, operationId, "has_method", { generatedFromUsage: true });
        addEdge(methodId, operationId, "calls", { orm: "sequelize" });
        addEdge(operationId, tableId, sequelizeReadMethods.has(operation) ? "reads" : "writes", { operation, orm: "sequelize" });
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

    const drizzleOperation = detectDrizzleOperation(call.getText(), classes.drizzleTables);
    if (drizzleOperation) {
      const relationKey = `${drizzleOperation.type}:${drizzleOperation.table.tableId}:${drizzleOperation.operation}`;
      if (!dataRelations.has(relationKey)) {
        dataRelations.add(relationKey);
        addEdge(methodId, drizzleOperation.table.tableId, drizzleOperation.type, {
          operation: drizzleOperation.operation,
          schemaVariable: drizzleOperation.table.variable,
          orm: "drizzle",
        });
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

function parseTypeOrm(info: ClassInfo, classes: ClassRegistry, addNode: NodeAdder, addEdge: EdgeAdder) {
  if (!info.declaration.getDecorator("Entity")) return;
  const tableName = decoratorString(info.declaration.getDecorator("Entity")) || info.name;
  const tableId = `table:${tableName}`;
  addNode({ id: "database:typeorm", type: "database", label: "TypeORM", name: "TypeORM", framework: "typeorm", source: "config", confidence: 1 });
  addNode({ id: tableId, type: "table", label: tableName, name: tableName, file: info.file, framework: "typeorm", confidence: 1, source: "ast" });
  addEdge("database:typeorm", tableId, "contains");
  addEdge(info.id, tableId, "references");
  for (const decorator of info.declaration.getDecorators().filter((item) => ["Index", "Unique"].includes(item.getName()))) {
    addOrmIndex(tableId, tableName, decorator, info.file, decorator.getName() === "Unique", addNode, addEdge);
  }
  for (const property of info.declaration.getProperties()) {
    const decorators = property.getDecorators().map((item) => item.getName());
    if (decorators.some((name) => ["Column", "PrimaryColumn", "PrimaryGeneratedColumn"].includes(name))) {
      const columnId = `column:${tableName}.${property.getName()}`;
      const columnDecorator = property.getDecorators().find((item) => ["Column", "PrimaryColumn", "PrimaryGeneratedColumn"].includes(item.getName()));
      addNode({ id: columnId, type: "column", label: `${tableName}.${property.getName()}`, name: property.getName(), file: info.file, framework: "typeorm", source: "ast", confidence: 1, metadata: {
        type: decoratorOptionText(columnDecorator!, "type") || property.getTypeNode()?.getText(), decorators,
        nullable: decoratorOptionText(columnDecorator!, "nullable") === "true",
        unique: decoratorOptionText(columnDecorator!, "unique") === "true",
        primaryKey: decorators.some((name) => ["PrimaryColumn", "PrimaryGeneratedColumn"].includes(name)),
        generated: decorators.includes("PrimaryGeneratedColumn"),
        databaseName: decoratorOptionString(columnDecorator!, "name") || property.getName(),
        default: decoratorOptionText(columnDecorator!, "default") || undefined,
      } });
      addEdge(tableId, columnId, "has_column");
      for (const decorator of property.getDecorators().filter((item) => ["Index", "Unique"].includes(item.getName()))) {
        addOrmIndex(tableId, tableName, decorator, info.file, decorator.getName() === "Unique", addNode, addEdge, [property.getName()]);
      }
    }
    const relation = decorators.find((name) => ["ManyToOne", "OneToMany", "OneToOne", "ManyToMany"].includes(name));
    if (relation) {
      const targetName = referencedTypeNames(property.getTypeNode()?.getText() ?? "").find((name) => name !== info.name);
      if (!targetName) continue;
      const { id: targetTableId, name: targetTableName } = tableForEntity(targetName, classes, info.file);
      addNode({ id: targetTableId, type: "table", label: targetTableName, name: targetTableName, framework: "typeorm", source: "heuristic", confidence: 0.85 });
      addEdge(tableId, targetTableId, "references", { relation, property: property.getName(), orm: "typeorm" }, "ast", 1);
    }
  }
}

function parseSequelize(info: ClassInfo, classes: ClassRegistry, addNode: NodeAdder, addEdge: EdgeAdder) {
  const tableDecorator = info.declaration.getDecorator("Table");
  if (!tableDecorator) return;
  const tableName = decoratorOptionString(tableDecorator, "tableName") || decoratorDirectString(tableDecorator) || info.name;
  const tableId = `table:${tableName}`;
  addNode({ id: "database:sequelize", type: "database", label: "Sequelize", name: "Sequelize", framework: "sequelize", source: "config", confidence: 1 });
  addNode({ id: tableId, type: "table", label: tableName, name: tableName, file: info.file, framework: "sequelize", confidence: 1, source: "ast", metadata: { model: info.name } });
  addEdge("database:sequelize", tableId, "contains");
  addEdge(info.id, tableId, "references", { orm: "sequelize" });

  for (const property of info.declaration.getProperties()) {
    const columnDecorator = property.getDecorator("Column");
    const decorators = property.getDecorators().map((item) => item.getName());
    if (columnDecorator) {
      const columnName = decoratorOptionString(columnDecorator, "field") || property.getName();
      const columnId = `column:${tableName}.${columnName}`;
      const configuredType = decoratorOptionText(columnDecorator, "type");
      addNode({
        id: columnId,
        type: "column",
        label: `${tableName}.${columnName}`,
        name: columnName,
        file: info.file,
        framework: "sequelize",
        source: "ast",
        confidence: 1,
        metadata: {
          property: property.getName(),
          type: configuredType || property.getTypeNode()?.getText(),
          decorators,
          primaryKey: decoratorOptionText(columnDecorator, "primaryKey") === "true" || decorators.includes("PrimaryKey"),
          allowNull: decoratorOptionText(columnDecorator, "allowNull") || undefined,
        },
      });
      addEdge(tableId, columnId, "has_column");
      for (const indexDecorator of property.getDecorators().filter((item) => ["Index", "Unique"].includes(item.getName()))) {
        addOrmIndex(tableId, tableName, indexDecorator, info.file, indexDecorator.getName() === "Unique", addNode, addEdge, [columnName]);
      }
    }

    const relationDecorator = property.getDecorators().find((item) => ["BelongsTo", "HasMany", "HasOne", "BelongsToMany", "ForeignKey"].includes(item.getName()));
    if (!relationDecorator) continue;
    const targetName = relationDecorator.getArguments().flatMap((argument) => referencedTypeNames(argument.getText())).find((name) => name !== info.name);
    if (!targetName) continue;
    const target = resolveClass(targetName, classes, info.file);
    if (!target?.declaration.getDecorator("Table")) continue;
    const { id: targetTableId, name: targetTableName } = tableForSequelizeModel(targetName, classes, info.file);
    addNode({ id: targetTableId, type: "table", label: targetTableName, name: targetTableName, file: target.file, framework: "sequelize", source: "ast", confidence: 1 });
    addEdge(tableId, targetTableId, "references", { relation: relationDecorator.getName(), property: property.getName(), orm: "sequelize" });
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
    const mappedName = body.match(/@@map\(\s*["']([^"']+)["']\s*\)/)?.[1] ?? modelName;
    const schemaName = body.match(/@@schema\(\s*["']([^"']+)["']\s*\)/)?.[1] ?? "public";
    addNode({ id: modelId, type: "model", label: modelName, name: modelName, file: schema.path, framework: "prisma", source: "config", confidence: 1 });
    addNode({ id: tableId, type: "table", label: mappedName, name: mappedName, file: schema.path, framework: "prisma", source: "config", confidence: 1, metadata: { model: modelName, schema: schemaName, databaseName: mappedName } });
    const schemaId = `schema:prisma.${schemaName}`;
    addNode({ id: schemaId, type: "schema", label: schemaName, name: schemaName, file: schema.path, framework: "prisma", source: "config", confidence: 1 });
    addEdge("database:prisma", modelId, "contains");
    addEdge("database:prisma", schemaId, "contains");
    addEdge(schemaId, tableId, "contains");
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
      const databaseName = line.match(/@map\(\s*["']([^"']+)["']\s*\)/)?.[1] ?? fieldName;
      addNode({ id: columnId, type: "column", label: `${mappedName}.${databaseName}`, name: databaseName, file: schema.path, framework: "prisma", source: "config", confidence: 1, metadata: {
        property: fieldName, type: fieldType, nullable: fieldType.endsWith("?"), list: fieldType.endsWith("[]"),
        primaryKey: /@id\b/.test(line), unique: /@unique\b/.test(line), databaseName,
        default: line.match(/@default\(([^)]*)\)/)?.[1],
      } });
      addEdge(tableId, columnId, "has_column");
    }
    for (const directive of body.matchAll(/@@(index|unique|id)\s*\(\s*\[([^\]]+)\]([^)]*)\)/g)) {
      const [, kind, rawColumns, options] = directive;
      const columns = rawColumns.split(",").map((item) => item.trim().split(/\s+/)[0]).filter(Boolean);
      const configuredName = options.match(/(?:name|map)\s*:\s*["']([^"']+)["']/)?.[1];
      const name = configuredName ?? `${kind}_${columns.join("_")}`;
      if (kind === "index") {
        const id = `index:${modelName}.${name}`;
        addNode({ id, type: "index", label: name, name, file: schema.path, framework: "prisma", source: "config", confidence: 1, metadata: { columns, type: options.match(/type\s*:\s*(\w+)/)?.[1] } });
        addEdge(id, tableId, "indexes");
      } else {
        const id = `constraint:${modelName}.${name}`;
        addNode({ id, type: "constraint", label: name, name, file: schema.path, framework: "prisma", source: "config", confidence: 1, metadata: { kind, columns } });
        addEdge(tableId, id, "contains");
      }
    }
  }
}

function parseDrizzleSchemas(sourceFiles: SourceFile[], projectRoot: string, addNode: NodeAdder, addEdge: EdgeAdder): Map<string, DrizzleTableInfo> {
  const tables = new Map<string, DrizzleTableInfo>();
  const pendingReferences: Array<{ from: string; variable: string; property: string }> = [];
  const tableFactories = new Set(["pgTable", "mysqlTable", "sqliteTable", "sqliteTableCreator"]);
  const columnModifiers = new Set(["notNull", "primaryKey", "default", "defaultNow", "$defaultFn", "$onUpdate", "unique", "references"]);

  for (const sourceFile of sourceFiles) {
    const file = relativePath(projectRoot, sourceFile.getFilePath());
    for (const declaration of sourceFile.getVariableDeclarations()) {
      const initializer = declaration.getInitializer();
      if (!initializer) continue;
      const calls = [
        ...(Node.isCallExpression(initializer) ? [initializer] : []),
        ...initializer.getDescendantsOfKind(SyntaxKind.CallExpression),
      ];
      const tableCall = calls.find((call) => tableFactories.has(call.getExpression().getText().split(".").at(-1) ?? ""));
      if (!tableCall) continue;
      const tableName = expressionValue(tableCall.getArguments()[0]);
      const columns = tableCall.getArguments()[1];
      if (!tableName || !columns || !Node.isObjectLiteralExpression(columns)) continue;

      const variable = declaration.getName();
      const tableId = `table:${tableName}`;
      const table: DrizzleTableInfo = { variable, tableName, tableId, file };
      tables.set(variable, table);
      addNode({ id: "database:drizzle", type: "database", label: "Drizzle", name: "Drizzle", framework: "drizzle", source: "config", confidence: 1 });
      addNode({ id: tableId, type: "table", label: tableName, name: tableName, file, framework: "drizzle", source: "ast", confidence: 1, metadata: { schemaVariable: variable } });
      addEdge("database:drizzle", tableId, "contains");
      addEdge(`file:${file}`, tableId, "declares", { orm: "drizzle", schemaVariable: variable });

      for (const property of columns.getProperties()) {
        if (!Node.isPropertyAssignment(property)) continue;
        const propertyName = property.getName().replace(/^['"`]|['"`]$/g, "");
        const columnInitializer = property.getInitializer();
        if (!columnInitializer) continue;
        const columnCalls = [
          ...(Node.isCallExpression(columnInitializer) ? [columnInitializer] : []),
          ...columnInitializer.getDescendantsOfKind(SyntaxKind.CallExpression),
        ];
        const builder = [...columnCalls].reverse().find((call) => {
          const name = call.getExpression().getText().split(".").at(-1) ?? "";
          return /^[A-Za-z_$][\w$]*$/.test(name) && !columnModifiers.has(name);
        });
        const columnName = expressionValue(builder?.getArguments()[0]) || propertyName;
        const columnType = builder?.getExpression().getText().split(".").at(-1) ?? propertyName;
        const columnText = columnInitializer.getText();
        const columnId = `column:${tableName}.${columnName}`;
        addNode({
          id: columnId,
          type: "column",
          label: `${tableName}.${columnName}`,
          name: columnName,
          file,
          framework: "drizzle",
          source: "ast",
          confidence: 1,
          metadata: {
            property: propertyName,
            type: columnType,
            nullable: !/\.notNull\s*\(/.test(columnText),
            primaryKey: /\.primaryKey\s*\(/.test(columnText),
          },
        });
        addEdge(tableId, columnId, "has_column");

        const reference = columnText.match(/\.references\s*\(\s*\(\s*\)\s*=>\s*([A-Za-z_$][\w$]*)\./);
        if (reference) pendingReferences.push({ from: tableId, variable: reference[1], property: propertyName });
      }
      const extraConfig = tableCall.getArguments()[2]?.getText() ?? "";
      for (const indexMatch of extraConfig.matchAll(/(uniqueIndex|index)\s*\(\s*["'`]([^"'`]+)["'`]\s*\)\.on\s*\(([^)]*)\)/g)) {
        const id = `index:${tableName}.${indexMatch[2]}`;
        const columns = [...indexMatch[3].matchAll(/\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1]);
        addNode({ id, type: "index", label: indexMatch[2], name: indexMatch[2], file, framework: "drizzle", source: "ast", confidence: 1, metadata: { unique: indexMatch[1] === "uniqueIndex", columns } });
        addEdge(id, tableId, "indexes");
      }
    }
  }
  for (const reference of pendingReferences) {
    const target = tables.get(reference.variable);
    if (target) addEdge(reference.from, target.tableId, "references", { property: reference.property, orm: "drizzle" });
  }
  return tables;
}

function detectDrizzleOperation(text: string, tables: Map<string, DrizzleTableInfo>): { table: DrizzleTableInfo; type: "reads" | "writes"; operation: string } | null {
  const normalized = text.replace(/\s+/g, " ");
  const write = normalized.match(/\.(insert|update|delete)\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/);
  if (write) {
    const table = tables.get(write[2]);
    if (table) return { table, type: "writes", operation: write[1] };
  }
  if (/\.(?:select|selectDistinct|selectDistinctOn)\s*\(/.test(normalized)) {
    const from = normalized.match(/\.from\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/);
    const table = from ? tables.get(from[1]) : undefined;
    if (table) return { table, type: "reads", operation: "select" };
  }
  const relational = normalized.match(/\.query\.([A-Za-z_$][\w$]*)\.(findMany|findFirst)\s*\(/);
  if (relational) {
    const table = tables.get(relational[1]);
    if (table) return { table, type: "reads", operation: relational[2] };
  }
  return null;
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

function parseTest(sourceFile: SourceFile, file: string, classes: ClassRegistry, addNode: NodeAdder, addEdge: EdgeAdder) {
  const id = `test:${file}`;
  addNode({ id, type: "test", label: basename(file), name: basename(file), file, language: "typescript", source: "static_analysis", confidence: 1 });
  addEdge(`file:${file}`, id, "declares");
  for (const declaration of sourceFile.getImportDeclarations()) {
    for (const namedImport of declaration.getNamedImports()) {
      const target = resolveClass(namedImport.getName(), classes, file);
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

function parseAppliedDecorators(decorators: Decorator[], ownerId: string, classes: ClassRegistry, file: string, addNode: NodeAdder, addEdge: EdgeAdder) {
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
    id: classMethodId(info, methodName), type: "method", label: `${info.name}.${methodName}`, name: methodName,
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

function classMethodId(info: ClassInfo, methodName: string): string {
  const canonicalClassId = `${info.type}:${info.name}`;
  return info.id === canonicalClassId ? `method:${info.name}.${methodName}` : `method:${info.name}.${methodName}@${info.file}`;
}

function getConstructorInfo(declaration: ClassDeclaration): Pick<ClassInfo, "constructorTypes" | "repositoryEntities" | "sequelizeModels" | "queueTokens"> {
  const constructorTypes = new Map<string, string>();
  const repositoryEntities = new Map<string, string>();
  const sequelizeModels = new Map<string, string>();
  const queueTokens = new Map<string, string>();
  for (const constructor of declaration.getConstructors()) {
    for (const parameter of constructor.getParameters()) {
      const queueDecorator = parameter.getDecorator("InjectQueue");
      const queueName = expressionValue(queueDecorator?.getArguments()[0]);
      if (queueName) queueTokens.set(parameter.getName(), queueName);
      const repositoryDecorator = parameter.getDecorator("InjectRepository");
      const repositoryEntity = repositoryDecorator?.getArguments()[0]?.getText().match(/[A-Z][A-Za-z0-9_$]*/)?.[0];
      if (repositoryEntity) {
        const repositoryName = `${repositoryEntity}Repository`;
        constructorTypes.set(parameter.getName(), repositoryName);
        repositoryEntities.set(parameter.getName(), repositoryEntity);
        continue;
      }
      const modelDecorator = parameter.getDecorator("InjectModel");
      const sequelizeModel = modelDecorator?.getArguments()[0]?.getText().match(/[A-Z][A-Za-z0-9_$]*/)?.[0];
      if (sequelizeModel) {
        constructorTypes.set(parameter.getName(), sequelizeModel);
        sequelizeModels.set(parameter.getName(), sequelizeModel);
        continue;
      }
      const injectDecorator = parameter.getDecorator("Inject");
      const token = expressionValue(injectDecorator?.getArguments()[0]);
      constructorTypes.set(parameter.getName(), token || simpleType(parameter.getTypeNode()?.getText() ?? parameter.getType().getText()));
    }
  }
  return { constructorTypes, repositoryEntities, sequelizeModels, queueTokens };
}

function resolveClass(name: string, classes: ClassRegistry, file?: string): ClassInfo | undefined {
  const candidates = classes.byName.get(name) ?? [];
  if (candidates.length <= 1) return candidates[0];
  if (!file) return undefined;

  const sameFile = candidates.find((candidate) => candidate.file === file);
  if (sameFile) return sameFile;

  const sourceFile = classes.sourceFiles.get(file);
  if (sourceFile) {
    for (const declaration of sourceFile.getImportDeclarations()) {
      const importedNames = declaration.getNamedImports().flatMap((item) => [item.getName(), item.getAliasNode()?.getText()]).filter(Boolean);
      const defaultName = declaration.getDefaultImport()?.getText();
      if (!importedNames.includes(name) && defaultName !== name) continue;
      const targetFile = declaration.getModuleSpecifierSourceFile();
      const imported = candidates.find((candidate) => candidate.declaration.getSourceFile() === targetFile);
      if (imported) return imported;
    }
  }

  const sourceParts = file.split("/");
  const ranked = candidates.map((candidate) => {
    const candidateParts = candidate.file.split("/");
    let score = 0;
    while (score < sourceParts.length && score < candidateParts.length && sourceParts[score] === candidateParts[score]) score += 1;
    return { candidate, score };
  }).sort((left, right) => right.score - left.score || left.candidate.file.localeCompare(right.candidate.file));
  return ranked[0]?.score > (ranked[1]?.score ?? -1) ? ranked[0].candidate : undefined;
}

function ensureClass(name: string, classes: ClassRegistry, file: string, addNode: NodeAdder, fallbackType: GraphNodeType = "provider") {
  const existing = resolveClass(name, classes, file);
  if (existing) return existing;
  const type = inferType(name, fallbackType);
  const ambiguous = (classes.byName.get(name)?.length ?? 0) > 1;
  const inferred = { name, id: ambiguous ? `${type}:${name}@unresolved:${file}` : `${type}:${name}`, type, file, declaration: undefined as unknown as ClassDeclaration, constructorTypes: new Map<string, string>(), repositoryEntities: new Map<string, string>(), sequelizeModels: new Map<string, string>(), queueTokens: new Map<string, string>() };
  addNode({ id: inferred.id, type, label: name, name, file, framework: "nestjs", language: "typescript", confidence: 0.7, source: "heuristic" });
  return inferred;
}

function inferType(name: string, fallback: GraphNodeType): GraphNodeType {
  if (/UseCase$/i.test(name)) return "use_case";
  if (/(?:Port|Gateway)$/i.test(name)) return "port";
  if (/Adapter$/i.test(name)) return "adapter";
  if (name.endsWith("Service")) return "service";
  if (name.endsWith("Controller")) return "controller";
  if (name.endsWith("Module")) return "module";
  if (name.endsWith("Dto")) return "dto";
  if (name.endsWith("Guard")) return "guard";
  if (name.endsWith("Pipe")) return "pipe";
  if (name.endsWith("Interceptor")) return "interceptor";
  if (name.endsWith("Repository")) return "repository";
  if (name.endsWith("Processor")) return "processor";
  return fallback;
}

function parseAsyncClass(info: ClassInfo, addNode: NodeAdder, addEdge: EdgeAdder) {
  const processor = info.declaration.getDecorator("Processor");
  if (!processor) return;
  const queueName = expressionValue(processor.getArguments()[0]) || info.name;
  const queueId = addQueueNode(queueName, info.file, addNode);
  addEdge(queueId, info.id, "processes", { decorator: "Processor", queue: queueName });
}

function parseAsyncConsumer(
  info: ClassInfo,
  method: MethodDeclaration,
  methodId: string,
  addNode: NodeAdder,
  addEdge: EdgeAdder,
) {
  const processor = info.declaration.getDecorator("Processor");
  if (processor && method.getName() === "process" && !method.getDecorator("Process")) {
    const queueName = expressionValue(processor.getArguments()[0]) || info.name;
    const queueId = addQueueNode(queueName, info.file, addNode);
    addEdge(queueId, methodId, "delivers_to", { transport: "bullmq", processor: info.name, handler: method.getName(), job: "any" });
  }
  for (const decorator of method.getDecorators()) {
    if (["MessagePattern", "EventPattern"].includes(decorator.getName())) {
      const pattern = decorator.getArguments()[0];
      const topic = expressionValue(pattern);
      if (!topic) continue;
      const transport = isObjectPattern(pattern) ? "nest-microservice" : "kafka";
      const topicId = addMessageTopic(topic, info.file, addNode, addEdge, transport);
      addEdge(topicId, methodId, "delivers_to", {
        transport,
        decorator: decorator.getName(),
        consumer: info.name,
        handler: method.getName(),
      });
      continue;
    }
    if (["RabbitSubscribe", "RabbitRPC"].includes(decorator.getName())) {
      const options = decorator.getArguments()[0]?.getText() ?? "";
      const exchange = options.match(/exchange\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? "default";
      const routingKey = options.match(/routingKey\s*:\s*['"`]([^'"`]+)['"`]/)?.[1] ?? method.getName();
      const queueName = options.match(/queue\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
      const brokerId = addMessageBroker("rabbitmq", addNode);
      const topicId = addMessageTopic(`${exchange}:${routingKey}`, info.file, addNode, addEdge, "rabbitmq");
      addEdge(topicId, methodId, "delivers_to", { transport: "rabbitmq", exchange, routingKey, handler: method.getName() });
      if (queueName) {
        const queueId = addQueueNode(queueName, info.file, addNode, "rabbitmq");
        addEdge(brokerId, queueId, "contains", { transport: "rabbitmq" });
        addEdge(queueId, methodId, "delivers_to", { transport: "rabbitmq", exchange, routingKey });
      }
      continue;
    }
    if (decorator.getName() !== "Process") continue;
    const processor = info.declaration.getDecorator("Processor");
    const queueName = expressionValue(processor?.getArguments()[0]) || info.name;
    const jobName = processJobName(decorator) || method.getName();
    const queueId = addQueueNode(queueName, info.file, addNode);
    addEdge(queueId, methodId, "delivers_to", {
      transport: "bull",
      decorator: "Process",
      processor: info.name,
      handler: method.getName(),
      job: jobName,
    });
  }
}

function parseAsyncProducerCall(
  info: ClassInfo,
  call: CallExpression,
  methodId: string,
  addNode: NodeAdder,
  addEdge: EdgeAdder,
): boolean {
  const expression = call.getExpression().getText();
  const messageCall = expression.match(/^this\.([A-Za-z_$][\w$]*)\.(emit|send)$/);
  if (messageCall) {
    const [, property, operation] = messageCall;
    const typeName = info.constructorTypes.get(property) ?? "";
    if (isMessageClient(property, typeName)) {
      const topic = expressionValue(call.getArguments()[0]);
      if (!topic) return false;
      const transport = messageTransport(property, typeName) ?? "nest-microservice";
      const topicId = addMessageTopic(topic, info.file, addNode, addEdge, transport);
      addEdge(methodId, topicId, "publishes_to", { transport, operation, client: property });
      return true;
    }
  }

  const queueCall = expression.match(/^this\.([A-Za-z_$][\w$]*)\.(add|addBulk)$/);
  if (!queueCall) return false;
  const [, property, operation] = queueCall;
  const queueName = info.queueTokens.get(property);
  if (!queueName) return false;
  const queueId = addQueueNode(queueName, info.file, addNode);
  const job = expressionValue(call.getArguments()[0]);
  addEdge(methodId, queueId, "enqueues", { transport: "bull", operation, ...(job ? { job } : {}) });
  return true;
}

function addMessageBroker(transport: string, addNode: NodeAdder): string {
  const id = `message_broker:${transport}`;
  const label = transport === "kafka" ? "Kafka" : transport === "rabbitmq" ? "RabbitMQ" : "NestJS messaging";
  addNode({ id, type: "message_broker", label, name: label, framework: "nestjs", source: "ast", confidence: 1, metadata: { transport } });
  return id;
}

function addMessageTopic(topic: string, file: string, addNode: NodeAdder, addEdge: EdgeAdder, transport = "kafka"): string {
  const id = `message_topic:${cleanToken(topic)}`;
  const brokerId = addMessageBroker(transport, addNode);
  addNode({ id, type: "message_topic", label: topic, name: topic, file, framework: "nestjs", source: "ast", confidence: 1, metadata: { transport, topic } });
  addEdge(brokerId, id, "contains", { transport });
  return id;
}

function addQueueNode(queue: string, file: string, addNode: NodeAdder, transport = "bull"): string {
  const id = `queue:${cleanToken(queue)}`;
  addNode({ id, type: "queue", label: queue, name: queue, file, framework: "nestjs", source: "ast", confidence: 1, metadata: { transport, queue } });
  return id;
}

function addOrmIndex(tableId: string, tableName: string, decorator: Decorator, file: string, forceUnique: boolean, addNode: NodeAdder, addEdge: EdgeAdder, fallbackColumns: string[] = []) {
  const args = decorator.getArguments().map((argument) => argument.getText());
  const configuredName = args.find((value) => /^['"`]/.test(value));
  const columns = args.flatMap((value) => [...value.matchAll(/['"`]([A-Za-z_$][\w$]*)['"`]/g)].map((match) => match[1])).filter((value) => value !== configuredName?.replace(/^['"`]|['"`]$/g, ""));
  const unique = forceUnique || args.some((value) => /unique\s*:\s*true/.test(value));
  const name = configuredName?.replace(/^['"`]|['"`]$/g, "") || `${unique ? "uniq" : "idx"}_${tableName}_${(columns.length ? columns : fallbackColumns).join("_") || "custom"}`;
  const id = `index:${tableName}.${name}`;
  addNode({ id, type: "index", label: name, name, file, framework: "typeorm", source: "ast", confidence: 1, metadata: { columns: columns.length ? columns : fallbackColumns, unique, decorator: decorator.getName() } });
  addEdge(id, tableId, "indexes");
}

function isMessageClient(parameter: string, typeName: string): boolean {
  return messageTransport(parameter, typeName) !== null;
}

function messageTransport(parameter: string, typeName: string): string | null {
  if (/kafka/i.test(parameter) || /ClientKafka|KafkaClient|KAFKA/i.test(typeName)) return "kafka";
  if (/ClientProxy|MessageClient|MicroserviceClient/i.test(typeName)) return "nest-microservice";
  return null;
}

function processJobName(decorator: Decorator): string {
  const argument = decorator.getArguments()[0];
  if (!argument) return "";
  if (Node.isObjectLiteralExpression(argument)) {
    const property = argument.getProperty("name");
    if (property && Node.isPropertyAssignment(property)) return expressionValue(property.getInitializer());
  }
  return expressionValue(argument);
}

function isObjectPattern(node?: Node, seen = new Set<Node>()): boolean {
  if (!node || seen.has(node)) return false;
  seen.add(node);
  if (Node.isObjectLiteralExpression(node)) return true;
  if (!Node.isIdentifier(node)) return false;
  return node.getDefinitions().some((definition) => {
    const declaration = definition.getDeclarationNode();
    return Boolean(declaration && Node.isVariableDeclaration(declaration) && isObjectPattern(declaration.getInitializer(), seen));
  });
}

function expressionValue(node?: Node, seen = new Set<Node>()): string {
  if (!node || seen.has(node)) return "";
  seen.add(node);
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node) || Node.isNumericLiteral(node)) {
    return node.getLiteralText();
  }
  if (Node.isTemplateExpression(node)) {
    let value = node.getHead().getLiteralText();
    for (const span of node.getTemplateSpans()) value += expressionValue(span.getExpression(), seen) + span.getLiteral().getLiteralText();
    return value;
  }
  if (Node.isCallExpression(node) && /(?:^|\.)getKafkaTopicPrefix$/.test(node.getExpression().getText())) {
    return "${KAFKA_ENV_PREFIX}";
  }
  if (Node.isObjectLiteralExpression(node)) {
    const values = node.getProperties().flatMap((property) => {
      if (!Node.isPropertyAssignment(property)) return [];
      return [`${property.getName()}:${expressionValue(property.getInitializer(), seen)}`];
    });
    if (values.length) return values.join(",");
  }
  if (Node.isIdentifier(node)) {
    for (const definition of node.getDefinitions()) {
      const declaration = definition.getDeclarationNode();
      if (declaration && Node.isVariableDeclaration(declaration)) {
        const value = expressionValue(declaration.getInitializer(), seen);
        if (value) return value;
      }
    }
  }
  if (Node.isPropertyAccessExpression(node)) {
    for (const definition of node.getNameNode().getDefinitions()) {
      const declaration = definition.getDeclarationNode();
      if (declaration && Node.isVariableDeclaration(declaration)) {
        const value = expressionValue(declaration.getInitializer(), seen);
        if (value) return value;
      }
    }
  }
  if (Node.isBinaryExpression(node) && node.getOperatorToken().getText() === "+") {
    const left = expressionValue(node.getLeft(), seen);
    const right = expressionValue(node.getRight(), seen);
    if (left || right) return left + right;
  }
  const text = node.getText().replace(/^['"`]|['"`]$/g, "").trim();
  return text.length <= 160 ? text : text.slice(0, 157) + "...";
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

function decoratorDirectString(decorator?: Decorator): string {
  const argument = decorator?.getArguments()[0];
  if (!argument || (!Node.isStringLiteral(argument) && !Node.isNoSubstitutionTemplateLiteral(argument))) return "";
  return expressionValue(argument);
}

function decoratorOptionText(decorator: Decorator, option: string): string {
  const argument = decorator.getArguments()[0];
  if (!argument || !Node.isObjectLiteralExpression(argument)) return "";
  const property = argument.getProperty(option);
  if (!property || !Node.isPropertyAssignment(property)) return "";
  return property.getInitializer()?.getText() ?? "";
}

function decoratorOptionString(decorator: Decorator, option: string): string {
  const argument = decorator.getArguments()[0];
  if (!argument || !Node.isObjectLiteralExpression(argument)) return "";
  const property = argument.getProperty(option);
  if (!property || !Node.isPropertyAssignment(property)) return "";
  return expressionValue(property.getInitializer());
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

function parseBootstrapGlobals(sourceFile: SourceFile, file: string, classes: ClassRegistry, addNode: NodeAdder, addEdge: EdgeAdder) {
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

function parseMiddlewareConfiguration(info: ClassInfo, classes: ClassRegistry, addNode: NodeAdder, addEdge: EdgeAdder) {
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

function tableForEntity(entityName: string, classes: ClassRegistry, file?: string): { id: string; name: string } {
  const entity = resolveClass(entityName, classes, file);
  const tableName = entity?.type === "entity" ? (decoratorString(entity.declaration.getDecorator("Entity")) || entityName) : entityName;
  return { id: `table:${tableName}`, name: tableName };
}

function tableForSequelizeModel(modelName: string, classes: ClassRegistry, file?: string): { id: string; name: string } {
  const model = resolveClass(modelName, classes, file);
  const decorator = model?.declaration.getDecorator("Table");
  const tableName = decorator ? (decoratorOptionString(decorator, "tableName") || decoratorDirectString(decorator) || modelName) : modelName;
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
