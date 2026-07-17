# Atlas

Atlas is a local architecture intelligence engine for NestJS projects, developed by
[Digital Threads](https://github.com/Digital-Threads). It scans source code, builds a
typed graph of the application, highlights architectural risks, and provides a
browser viewer and MCP tools for exploring the result.

![Atlas architecture explorer demo](https://raw.githubusercontent.com/Digital-Threads/atlas/main/docs/atlas-demo.gif)

Atlas helps answer practical questions about an unfamiliar backend:

- Which route calls which controller, service, and database table?
- Which code publishes to a Kafka topic, which consumer receives it, and what runs next?
- Which Bull queues and processors perform background work?
- Which cron jobs run, when do they start, and what do they trigger?
- What tables, columns, indexes, constraints, and migrations make up the data model?
- How do ClickHouse tables, materialized views, engines, partitions, sort keys, and TTL rules connect?
- What does delivery and runtime look like in development, staging, and production?
- How are NestJS modules and providers connected?
- Which environment variables and external APIs does the project use?
- Which services have no detected tests?
- Where are circular imports, direct database access, or incomplete route flows?

Everything runs locally. Atlas does not upload source code or collect telemetry. It
never stores values from real `.env` files or Kubernetes Secrets; safe non-secret
sample values from `.env.example` may be included as configuration documentation.

## Requirements

- Node.js 22.13 or newer
- A NestJS project written in TypeScript or JavaScript

## Installation

Once the package is published to npm, install it globally:

```bash
npm install --global @dthreads/atlas
```

You can also run Atlas without a global installation:

```bash
npx @dthreads/atlas --help
```

For local development from this repository:

```bash
git clone https://github.com/Digital-Threads/atlas.git
cd atlas
npm install
npm run build:cli
node dist/cli/index.js --help
```

## Quick start

Run Atlas from the root of a NestJS project:

```bash
atlas scan
atlas open
```

Or scan another directory:

```bash
atlas scan --path ../my-nest-app
atlas open --path ../my-nest-app
```

The scan creates a `.atlas` directory inside the analyzed project. `atlas open`
opens its static viewer in the default browser. If the browser restricts local
files, use the built-in local server:

```bash
atlas serve --path ../my-nest-app --port 4317 --open
```

Then open [http://localhost:4317](http://localhost:4317).

## Commands

### `atlas scan`

Scans a project and writes the graph, metadata, risks, report, and viewer.

```bash
atlas scan [--path <project>] [--output <directory>] [--no-cache] [--debug]
```

`--path` defaults to the current directory. `--output` defaults to `.atlas`
relative to the project root. Use `--debug` to print non-fatal analyzer warnings.
When you choose a custom output directory, pass the same `--output` value to
`open`, `serve`, `report`, and `mcp`.

Atlas keeps a local file manifest and reuses the generated architecture graph when
the supported source and configuration files have not changed. A warm scan avoids
parsing the project again. Use `--no-cache` after changing analyzer configuration or
whenever you explicitly want a complete scan:

```bash
atlas scan --path ../my-nest-app --no-cache
```

The scanner respects rules from the project's root `.gitignore`. It also skips
dependencies, generated output, caches, temporary directories, Git worktrees,
symbolic links, and its own output directory. Nested `.gitignore` files are not
currently evaluated separately.

### `atlas merge-runtime`

Merges locally observed runtime links with the static graph and regenerates the
viewer. Existing static links are marked as runtime-confirmed; newly observed links
remain clearly identified as runtime evidence.

```bash
atlas merge-runtime [--path <project>] [--output <directory>] [--input <runtime.jsonl>]
```

The default input is `<project>/.atlas/runtime.jsonl`. Payloads, request bodies,
headers, message contents, and environment values are not recorded.

### `atlas open`

Opens `<project>/.atlas/viewer/index.html` in the default browser.

```bash
atlas open [--path <project>] [--output <directory>]
```

### `atlas serve`

Serves the generated viewer on localhost. No files are sent to an external server.

```bash
atlas serve [--path <project>] [--output <directory>] [--port 4317] [--open]
```

### `atlas report`

Regenerates `.atlas/report.md` from the current graph and risk data.

```bash
atlas report [--path <project>] [--output <directory>]
```

### `atlas mcp`

Starts a Model Context Protocol server over standard input/output.

```bash
atlas mcp [--path <project>] [--output <directory>]
```

## What Atlas detects

The NestJS adapter currently detects:

- projects, folders, files, packages, and imports;
- modules, controllers, services, providers, and dependency injection;
- DI token bindings through `@Inject`, `useClass`, `useExisting`, and `useFactory`, including factory dependencies;
- `forwardRef`, `forRoot`, `forRootAsync`, `register`, and `registerAsync` module wiring;
- routes, controller methods, service methods, and method calls;
- Kafka publishers and consumers declared with `ClientKafka`, KafkaJS, `@MessagePattern`, and `@EventPattern`;
- NestJS CQRS command, query, and event bus calls linked to their handlers;
- in-process events declared with `EventEmitter2` and `@OnEvent`;
- RabbitMQ handlers declared with `@RabbitSubscribe` and `@RabbitRPC`;
- Bull and BullMQ queues, producers, processors, and jobs;
- DTO fields, types, optional flags, validation decorators, and custom NestJS decorators;
- guards, pipes, interceptors, and middleware;
- Prisma, TypeORM, Sequelize, and Drizzle tables, columns, relations, indexes, constraints, and operations;
- SQL migrations, columns, indexes, keys, constraints, and foreign-key relationships;
- ClickHouse tables, materialized views, engines, partition/order keys, and TTL rules;
- NestJS cron/interval/timeout jobs, repeatable queue jobs, and Kubernetes CronJobs;
- GitHub Actions and GitLab CI workflows, reusable workflows, actions, jobs, dependencies, images, and deploy commands;
- Dockerfiles and Compose services, health checks, dependencies, networks, volumes, configs, and Secret names;
- Kubernetes workloads, init containers, probes, services, ingress, autoscaling, volumes, ConfigMaps, Secret names, Kustomize overlays, Helm metadata, and Argo CD applications;
- environment variable contracts and safe examples, while redacting secret-like values;
- external HTTP API hosts;
- unit test relationships;
- all seven MVP architecture risks: excessive service dependencies, missing service
  tests, too many external APIs, circular imports, large controllers, direct
  controller database access, and routes with no detected service flow.

Static analysis has limits. Runtime-generated providers, reflection, and indirect
calls may not always be resolved from source alone. Every inferred graph item
includes its source and confidence. Optional runtime evidence can confirm important
paths without replacing or hiding the static evidence.

## Optional runtime evidence

Static analysis should remain the default. For local development or integration
tests, Atlas also exports a small NestJS interceptor that records route/RPC handler
transitions. It only records graph identifiers, timestamps, and counters.

```ts
import {
  createNestRuntimeInterceptor,
  RuntimeTracer,
} from "@dthreads/atlas";

const tracer = new RuntimeTracer({
  outputPath: ".atlas/runtime.jsonl",
});

app.useGlobalInterceptors(createNestRuntimeInterceptor(tracer));
```

Call `await tracer.flush()` from the application's normal shutdown hook. Internal
transitions that cannot be observed by a NestJS interceptor can be recorded
explicitly:

```ts
tracer.edge(
  "method:CheckoutService.checkout",
  "message_topic:orders.created",
  "publishes_to",
);
```

Run the application or its integration tests, then merge the observations:

```bash
atlas merge-runtime
atlas serve
```

Runtime tracing is opt-in and local. Do not commit `runtime.jsonl` when architecture
names are confidential.

## Generated files

```text
.atlas/
  cache/
    files.json      Local incremental-scan manifest
  graph.json       Typed nodes and relationships
  metadata.json    Scan time, file counts, stack evidence
  risks.json       Detected risks and recommendations
  report.md        Human-readable architecture summary
  runtime.jsonl    Optional local runtime observations
  viewer/
    index.html                    Offline architecture application
    atlas-data.js                Real scan data adapted to semantic scenes
    support.js                   Local viewer runtime
    react.production.min.js      Local UI runtime
    react-dom.production.min.js  Local UI renderer
    graph.json                   Raw typed architecture graph
```

The viewer works without a cloud backend. Deterministic scenes cover the system map,
request and asynchronous flows, complete data catalog and focused table ERD,
migrations, scheduled jobs, source files, risks, deployment, runtime topology,
environment comparison, and configuration contracts.

**Path A -> B** answers a direct architecture question without opening a giant
neighbourhood graph. Select any starting element, select a target, and Atlas renders
only the exact detected chain between them. Directed mode follows the real execution
or dependency direction; Any connection can cross an incoming relationship while
keeping every arrowhead truthful. The Overview also ranks architecture hubs by their
actual graph degree so highly influential elements are visible immediately.

Operations are deliberately separated. **Deployment** follows CI/CD jobs, Docker
build stages, images, and releases. **Runtime** follows ingress, services, workloads,
containers, ConfigMaps, and Secret names. Both switch independently between
development, staging, and production. **Environments** compares those scopes without
mixing their complete topologies into one unreadable map. Secret values are never
stored or displayed.

Large scenes use adaptive detail: off-screen elements are not rendered, distant
cards switch to a lightweight form, edge labels appear when useful, and animation
is bounded. Catalogs load in pages and remain fully searchable, so a large project
does not need thousands of DOM elements just to open one focused flow.

The interactive viewer UX reference is stored in
[`docs/design/atlas-viewer-prototype.html`](docs/design/atlas-viewer-prototype.html).
It serves as the visual design specification. Generated viewers use the same
interface with real scan results from `atlas-data.js`; no demonstration project
entities are copied into a scan.

## MCP integration

First scan the project, then configure an MCP-compatible client to launch Atlas.
For a globally installed package:

```json
{
  "mcpServers": {
    "atlas": {
      "command": "atlas",
      "args": ["mcp", "--path", "/absolute/path/to/project"]
    }
  }
}
```

Without a global installation:

```json
{
  "mcpServers": {
    "atlas": {
      "command": "npx",
      "args": ["-y", "@dthreads/atlas", "mcp", "--path", "/absolute/path/to/project"]
    }
  }
}
```

The server exposes these tools:

- `atlas_find_node`
- `atlas_get_node`
- `atlas_get_dependencies`
- `atlas_get_dependents`
- `atlas_find_path`
- `atlas_find_routes`
- `atlas_find_flow`
- `atlas_find_async_flows`
- `atlas_find_async_flow`
- `atlas_find_tables`
- `atlas_find_data_model`
- `atlas_get_table_profile`
- `atlas_find_migrations`
- `atlas_find_schedules`
- `atlas_find_delivery`
- `atlas_find_environments`
- `atlas_find_external_apis`
- `atlas_search`
- `atlas_project_summary`

The MCP server only reads the generated `.atlas/graph.json` file. It does not need a
token or network connection.

## Development

Install dependencies and run the complete check:

```bash
npm install
npm run check
```

Useful commands:

```bash
npm run dev          # public Next.js website
npm run dev:cli -- scan --path ./tests/fixtures/nest-app
npm run build:cli    # CLI and library package
npm run build:website
npm test
npm run test:performance
npm run lint
npm run typecheck
```

The tests scan a representative NestJS fixture, validate route-to-database,
publisher-to-consumer, DI-token, CQRS, runtime, migration, schedule, path, and delivery flows, exercise all 19 MCP
tools, verify architecture and deployment risks, and confirm that real secret values
never enter generated artifacts. The performance suite generates 1,000 TypeScript
files, 100 controllers, 300 services, and 1,000 routes; it also checks warm-scan
reuse, indexed graph and path queries, viewport culling, and bounded animation.

The detailed MVP requirements and their automated evidence are listed in
[`docs/PRD-COMPLIANCE.md`](docs/PRD-COMPLIANCE.md).

## Privacy and security

- Analysis and visualization are local by default.
- Environment variable names may appear in the graph. Real values and secret-like
  samples never do; safe values from `.env.example` can be shown as documentation.
- Kubernetes Secret keys may appear, but Secret values never do.
- `.env`, source files, and graph data are never uploaded by Atlas.
- The local viewer server binds to loopback only.
- There is no telemetry or account system.

Review generated artifacts before publishing them because filenames, route names,
API hosts, and source previews can still describe internal architecture.

## Contributing

Issues and pull requests are welcome. Keep changes focused, add tests for changed
analysis behavior, and run `npm run check` before opening a pull request.

## License

[MIT](LICENSE), maintained by Digital Threads.
