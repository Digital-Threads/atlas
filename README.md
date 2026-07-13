# Atlas

Atlas is an architecture intelligence project for NestJS codebases. Its goal is
to turn static analysis into an explorable graph of modules, routes, services,
database access, external APIs, tests, and architectural risks.

This repository currently contains the public Atlas product website. The CLI
scanner, graph generator, interactive viewer, and MCP server described on the
site are the next implementation milestones and are not yet available in this
repository.

## Product principles

- Static analysis first.
- The graph is the source of truth.
- AI explains evidence from the graph instead of inventing architecture.
- Source code and generated artifacts stay local by default.

## Local development

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Verification

```bash
npm run lint
npm run build
npm test
```

## Project status

Atlas is at the public product-prototype stage. The website communicates the
planned MVP, while implementation of the scanner and graph tooling is still in
progress.

## License

No open-source license has been selected yet. Until a license is added, the
source is publicly visible but normal copyright rules apply.
