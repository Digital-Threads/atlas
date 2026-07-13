export const viewerCss = `
:root {
  --ink: #171a19;
  --ink-soft: #303633;
  --muted: #68716d;
  --subtle: #8c9591;
  --surface: #f3f5f4;
  --surface-raised: #ffffff;
  --surface-soft: #f8f9f8;
  --line: #d9dedb;
  --line-strong: #bdc6c1;
  --dark: #18211e;
  --accent: #e4572e;
  --accent-soft: #fff0eb;
  --teal: #087f6d;
  --teal-soft: #e8f5f2;
  --blue: #2f6fca;
  --violet: #7357a6;
  --red: #c73f45;
  --yellow: #a76d08;
  --focus: #3275d8;
  --shadow: 0 16px 40px rgb(23 26 25 / 12%);
  --radius: 6px;
  --topbar: 56px;
  --sidebar: 236px;
  --inspector: 380px;
}

* {
  box-sizing: border-box;
  letter-spacing: 0;
}

html,
body {
  height: 100%;
  margin: 0;
}

body {
  color: var(--ink);
  background: var(--surface);
  font: 14px/1.45 Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow: hidden;
}

button,
input {
  color: inherit;
  font: inherit;
}

button {
  cursor: pointer;
}

button:focus-visible,
input:focus-visible,
a:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

[hidden] {
  display: none !important;
}

.topbar {
  height: var(--topbar);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 14px;
  color: #fff;
  background: var(--dark);
  border-bottom: 1px solid #2d3834;
}

.identity,
.toolbar {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 8px;
}

.identity strong {
  font-size: 17px;
  font-weight: 800;
}

.identity > span {
  min-width: 0;
  color: #bdc8c3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.identity #context-label::before {
  content: "/";
  margin-right: 8px;
  color: #74817b;
}

.topbar button,
.details button,
.details a.command,
.graph-status button {
  height: 32px;
  padding: 0 10px;
  color: #fff;
  background: #24302c;
  border: 1px solid #4a5752;
  border-radius: var(--radius);
  text-decoration: none;
}

.graph-guide {
  position: absolute;
  top: 54px;
  right: 42px;
  left: 42px;
  z-index: 3;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  align-items: center;
  color: var(--muted);
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  pointer-events: none;
}

.graph-guide span:last-child {
  text-align: right;
}

.graph-guide strong {
  color: var(--ink);
  text-align: center;
}

.icon-button {
  width: 34px;
  padding: 0 !important;
  font-size: 17px;
}

.topbar button:hover {
  background: #303d38;
}

.topbar button:disabled {
  cursor: default;
  opacity: 0.35;
}

.app-shell {
  position: relative;
  height: calc(100% - var(--topbar));
  display: grid;
  grid-template-columns: var(--sidebar) minmax(0, 1fr);
  transition: grid-template-columns 160ms ease;
}

.app-shell.details-open {
  grid-template-columns: var(--sidebar) minmax(0, 1fr) var(--inspector);
}

.sidebar {
  min-width: 0;
  min-height: 0;
  padding: 14px 12px 12px;
  display: flex;
  flex-direction: column;
  background: var(--surface-raised);
  border-right: 1px solid var(--line);
  z-index: 4;
}

.search-box {
  position: relative;
}

.search-box label,
.eyebrow,
.nav-section {
  display: block;
  margin: 0 0 7px;
  color: var(--muted);
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
}

.search-box input,
.catalog input {
  width: 100%;
  height: 38px;
  padding: 0 10px;
  background: #fff;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  outline: none;
}

.search-box input:focus,
.catalog input:focus {
  border-color: #6d8f83;
  box-shadow: 0 0 0 3px #dcebe6;
}

.search-results {
  position: absolute;
  top: 67px;
  left: 0;
  width: min(520px, calc(100vw - 32px));
  max-height: 460px;
  padding: 6px;
  overflow: auto;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  z-index: 30;
}

.search-results button {
  display: block;
  width: 100%;
  padding: 10px;
  text-align: left;
  background: #fff;
  border: 0;
  border-bottom: 1px solid #edf0ee;
}

.search-results button:hover,
.search-results button:focus {
  background: var(--surface-soft);
}

.search-results strong,
.search-results small {
  display: block;
  overflow-wrap: anywhere;
}

.search-results small {
  margin-top: 3px;
  color: var(--muted);
  font-size: 11px;
}

.mode-nav {
  margin-top: 18px;
  display: grid;
  gap: 2px;
  min-height: 0;
}

.nav-section {
  margin: 15px 9px 5px;
}

.nav-section:first-child {
  margin-top: 0;
}

.mode-nav button {
  width: 100%;
  height: 36px;
  padding: 0 9px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--ink-soft);
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: var(--radius);
}

.mode-nav button:hover {
  background: var(--surface);
}

.mode-nav button.active {
  color: #8c3218;
  background: var(--accent-soft);
  box-shadow: inset 3px 0 var(--accent);
}

.mode-nav button b {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mode-nav button span {
  min-width: 26px;
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.sidebar-project {
  margin-top: auto;
  padding: 12px 8px 0;
  display: grid;
  gap: 2px;
  border-top: 1px solid var(--line);
}

.sidebar-project span {
  font-weight: 750;
}

.sidebar-project small {
  color: var(--muted);
}

.content {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.overview {
  height: 100%;
  padding: 28px clamp(22px, 3.5vw, 52px) 44px;
  overflow: auto;
  background: var(--surface);
}

.overview-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--line);
}

.overview-hero h1 {
  margin: 3px 0 5px;
  font-size: 32px;
  line-height: 1.12;
  font-weight: 760;
  overflow-wrap: anywhere;
}

.overview-hero p {
  margin: 0;
  color: var(--muted);
}

.stack-badge,
.badge {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 4px 8px;
  color: #0c6354;
  background: var(--teal-soft);
  border: 1px solid #9acdc3;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(6, minmax(88px, 1fr));
  border-bottom: 1px solid var(--line);
}

.metric {
  position: relative;
  padding: 17px 12px 17px 0;
}

.metric + .metric {
  padding-left: 18px;
  border-left: 1px solid var(--line);
}

.metric strong {
  display: block;
  font-size: 22px;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.metric span {
  display: block;
  margin-top: 5px;
  color: var(--muted);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
}

.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  column-gap: 42px;
}

.overview-section {
  min-width: 0;
  padding: 24px 0;
  border-bottom: 1px solid var(--line);
}

.overview-section.wide {
  grid-column: 1 / -1;
}

.section-heading {
  min-height: 28px;
  margin-bottom: 9px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.section-heading h2 {
  margin: 0;
  font-size: 15px;
}

.section-heading button {
  padding: 4px;
  color: var(--teal);
  background: transparent;
  border: 0;
}

.summary-list {
  display: grid;
}

.summary-row {
  width: 100%;
  min-height: 48px;
  padding: 8px 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  text-align: left;
  background: transparent;
  border: 0;
  border-top: 1px solid #e2e6e4;
}

.summary-row:hover {
  color: var(--teal);
}

.summary-row strong,
.summary-row small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-row small {
  margin-top: 2px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 400;
}

.summary-row > span:last-child {
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.method-bars {
  display: grid;
  grid-template-columns: repeat(5, minmax(74px, 1fr));
  gap: 7px;
}

.method-bar {
  min-height: 52px;
  padding: 8px 9px;
  background: #fff;
  border: 1px solid var(--line);
  border-top: 3px solid var(--method-color, #667);
  border-radius: 0 0 var(--radius) var(--radius);
}

.method-bar strong,
.method-bar span {
  display: block;
}

.method-bar span {
  margin-top: 2px;
  color: var(--muted);
  font-size: 10px;
}

.risk-high {
  color: var(--red) !important;
}

.explorer {
  min-width: 0;
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: #fff;
}

.explorer-header {
  min-width: 0;
  min-height: 76px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  overflow: hidden;
  border-bottom: 1px solid var(--line);
}

.explorer-header h1 {
  margin: 0;
  font-size: 20px;
  line-height: 1.15;
}

.type-filters {
  min-width: 0;
  max-width: 62%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  overflow-x: auto;
}

.type-filter {
  height: 30px;
  padding: 0 8px;
  color: var(--muted);
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font-size: 11px;
  white-space: nowrap;
}

.type-filter:hover {
  border-color: var(--line-strong);
}

.type-filter.active {
  color: var(--ink);
  background: var(--surface);
  border-color: #99a49f;
}

.type-filter i,
.type-dot,
.legend i {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 6px;
  background: var(--dot);
  border-radius: 50%;
}

.explorer-grid {
  width: 100%;
  min-height: 0;
  min-width: 0;
  display: grid;
  grid-template-columns: 282px minmax(0, 1fr);
}

.app-shell.details-open .catalog {
  display: none;
}

.app-shell.details-open .explorer-grid {
  grid-template-columns: minmax(0, 1fr);
}

.app-shell.map-mode .catalog {
  display: none;
}

.app-shell.map-mode .explorer-grid {
  grid-template-columns: minmax(0, 1fr);
}

.app-shell.map-mode .explorer-header {
  min-height: 64px;
}

.catalog {
  min-width: 0;
  min-height: 0;
  padding: 12px;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  background: var(--surface-soft);
  border-right: 1px solid var(--line);
}

.catalog-heading {
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.catalog-heading strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.catalog-heading span,
.catalog-footer {
  color: var(--muted);
  font-size: 11px;
}

.catalog input {
  height: 34px;
  margin-bottom: 8px;
}

.catalog-list {
  min-height: 0;
  overflow: auto;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.catalog-item {
  display: block;
  width: 100%;
  min-height: 48px;
  padding: 8px 9px;
  text-align: left;
  background: #fff;
  border: 0;
  border-bottom: 1px solid #e8ecea;
}

.catalog-item:last-child {
  border-bottom: 0;
}

.catalog-item:hover {
  background: var(--surface-soft);
}

.catalog-item.active {
  background: var(--teal-soft);
  box-shadow: inset 3px 0 var(--teal);
}

.catalog-item strong,
.catalog-item small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.catalog-item strong {
  font-size: 12px;
}

.catalog-item small {
  margin-top: 3px;
  color: var(--muted);
  font-size: 10px;
}

.catalog-footer {
  padding-top: 7px;
}

.graph-pane {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #f9faf9;
}

.graph-pane::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: radial-gradient(#d6dcda 0.8px, transparent 0.8px);
  background-size: 24px 24px;
  opacity: 0.56;
}

.graph-status {
  position: absolute;
  top: 12px;
  right: 12px;
  left: 12px;
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  pointer-events: none;
}

.graph-status span {
  max-width: 72%;
  padding: 6px 8px;
  color: var(--ink-soft);
  background: rgb(255 255 255 / 94%);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 3px 10px rgb(23 26 25 / 5%);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.graph-status button {
  color: var(--ink);
  background: #fff;
  border-color: var(--line-strong);
  pointer-events: auto;
}

#cy {
  position: absolute;
  inset: 0;
}

.empty-state {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--muted);
}

.tooltip {
  position: fixed;
  z-index: 40;
  max-width: 340px;
  padding: 10px;
  color: #fff;
  background: #17201d;
  border: 1px solid #44504b;
  border-radius: var(--radius);
  box-shadow: 0 12px 32px rgb(0 0 0 / 25%);
  font-size: 11px;
  pointer-events: none;
}

.tooltip strong {
  display: block;
  margin-bottom: 3px;
  font-size: 13px;
}

.tooltip small {
  display: block;
  margin-top: 5px;
  color: #bdc9c4;
  overflow-wrap: anywhere;
}

.legend {
  position: absolute;
  right: 12px;
  bottom: 12px;
  left: 12px;
  z-index: 2;
  max-width: calc(100% - 24px);
  padding: 6px 8px;
  display: flex;
  gap: 11px;
  overflow: hidden;
  color: var(--muted);
  background: rgb(255 255 255 / 94%);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font-size: 10px;
  white-space: nowrap;
}

.legend .direction-key {
  margin-left: auto;
  color: var(--ink-soft);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.details {
  position: relative;
  grid-column: 3;
  min-width: 0;
  width: auto;
  height: 100%;
  padding: 20px;
  overflow: auto;
  background: #fff;
  border-left: 1px solid var(--line);
  box-shadow: -8px 0 24px rgb(23 26 25 / 6%);
  z-index: 15;
}

.close-button {
  position: absolute;
  top: 14px;
  right: 14px;
  color: var(--ink) !important;
  background: #fff !important;
  border-color: var(--line) !important;
}

.details .badge {
  max-width: calc(100% - 48px);
  color: #34413c;
  background: #edf1ef;
  border-color: #d8dfdc;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: top;
}

.details h1 {
  margin: 10px 38px 5px 0;
  font-size: 21px;
  line-height: 1.18;
  overflow-wrap: anywhere;
}

.path {
  color: var(--muted);
  font: 11px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
  overflow-wrap: anywhere;
}

.purpose {
  margin: 13px 0;
  color: var(--ink-soft);
}

.plain-purpose,
.flow-purpose {
  margin: 14px 0;
  padding: 11px 12px;
  color: #253b34;
  background: #eef6f3;
  border-left: 3px solid var(--teal);
}

.plain-purpose span,
.flow-purpose span {
  display: block;
  margin-bottom: 4px;
  color: #17634f;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
}

.plain-purpose p,
.flow-purpose p {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
}

.plain-purpose small,
.flow-purpose small {
  display: block;
  margin-top: 7px;
  color: #668078;
  font-size: 10px;
}

.technical-purpose {
  margin: 10px 0 14px;
  padding-block: 8px;
  color: var(--muted);
  border-block: 1px solid var(--line);
}

.technical-purpose summary {
  color: var(--ink-soft);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.technical-purpose p {
  margin: 8px 0 2px;
  font-size: 11px;
  line-height: 1.55;
}

.architecture-summary {
  margin-top: 14px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-block: 1px solid var(--line);
}

.architecture-summary div {
  padding: 10px 8px 10px 0;
}

.architecture-summary div + div {
  padding-left: 10px;
  border-left: 1px solid var(--line);
}

.architecture-summary strong,
.architecture-summary span {
  display: block;
}

.architecture-summary strong {
  font-size: 18px;
}

.architecture-summary span {
  margin-top: 2px;
  color: var(--muted);
  font-size: 10px;
  text-transform: uppercase;
}

.recommendation {
  padding: 10px;
  color: #62450e;
  background: #fff8e7;
  border-left: 3px solid var(--yellow);
}

.detail-grid {
  margin: 14px 0;
  padding: 11px 0;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 7px;
  border-block: 1px solid var(--line);
  font-size: 12px;
}

.detail-grid span:nth-child(odd) {
  color: var(--muted);
}

.actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.details .actions button,
.details a.command {
  height: 31px;
  padding: 0 9px;
  color: var(--ink);
  background: #fff;
  border-color: var(--line-strong);
}

.details .actions button:first-child {
  color: #fff;
  background: var(--dark);
  border-color: var(--dark);
}

.tabs {
  margin: 17px 0 12px;
  display: flex;
  overflow-x: auto;
  border-bottom: 1px solid var(--line);
}

.tabs button {
  height: 33px;
  padding: 0 7px;
  color: var(--muted);
  background: transparent;
  border: 0;
  border-radius: 0;
}

.tabs button.active {
  color: var(--ink);
  border-bottom: 2px solid var(--accent);
}

.tab-panel[hidden] {
  display: none;
}

.relations {
  display: grid;
}

.relation {
  padding: 9px 2px;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
  overflow-wrap: anywhere;
}

.relation:hover {
  color: var(--teal);
}

.relation small {
  display: block;
  margin-top: 3px;
  color: var(--muted);
  font-size: 10px;
}

.relation-kind {
  display: inline-block;
  margin-right: 5px;
  color: var(--muted);
  font: 10px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
  text-transform: uppercase;
}

.source {
  max-height: 360px;
  padding: 11px;
  overflow: auto;
  color: #e8efec;
  background: #17201d;
  border-radius: var(--radius);
  font: 11px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: pre-wrap;
}

.notice {
  padding: 10px;
  color: var(--muted);
  background: var(--surface-soft);
  border: 1px solid var(--line);
}

.details h2 {
  margin: 20px 0 7px;
  color: var(--muted);
  font-size: 10px;
  text-transform: uppercase;
}

.group-count {
  color: var(--subtle);
  font-weight: 400;
}
`;

