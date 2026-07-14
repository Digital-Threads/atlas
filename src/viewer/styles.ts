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
  --inspector: 410px;
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

.toolbar {
  padding: 3px;
  gap: 3px;
  background: #111916;
  border: 1px solid #35413c;
  border-radius: 7px;
}

.toolbar button {
  border-color: transparent;
  background: transparent;
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

.graph-guide > :nth-child(n + 4) {
  display: none;
}

.graph-guide.semantic {
  grid-template-columns: repeat(var(--guide-columns, 5), minmax(0, 1fr));
  color: #53605b;
}

.graph-guide.semantic > * {
  min-width: 0;
  padding: 0 5px;
  display: block;
  line-height: 1.25;
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: center;
}

.graph-guide.semantic > :nth-child(2) {
  color: var(--ink);
}

.graph-guide.semantic > :nth-child(3) {
  color: #6e4a9e;
}

.graph-guide.semantic > :nth-child(4) {
  color: #a66708;
}

.graph-guide.semantic > :nth-child(5) {
  color: #087f6d;
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

.view-description {
  max-width: 620px;
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.4;
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

.scene-controls {
  position: absolute;
  top: 48px;
  right: 12px;
  z-index: 5;
  display: flex;
  justify-content: flex-end;
  pointer-events: none;
}

.segmented-control {
  padding: 3px;
  display: flex;
  gap: 2px;
  background: rgb(255 255 255 / 96%);
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  box-shadow: 0 4px 14px rgb(23 26 25 / 8%);
  pointer-events: auto;
}

.segmented-control button {
  height: 28px;
  padding: 0 9px;
  color: var(--muted);
  background: transparent;
  border: 0;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
}

.segmented-control button:hover {
  color: var(--ink);
  background: var(--surface);
}

.segmented-control button.active {
  color: #fff;
  background: var(--dark);
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

.graph-help {
  position: absolute;
  right: 12px;
  bottom: 52px;
  z-index: 5;
  width: 34px;
  height: 34px;
  padding: 0;
  color: var(--ink-soft);
  background: rgb(255 255 255 / 96%);
  border: 1px solid var(--line-strong);
  border-radius: 50%;
  box-shadow: 0 4px 14px rgb(23 26 25 / 10%);
  font-weight: 800;
}

.graph-help:hover,
.graph-help[aria-expanded="true"] {
  color: #fff;
  background: var(--dark);
  border-color: var(--dark);
}

.graph-help-panel {
  position: absolute;
  right: 12px;
  bottom: 94px;
  z-index: 6;
  width: min(340px, calc(100% - 24px));
  padding: 15px;
  background: #fff;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  box-shadow: var(--shadow);
}

.graph-help-heading {
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.graph-help-heading > strong {
  font-size: 14px;
}

.graph-help-heading button {
  color: var(--muted);
  background: transparent;
  border: 0;
}

.graph-help-row {
  padding: 9px 0;
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 9px;
  border-top: 1px solid var(--line);
}

.graph-help-row > b {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  color: #fff;
  background: var(--dark);
  border-radius: 50%;
  font-size: 10px;
}

.graph-help-row span,
.graph-help-row strong,
.graph-help-row small {
  display: block;
  min-width: 0;
}

.graph-help-row strong {
  font-size: 12px;
}

.graph-help-row small {
  margin-top: 2px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.45;
}

.graph-help-shortcuts {
  margin-top: 8px;
  padding: 8px 9px;
  color: var(--muted);
  background: var(--surface-soft);
  border: 1px solid var(--line);
  font-size: 10px;
  text-align: center;
}

.flow-story {
  position: absolute;
  left: 12px;
  bottom: 52px;
  z-index: 6;
  width: min(360px, calc(100% - 72px));
  max-height: min(520px, calc(100% - 122px));
  overflow: auto;
  background: rgb(255 255 255 / 97%);
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  box-shadow: var(--shadow);
}

.flow-story header {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 12px 12px 10px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  background: #fff;
  border-bottom: 1px solid var(--line);
}

.flow-story header span,
.flow-story header strong {
  display: block;
}

.flow-story header span {
  margin-bottom: 2px;
  color: var(--muted);
  font-size: 9px;
  font-weight: 800;
  text-transform: uppercase;
}

.flow-story header strong {
  max-width: 270px;
  font-size: 13px;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.flow-story header button {
  flex: 0 0 auto;
  height: 28px;
  color: var(--muted);
  background: transparent;
  border: 0;
}

.flow-story-steps {
  padding: 2px 12px;
}

.flow-story-steps button {
  width: 100%;
  padding: 8px 0;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 9px;
  color: var(--ink);
  text-align: left;
  background: transparent;
  border: 0;
  border-bottom: 1px solid #e8ecea;
}

.flow-story-steps button:hover {
  color: #176b58;
}

.flow-story-steps button > b {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  color: #fff;
  background: var(--accent);
  border-radius: 50%;
  font-size: 10px;
}

.flow-story-steps span,
.flow-story-steps strong,
.flow-story-steps small {
  display: block;
  min-width: 0;
}

.flow-story-steps strong {
  font-size: 11px;
  overflow-wrap: anywhere;
}

.flow-story-steps small {
  margin-top: 2px;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.4;
}

.flow-story-end {
  margin: 8px 12px 12px;
  padding: 9px 10px;
  color: #285044;
  background: var(--teal-soft);
  border-left: 3px solid var(--teal);
  font-size: 10px;
}

.flow-story-end strong,
.flow-story-end span {
  display: block;
}

.flow-story-end strong {
  margin-bottom: 2px;
  font-size: 9px;
  text-transform: uppercase;
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

.tooltip-kind {
  display: block;
  margin-bottom: 4px;
  color: #9fd6c6;
  font-size: 9px;
  font-weight: 800;
  text-transform: uppercase;
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

.tooltip-description {
  display: -webkit-box;
  max-width: 310px;
  overflow: hidden;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.ui-tooltip {
  width: max-content;
  max-width: 300px;
  padding: 7px 9px;
  color: #eef4f1;
  font-size: 11px;
  line-height: 1.4;
  text-align: center;
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
  gap: 12px;
  overflow: hidden;
  color: var(--muted);
  background: rgb(255 255 255 / 94%);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font-size: 10px;
  white-space: nowrap;
}

.legend-title {
  color: var(--ink);
  font-size: 9px;
  text-transform: uppercase;
}

.legend .direction-key {
  margin-left: auto;
  color: var(--ink-soft);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.legend .direction-key b {
  margin-right: 5px;
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 9px;
  text-transform: uppercase;
}

.details {
  position: relative;
  grid-column: 3;
  min-width: 0;
  width: auto;
  height: 100%;
  padding: 0;
  overflow: auto;
  background: #fbfcfb;
  border-left: 1px solid var(--line);
  box-shadow: -8px 0 24px rgb(23 26 25 / 6%);
  z-index: 15;
}

.close-button {
  position: sticky;
  top: 12px;
  float: right;
  margin: 12px 12px -46px 0;
  color: var(--ink) !important;
  background: rgb(255 255 255 / 96%) !important;
  border-color: var(--line) !important;
  box-shadow: 0 3px 10px rgb(23 26 25 / 8%);
  z-index: 20;
}

#details-content {
  min-width: 0;
}

.inspector-header {
  padding: 22px 58px 18px 22px;
  background: #fff;
  border-bottom: 1px solid var(--line);
}

.details .badge {
  max-width: 100%;
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
  margin: 9px 0 11px;
  color: var(--ink);
  font-size: 22px;
  line-height: 1.2;
  font-weight: 760;
  overflow-wrap: anywhere;
}

.path,
.source-location code {
  color: var(--muted);
  font: 11px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
  overflow-wrap: anywhere;
}

.source-location {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.source-location span {
  color: var(--subtle);
  font-size: 9px;
  font-weight: 800;
  text-transform: uppercase;
}

.source-location code {
  min-width: 0;
  padding: 3px 6px;
  overflow: hidden;
  background: var(--surface-soft);
  border: 1px solid var(--line);
  border-radius: 4px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.purpose {
  margin: 13px 0;
  color: var(--ink-soft);
}

.plain-purpose,
.flow-purpose {
  margin: 16px 22px;
  padding: 13px 14px;
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
  margin: 10px 22px 14px;
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
  margin: 16px 22px 0;
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
  margin: 14px 22px;
  padding: 11px 12px;
  color: #62450e;
  background: #fff8e7;
  border-left: 3px solid var(--yellow);
}

.detail-grid {
  margin: 0;
  padding: 12px 14px 14px;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 7px;
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

.inspector-actions {
  margin: 18px 22px 0;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--line);
}

.details .actions button,
.details a.command {
  height: 31px;
  padding: 0 9px;
  color: var(--ink);
  background: #fff;
  border-color: var(--line);
  white-space: nowrap;
}

.details .actions button:first-child {
  color: #fff;
  background: var(--dark);
  border-color: var(--dark);
}

.details .actions button:hover,
.details a.command:hover {
  color: var(--ink);
  background: var(--surface);
  border-color: var(--line-strong);
}

.details .actions button:first-child:hover {
  color: #fff;
  background: #2c3834;
}

.metadata-disclosure {
  margin: 12px 22px 0;
  background: #fff;
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.metadata-disclosure summary {
  min-height: 46px;
  padding: 8px 11px;
  display: grid;
  align-content: center;
  cursor: pointer;
  list-style-position: inside;
}

.metadata-disclosure summary span {
  margin-left: 3px;
  font-size: 11px;
  font-weight: 750;
}

.metadata-disclosure summary small {
  margin: 2px 0 0 18px;
  color: var(--muted);
  font-size: 10px;
}

.metadata-disclosure[open] summary {
  border-bottom: 1px solid var(--line);
}

.tabs {
  margin: 18px 0 0;
  padding: 0 18px;
  display: flex;
  overflow-x: auto;
  border-bottom: 1px solid var(--line);
}

.tabs button {
  flex: 0 0 auto;
  height: 33px;
  padding: 0 7px;
  color: var(--muted);
  background: transparent;
  border: 0;
  border-radius: 0;
  white-space: nowrap;
}

.tabs button span {
  min-width: 18px;
  margin-left: 4px;
  padding: 1px 4px;
  display: inline-block;
  color: var(--subtle);
  background: var(--surface);
  border-radius: 8px;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
}

.tabs button.active {
  color: var(--ink);
  border-bottom: 2px solid var(--accent);
}

.tab-panel[hidden] {
  display: none;
}

.tab-panel {
  padding: 13px 22px 28px;
}

.relations {
  display: grid;
}

.relation {
  position: relative;
  padding: 10px 28px 10px 9px;
  border-bottom: 1px solid var(--line);
  cursor: pointer;
  overflow-wrap: anywhere;
}

.relation:hover {
  color: var(--teal);
  background: #f4f8f6;
}

.relation::after {
  content: ">";
  position: absolute;
  top: 50%;
  right: 9px;
  color: var(--subtle);
  font-size: 12px;
  transform: translateY(-50%);
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

.source-toolbar {
  margin-bottom: 8px;
  padding: 8px 9px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: var(--surface-soft);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}

.source-toolbar code {
  min-width: 0;
  color: var(--muted);
  font: 10px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-toolbar .command {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
}

.source {
  max-height: 360px;
  margin: 0;
  padding: 8px 0;
  overflow: auto;
  color: #e8efec;
  background: #17201d;
  border-radius: var(--radius);
  font: 11px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: pre-wrap;
}

.source > code,
.source-line {
  display: block;
}

.source-line {
  min-height: 17px;
  padding: 0 12px 0 0;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
}

.source-line:hover {
  background: rgb(255 255 255 / 5%);
}

.source-line > i {
  padding-right: 11px;
  color: #64736d;
  font-style: normal;
  text-align: right;
  user-select: none;
}

.source-line > span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.source-line b {
  font-weight: 500;
}

.syntax-comment { color: #81958d; font-style: italic; }
.syntax-decorator { color: #e6af68; }
.syntax-string { color: #9bd0a8; }
.syntax-number { color: #e5a7a7; }
.syntax-keyword { color: #83b8e8; }

.notice {
  padding: 10px;
  color: var(--muted);
  background: var(--surface-soft);
  border: 1px solid var(--line);
}

.details h2 {
  margin: 18px 0 7px;
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
.type-message_broker { --dot: #293b75; }
.type-message_topic { --dot: #0f7895; }
.type-queue { --dot: #a66708; }
.type-processor { --dot: #6e4a9e; }

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

  .view-description {
    max-width: 390px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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

  .scene-controls {
    top: 44px;
    right: 8px;
  }

  .flow-story {
    left: 8px;
    bottom: 50px;
    width: min(340px, calc(100% - 56px));
    max-height: 46%;
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

  .graph-help {
    bottom: 12px;
  }

  .graph-help-panel {
    bottom: 54px;
  }

  .segmented-control button {
    padding: 0 7px;
  }

  .type-filters {
    max-width: 52%;
  }
}
`;
