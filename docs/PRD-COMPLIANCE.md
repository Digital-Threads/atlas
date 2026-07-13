# Atlas MVP compliance

This document maps the implemented Atlas 0.1 surface to the product requirements.
The executable evidence is the test suite; run `npm run check` for the complete
verification or `npm run test:performance` for the scale target alone.

## MVP scope

| Requirement | Status | Evidence |
| --- | --- | --- |
| `scan`, `open`, `serve`, `report`, and `mcp` CLI commands with consistent custom output support | Complete | `src/cli/index.ts`, `tests/project.test.mjs` |
| Recursive scanner, hashes, metadata, and ignore rules | Complete | `src/scanner/file-scanner.ts`, security integration test |
| NestJS stack detection with confidence and evidence | Complete | `src/detector/stack-detector.ts`, fixture integration test |
| Adapter contract supporting future and multiple stacks | Complete | `src/adapters/adapter.ts` |
| Typed graph, integrity validation, traversal, and structured search | Complete | `src/core/graph.ts`, `tests/graph.test.mjs` |
| NestJS modules, controllers, services, providers, methods, DTOs, decorators, and routes | Complete | `src/adapters/nest-adapter.ts`, fixture integration test |
| Constructor injection, imports/exports, calls, guards, pipes, interceptors, and middleware | Complete | fixture integration test |
| Prisma models, relations, operations, reads, and writes | Complete | fixture integration test |
| Basic TypeORM entities, relations, repositories, reads, and writes | Complete | fixture integration test |
| Environment variable names without values | Complete | secret-leak assertions in `tests/project.test.mjs` |
| Supported HTTP client calls and unknown env-configured APIs | Complete | fixture integration test |
| Package dependencies, libraries, scripts, version, and package manager metadata | Complete | fixture integration test |
| Static local viewer with modes, filters, search, details, flows, source, dependencies, and dependents | Complete | generated viewer syntax/assertions and browser verification |
| Ten read-only MCP graph tools | Complete | live MCP subprocess integration test |
| Markdown report and seven architecture risk rules | Complete | `tests/risks.test.mjs`, report integration test |
| Unsupported projects produce a basic graph and warning without crashing | Complete | unsupported-project integration test |

## Acceptance and non-functional requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| Clear scan progress and output summary | Complete | progress stage assertions and CLI output |
| Graph and viewer contain no environment values or sensitive file contents | Complete | secret-leak assertions across serialized artifacts |
| Local viewer has no CDN or cloud dependency | Complete | asset and HTML URL assertions |
| Local server binds only to `127.0.0.1`, blocks traversal/symlinks, rejects malformed requests, and sends security headers | Complete | `src/server/viewer-server.ts`, `tests/server.test.mjs` |
| No account system, telemetry, upload, or analyzer network request | Complete | implementation inspection and dependency-free scan tests |
| 1,000 TS files, 100 controllers, 300 services, and 1,000 routes in under 30 seconds | Complete | `tests/performance.test.mjs` |
| Viewer payload parses and Cytoscape initializes 5,000 nodes in under 3 seconds | Complete | `tests/performance.test.mjs` |
| Linux, Windows, and macOS verification | Complete | `.github/workflows/ci.yml` |
| Public npm package release path | Complete | package metadata and `.github/workflows/publish.yml` |

## Deliberate product decision

The PRD describes an optional explanation layer. The project owner explicitly
removed that layer from Atlas 0.1. There is no sign-in, account, hosted explanation,
source upload, model configuration, or generated-analysis source type. MCP remains a
read-only protocol interface to the deterministic graph and does not change the
source of truth.

Items listed by the PRD as out of scope or future work, including additional
framework adapters, SaaS collaboration, IDE extensions, and incremental cache, are
not part of the Atlas 0.1 completion boundary.
