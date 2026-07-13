import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Architecture Intelligence Engine",
  description:
    "A local architecture intelligence engine for NestJS projects that turns static analysis into an explorable codebase graph.",
};

const graphNodes = [
  { id: "route", label: "POST /users", type: "route", x: 8, y: 42 },
  { id: "controller", label: "UsersController.create", type: "controller", x: 29, y: 26 },
  { id: "service", label: "UsersService.create", type: "service", x: 51, y: 40 },
  { id: "prisma", label: "PrismaService.user.create", type: "database", x: 72, y: 26 },
  { id: "table", label: "User table", type: "table", x: 88, y: 43 },
  { id: "dto", label: "CreateUserDto", type: "dto", x: 38, y: 67 },
  { id: "env", label: "DATABASE_URL", type: "env", x: 68, y: 70 },
  { id: "risk", label: "Missing service test", type: "risk", x: 18, y: 72 },
];

const metrics = [
  ["245", "files scanned"],
  ["512", "graph nodes"],
  ["740", "typed edges"],
  ["0", "uploads by default"],
];

const capabilities = [
  "NestJS modules, controllers, services, providers, DTOs, guards, pipes, and interceptors",
  "HTTP routes with controller prefixes and handler methods",
  "Constructor injection, imports, exports, method calls, and dependency chains",
  "Prisma models, TypeORM entities, environment variables, external APIs, tests, and package dependencies",
  "Risk detection for circular imports, missing tests, direct database access, route flow gaps, and oversized services",
];

const flowSteps = [
  "atlas scan",
  "Stack detector finds NestJS with confidence",
  "ts-morph extracts classes, decorators, methods, and injections",
  "Graph builder writes graph.json, risks.json, metadata.json, and report.md",
  "Viewer opens a searchable architecture map",
  "MCP server exposes structured graph tools to AI agents",
];

const mcpTools = [
  "atlas_find_node",
  "atlas_get_node",
  "atlas_find_flow",
  "atlas_get_dependencies",
  "atlas_find_routes",
  "atlas_project_summary",
];

