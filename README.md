# Atlas

Atlas is a local architecture intelligence engine for NestJS projects, developed by
[Digital Threads](https://github.com/Digital-Threads). It scans source code, builds a
typed graph of the application, highlights architectural risks, and provides a
browser viewer and MCP tools for exploring the result.

Atlas helps answer practical questions about an unfamiliar backend:

- Which route calls which controller, service, and database table?
- Which code publishes to a Kafka topic, which consumer receives it, and what runs next?
- Which Bull queues and processors perform background work?
- How are NestJS modules and providers connected?
- Which environment variables and external APIs does the project use?
- Which services have no detected tests?
- Where are circular imports, direct database access, or incomplete route flows?

Everything runs locally. Atlas does not upload source code, collect telemetry, or
store environment variable values.

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
atlas scan [--path <project>] [--output <directory>] [--debug]
```

`--path` defaults to the current directory. `--output` defaults to `.atlas`
relative to the project root. Use `--debug` to print non-fatal analyzer warnings.
When you choose a custom output directory, pass the same `--output` value to
`open`, `serve`, `report`, and `mcp`.

The scanner respects rules from the project's root `.gitignore`. It also skips
dependencies, generated output, caches, temporary directories, Git worktrees,
symbolic links, and its own output directory. Nested `.gitignore` files are not
currently evaluated separately.

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
- routes, controller methods, service methods, and method calls;
- Kafka publishers and consumers declared with `ClientKafka`, `@MessagePattern`, and `@EventPattern`;
- Bull queues, producers, processors, and jobs declared with `@InjectQueue`, `@Processor`, and `@Process`;
- DTO fields, types, optional flags, validation decorators, and custom NestJS decorators;
- guards, pipes, interceptors, and middleware;
- Prisma models and operations;
- TypeORM entities, columns, relations, repositories, and read/write operations;
- environment variable names, without their values;
- external HTTP API hosts;
- unit test relationships;
- all seven MVP architecture risks: excessive service dependencies, missing service
  tests, too many external APIs, circular imports, large controllers, direct
  controller database access, and routes with no detected service flow.

Static analysis has limits. Dynamic modules, runtime-generated providers, reflection,
and indirect calls may not always be resolved. Every inferred graph item includes its
source and confidence so consumers can distinguish evidence from inference.

## Generated files

```text
.atlas/
  graph.json       Typed nodes and relationships
  metadata.json    Scan time, file counts, stack evidence
  risks.json       Detected risks and recommendations
  report.md        Human-readable architecture summary
  viewer/
    index.html     Static graph application
    app.js
    style.css
    cytoscape.min.js
    graph.json
    graph-data.js
```

The viewer works without a cloud backend. Its System map shows every detected
module together with Kafka topics, queues, processors, consumers, data stores,
and external systems. Deterministic scenes explain module responsibilities,
incoming and outgoing service relationships, file roles, numbered HTTP and
asynchronous flows, source previews, risks, and where each detected flow ends.

The interactive viewer UX reference is stored in
[`docs/design/atlas-viewer-prototype.html`](docs/design/atlas-viewer-prototype.html).
It uses demonstration data and serves as a design specification; generated
viewers always use the real scan result from `graph-data.js`.

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
- `atlas_find_routes`
- `atlas_find_flow`
- `atlas_find_async_flows`
- `atlas_find_async_flow`
- `atlas_find_tables`
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

The tests scan a representative NestJS fixture, validate route-to-database and
publisher-to-consumer flows, exercise all twelve MCP tools, verify all seven risk rules, and confirm that environment
values never enter generated artifacts. The performance test generates 1,000
TypeScript files, 100 controllers, 300 services, and 1,000 routes.

The detailed MVP requirements and their automated evidence are listed in
[`docs/PRD-COMPLIANCE.md`](docs/PRD-COMPLIANCE.md).

## Privacy and security

- Analysis and visualization are local by default.
- Environment variable names may appear in the graph; values never do.
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
