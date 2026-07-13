# Atlas

Architecture intelligence for NestJS codebases, maintained by
[Digital Threads](https://github.com/Digital-Threads).

Atlas is designed to answer the questions that are usually expensive to answer
in an unfamiliar backend:

- Which route calls which controller and service?
- Where does a request read or write data?
- Which modules depend on each other?
- Which environment variables and external APIs are involved?
- Where are the missing tests, circular dependencies, and risky shortcuts?

Atlas will scan a NestJS project locally, build a typed architecture graph, and
open that graph in a searchable browser interface. The graph is the source of
truth; optional AI features explain evidence already present in the graph
instead of guessing how the code works.

## Current status

Atlas is in early development. This repository currently contains the public
product website and the technical direction for the project. The scanner, CLI,
interactive graph viewer, and MCP server are not yet published as an npm
package.

You can run and contribute to the website today. The Atlas codebase scanner is
still being built.

## First release scope

- NestJS modules, controllers, services, providers, DTOs, guards, pipes, and
  interceptors.
- HTTP routes, including controller prefixes and handler methods.
- Dependency injection and method-call relationships.
- Prisma models, TypeORM entities, environment variables, external APIs, and
  test relationships.
- Risk reports for circular imports, missing tests, direct database access,
  incomplete route flows, and oversized services.
- Local JSON and Markdown reports plus a static graph viewer.
- MCP tools for querying the generated graph from compatible developer tools.

## Run the website locally

### Requirements

- Node.js 22.13 or newer.
- npm 10 or newer.

### Installation

```bash
git clone https://github.com/Digital-Threads/atlas.git
cd atlas
npm install
```

### Development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Production build

```bash
npm run build
npm start
```

## Verify changes

Run all local checks before opening a pull request:

```bash
npm run check
```

This runs ESLint, project tests, and a production Next.js build. Each check can
also be run separately:

```bash
npm run lint
npm test
npm run build
```

## Planned CLI usage

The npm package is **not yet published**. Once the first scanner release is
ready, the intended workflow will look like this:

```bash
npx @dthreads/atlas scan ./path/to/nest-project
npx @dthreads/atlas view ./path/to/nest-project
```

The scan will create a local `.atlas` directory containing the graph, metadata,
risk report, Markdown summary, and static viewer. Source code will remain local
by default.

## Repository structure

```text
app/       Next.js website and styles
public/    Static assets
tests/     Project-level tests
```

## Contributing

Issues and pull requests are welcome. Describe the problem being solved, keep
changes focused, and run `npm run check` before submitting a pull request.

## Ownership

Atlas is developed and maintained by Digital Threads.