export default function Home() {
  return (
    <main>
      <section className="hero-shell" aria-labelledby="hero-title">
        <nav className="topbar" aria-label="Primary">
          <a className="brand" href="#top" aria-label="Atlas home">
            <span className="brand-mark" aria-hidden="true">A</span>
            <span>Atlas</span>
          </a>
          <div className="nav-links">
            <a href="#graph">Graph</a>
            <a href="#scope">MVP</a>
            <a href="#mcp">MCP</a>
            <a href="#privacy">Privacy</a>
          </div>
          <a className="nav-action" href="#start">npx @dthreads/atlas scan</a>
        </nav>

        <div className="hero-grid" id="top">
          <div className="hero-copy">
            <p className="eyebrow">Local CLI + static viewer + MCP server</p>
            <h1 id="hero-title">Google Maps for a NestJS codebase.</h1>
            <p className="hero-lede">
              Atlas scans a project, builds an exact architecture graph, and lets
              developers explore routes, services, database access, external APIs,
              tests, and risks without reading hundreds of files first.
            </p>
            <div className="hero-actions" aria-label="Atlas commands">
              <a className="primary-button" href="#start">Start with the CLI</a>
              <a className="secondary-button" href="#graph">View graph model</a>
            </div>
            <div className="trust-row" aria-label="Product principles">
              <span>Static analysis first</span>
              <span>Graph is source of truth</span>
              <span>AI only explains</span>
            </div>
          </div>

          <div className="viewer-frame" id="graph" aria-label="Atlas viewer preview">
            <div className="viewer-toolbar">
              <div>
                <strong>demo-nest-app</strong>
                <span>NestJS detected 0.95</span>
              </div>
              <div className="toolbar-controls" aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
            <div className="viewer-body">
              <aside className="viewer-sidebar" aria-label="Graph filters">
                <label htmlFor="search">Search</label>
                <input id="search" value="UsersService" readOnly aria-label="Search query" />
                <div className="mode-list" aria-label="Modes">
                  {["Overview", "Routes", "Services", "Database", "Risks"].map((mode, index) => (
                    <span className={index === 1 ? "active" : ""} key={mode}>{mode}</span>
                  ))}
                </div>
                <div className="filter-list" aria-label="Node type filters">
                  {["Modules", "Controllers", "Services", "Routes", "Tables", "Env", "Tests"].map((filter) => (
                    <span key={filter}>{filter}</span>
                  ))}
                </div>
              </aside>
              <div className="graph-canvas" aria-label="Route flow graph">
                <svg className="edge-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M12 45 C22 38 25 32 33 30" />
                  <path d="M35 31 C44 34 46 39 54 42" />
                  <path d="M58 39 C66 34 69 30 75 29" />
                  <path d="M78 31 C83 35 86 40 90 45" />
                  <path d="M41 65 C45 56 49 49 54 44" />
                  <path d="M70 66 C70 55 70 43 74 32" />
                </svg>
                {graphNodes.map((node) => (
                  <div
                    className={`graph-node ${node.type}`}
                    key={node.id}
                    style={{ left: `${node.x}%`, top: `${node.y}%` }}
                  >
                    <span>{node.label}</span>
                  </div>
                ))}
              </div>
              <aside className="detail-panel" aria-label="Selected node details">
                <span className="type-badge">service</span>
                <h2>UsersService</h2>
                <p>src/users/users.service.ts</p>
                <dl>
                  <div><dt>Incoming</dt><dd>UsersController.create</dd></div>
                  <div><dt>Outgoing</dt><dd>PrismaService, EmailService</dd></div>
                  <div><dt>Database</dt><dd>writes User</dd></div>
                  <div><dt>Tests</dt><dd>not detected</dd></div>
                </dl>
                <div className="detail-tabs">
                  <span>Overview</span>
                  <span>Flow</span>
                  <span>Source</span>
                </div>
              </aside>
            </div>
          </div>
        </div>
      </section>

      <section className="metrics-band" aria-label="Example scan metrics">
        {metrics.map(([value, label]) => (
          <div key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </section>

      <section className="section-grid" id="scope">
        <div>
          <p className="eyebrow">MVP scope</p>
          <h2>NestJS architecture, extracted from code instead of guessed.</h2>
        </div>
        <div className="capability-list">
          {capabilities.map((item) => (
            <div className="capability" key={item}>
              <span aria-hidden="true"></span>
              <p>{item}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="product-flow" id="start">
        <div className="section-heading">
          <p className="eyebrow">Scanner pipeline</p>
          <h2>From local project to explorable graph.</h2>
        </div>
        <div className="flow-rail">
          {flowSteps.map((step, index) => (
            <div className="flow-card" key={step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{step}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="split-section">
        <div className="terminal-panel" aria-label="Atlas CLI output">
          <div className="terminal-header">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <pre>{`$ atlas scan
Atlas scan started
Scanning files...
245 files found
NestJS detected with confidence 0.95
Parsing modules, controllers, services...
Building graph...
Graph created: 512 nodes, 740 edges
Viewer created: .atlas/viewer/index.html
Done`}</pre>
        </div>
        <div>
          <p className="eyebrow">Outputs</p>
          <h2>Every artifact stays local by default.</h2>
          <p className="body-copy">
            Atlas writes graph.json, metadata.json, risks.json, report.md, and a
            static HTML viewer into .atlas. The viewer can be opened directly or
            served locally on localhost for larger graphs.
          </p>
          <div className="file-stack" aria-label="Generated files">
            {["graph.json", "metadata.json", "risks.json", "report.md", "viewer/index.html"].map((file) => (
              <span key={file}>{file}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="mcp-section" id="mcp">
        <div className="section-heading">
          <p className="eyebrow">AI integration</p>
          <h2>MCP tools query the graph; AI explains what the graph proves.</h2>
        </div>
        <div className="tool-grid">
          {mcpTools.map((tool) => (
            <code key={tool}>{tool}</code>
          ))}
        </div>
      </section>

      <section className="privacy-section" id="privacy">
        <div>
          <p className="eyebrow">Security posture</p>
          <h2>No cloud, no telemetry, no hidden uploads.</h2>
        </div>
        <p>
          Atlas is designed as a local-first architecture intelligence engine.
          Env values are never saved, AI is off by default, and source snippets
          are only sent for optional explanations when the user explicitly
          enables that mode.
        </p>
      </section>
    </main>
  );
}