export const viewerLayoutCss = `
.type-project { --dot: #171a19; }
.type-module { --dot: #b84478; }
.type-controller { --dot: #2f6fca; }
.type-service { --dot: #7357a6; }
.type-provider { --dot: #765d97; }
.type-repository { --dot: #5068a4; }
.type-route { --dot: #e4572e; }
.type-method,
.type-function { --dot: #56635e; }
.type-database,
.type-table,
.type-model { --dot: #087f6d; }
.type-entity { --dot: #258769; }
.type-column { --dot: #5b9f87; }
.type-dto,
.type-pipe { --dot: #16798b; }
.type-external_api,
.type-risk { --dot: #c73f45; }
.type-environment_variable { --dot: #a76d08; }
.type-test { --dot: #6f7774; }
.type-file { --dot: #39433f; }
.type-folder { --dot: #66716d; }
.type-config { --dot: #8a6f3d; }
.type-library { --dot: #4e7184; }

.method-get { --method-color: #2f6fca; }
.method-post { --method-color: #087f6d; }
.method-put { --method-color: #a76d08; }
.method-patch { --method-color: #7357a6; }
.method-delete { --method-color: #c73f45; }

@media (max-width: 1240px) {
  :root {
    --sidebar: 210px;
    --inspector: 350px;
  }

  .explorer-grid {
    grid-template-columns: 250px minmax(0, 1fr);
  }

  .app-shell.details-open .catalog {
    display: none;
  }

  .app-shell.details-open .explorer-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .metrics {
    grid-template-columns: repeat(3, 1fr);
  }

  .metric:nth-child(4) {
    border-left: 0;
  }

  .method-bars {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 920px) {
  .app-shell.details-open {
    grid-template-columns: var(--sidebar) minmax(0, 1fr);
  }

  .details {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(var(--inspector), 92vw);
  }

  .overview-grid {
    grid-template-columns: 1fr;
  }

  .type-filters {
    max-width: 54%;
  }
}

@media (max-width: 760px) {
  :root {
    --topbar: 50px;
  }

  .topbar {
    padding: 0 8px;
  }

  .identity #project-name,
  .identity #context-label {
    display: none;
  }

  .app-shell,
  .app-shell.details-open {
    grid-template-columns: 1fr;
    grid-template-rows: 104px minmax(0, 1fr);
  }

  .sidebar {
    padding: 8px;
    display: grid;
    grid-template-columns: minmax(180px, 230px) minmax(0, 1fr);
    grid-template-rows: auto;
    gap: 8px;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .mode-nav {
    margin: 17px 0 0;
    display: flex;
    align-items: center;
    overflow-x: auto;
  }

  .nav-section,
  .mode-nav button span,
  .sidebar-project {
    display: none;
  }

  .mode-nav button {
    flex: 0 0 auto;
    width: auto;
  }

  .search-results {
    top: 60px;
  }

  .overview {
    padding: 22px 16px 34px;
  }

  .overview-hero {
    align-items: flex-start;
  }

  .overview-hero h1 {
    font-size: 27px;
  }

  .metrics {
    grid-template-columns: repeat(3, 1fr);
  }

  .explorer-header {
    min-height: 68px;
    padding: 9px 11px;
    align-items: flex-start;
  }

  .explorer-header h1 {
    font-size: 17px;
  }

  .type-filters {
    max-width: 58%;
  }

  .explorer-grid {
    grid-template-columns: 1fr;
    grid-template-rows: 154px minmax(0, 1fr);
  }

  .app-shell.map-mode .explorer-grid {
    grid-template-rows: minmax(0, 1fr);
  }

  .catalog,
  .app-shell.details-open .catalog {
    padding: 8px;
    display: grid;
    grid-template-columns: 160px minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    gap: 6px;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .catalog-heading,
  .catalog input {
    grid-column: 1;
    margin: 0;
  }

  .catalog-list {
    grid-column: 2;
    grid-row: 1 / 3;
    display: flex;
    overflow-x: auto;
  }

  .catalog-item {
    min-width: 210px;
    border-right: 1px solid var(--line);
    border-bottom: 0;
  }

  .catalog-footer {
    display: none;
  }

  .details {
    width: 100%;
  }
}

@media (max-width: 480px) {
  .sidebar {
    grid-template-columns: 1fr;
    grid-template-rows: 42px 46px;
  }

  .mode-nav {
    margin: 0;
  }

  .search-box label {
    display: none;
  }

  .search-results {
    top: 42px;
  }

  .overview-hero {
    display: block;
  }

  .stack-badge {
    margin-top: 12px;
  }

  .metrics {
    grid-template-columns: repeat(2, 1fr);
  }

  .metric:nth-child(3),
  .metric:nth-child(5) {
    border-left: 0;
  }

  .metric:nth-child(4) {
    border-left: 1px solid var(--line);
  }

  .explorer-grid {
    grid-template-rows: 142px minmax(0, 1fr);
  }

  .catalog,
  .app-shell.details-open .catalog {
    grid-template-columns: 132px minmax(0, 1fr);
  }

  .catalog-item {
    min-width: 190px;
  }

  .legend {
    display: none;
  }

  .type-filters {
    max-width: 52%;
  }
}
`;
