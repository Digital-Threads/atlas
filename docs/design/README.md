# Atlas viewer design specification

`atlas-viewer-prototype.html` is the interactive UX reference for the generated
Atlas viewer. It works offline and contains demonstration data so design and
product decisions can be reviewed without scanning a project.

The production viewer uses the matching shell in `assets/viewer` and the data
adapter in `src/viewer/data.ts`. Production scenes use `atlas-data.js` generated
from the current scan; identifiers, counts, relationships, descriptions, flows,
and risks from the prototype are never copied as real scan results.

The specification defines these interaction rules:

- the System map exposes every detected module and all detected async runtime,
  data-store, and external-system components;
- module scenes explain triggers, operations, dependencies, and effects;
- selecting an operation isolates its dependency/effect chain and a second
  selection opens its detected full flow;
- request and async scenes use numbered steps and state where the flow ends;
- service and data scenes separate incoming and outgoing relationships;
- file scenes explain users, declarations, code dependencies, and effects;
- risk scenes separate the finding, affected code, impact, and remediation;
- semantic scenes can always switch to the underlying technical graph;
- source previews include locations, line numbers, and syntax highlighting;
- the inspector keeps plain-language purpose visible while technical metadata
  and source remain available on demand.

When the scanner gains a new node or edge type, add it to the production scene
adapter first, then extend this document if the interaction model changes.
