import { createRequire } from "node:module";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ArchitectureGraph, ArchitectureRisk, ScanMetadata } from "../core/types.js";
import { viewerCss, viewerLayoutCss } from "../viewer/styles.js";
import { viewerHtml, viewerJs } from "../viewer/templates.js";
import { generateReport } from "./report.js";

const require = createRequire(import.meta.url);

export async function writeOutputs(
  outputPath: string,
  graph: ArchitectureGraph,
  metadata: ScanMetadata,
  risks: ArchitectureRisk[],
): Promise<void> {
  const viewerPath = resolve(outputPath, "viewer");
  await mkdir(viewerPath, { recursive: true });
  const graphJson = `${JSON.stringify(graph, null, 2)}\n`;
  await Promise.all([
    writeFile(resolve(outputPath, "graph.json"), graphJson),
    writeFile(resolve(outputPath, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`),
    writeFile(resolve(outputPath, "risks.json"), `${JSON.stringify(risks, null, 2)}\n`),
    writeFile(resolve(outputPath, "report.md"), generateReport(graph, risks)),
    writeFile(resolve(viewerPath, "index.html"), viewerHtml),
    writeFile(resolve(viewerPath, "style.css"), viewerCss + viewerLayoutCss),
    writeFile(resolve(viewerPath, "app.js"), improveViewerNavigation(viewerJs)),
    writeFile(resolve(viewerPath, "graph.json"), graphJson),
    writeFile(resolve(viewerPath, "graph-data.js"), `window.__ATLAS_GRAPH__=${JSON.stringify(graph)};\n`),
  ]);
  const cytoscapePath = require.resolve("cytoscape/dist/cytoscape.min.js");
  await copyFile(cytoscapePath, resolve(viewerPath, "cytoscape.min.js"));
}

function improveViewerNavigation(source: string): string {
  return source
    .replace("minZoom:.2,maxZoom:2.6,wheelSensitivity:.22", "minZoom:.08,maxZoom:5,wheelSensitivity:.72")
    .replace(
      "var activeMode='Map',enabledTypes=new Set(),selectedId=null,history=[],catalogQuery='';",
      "var activeMode='Map',enabledTypes=new Set(),selectedId=null,history=[],catalogQuery='',lastGraphFocus=null;",
    )
    .replace(
      "if(['dependency','directional'].includes(layoutKind)){positionDependencyGraph(rootId,graphEdges);cy.fit(cy.nodes(),92);if(rootId)cy.getElementById(rootId).select();setTimeout(function(){cy.resize();cy.fit(cy.nodes(),92);},180);return;}",
      "lastGraphFocus={layoutKind:layoutKind,rootId:rootId};if(['dependency','directional'].includes(layoutKind)){positionDependencyGraph(rootId,graphEdges);smartFit(layoutKind,rootId);if(rootId)cy.getElementById(rootId).select();setTimeout(function(){cy.resize();smartFit(layoutKind,rootId);},180);return;}",
    )
    .replace(
      "if(layoutKind==='flow'){positionFlowGraph(rootId,graphEdges);cy.fit(cy.nodes(),92);if(rootId)cy.getElementById(rootId).select();setTimeout(function(){cy.resize();cy.fit(cy.nodes(),92);},180);return;}",
      "if(layoutKind==='flow'){positionFlowGraph(rootId,graphEdges);smartFit(layoutKind,rootId);if(rootId)cy.getElementById(rootId).select();setTimeout(function(){cy.resize();smartFit(layoutKind,rootId);},180);return;}",
    )
    .replace(
      "cy.fit(cy.nodes(),82);\n    if(rootId){var rootNode=cy.getElementById(rootId);rootNode.select();if(layoutKind==='focus'&&cy.zoom()<.5){cy.zoom(.5);cy.center(rootNode);}}\n    setTimeout(function(){cy.resize();cy.fit(cy.nodes(),82);if(rootId&&layoutKind==='focus'&&cy.zoom()<.5){cy.zoom(.5);cy.center(cy.getElementById(rootId));}},180);\n  }\n  function positionDependencyGraph",
      "smartFit(layoutKind,rootId);\n    if(rootId){var rootNode=cy.getElementById(rootId);rootNode.select();}\n    setTimeout(function(){cy.resize();smartFit(layoutKind,rootId);},180);\n  }\n  function smartFit(layoutKind,rootId){if(!cy.nodes().length)return;var focus=rootId?cy.getElementById(rootId):cy.collection(),target=focus&&focus.length?focus.closedNeighborhood().nodes():cy.nodes(),padding=layoutKind==='grid'?70:layoutKind==='map'?86:layoutKind==='flow'?78:82;if(!target.length)target=cy.nodes();cy.fit(target,padding);var minReadable=layoutKind==='map'?.72:layoutKind==='grid'?.62:.78;if(cy.nodes().length>35&&layoutKind==='grid')minReadable=.55;if(cy.zoom()<minReadable){cy.zoom({level:minReadable,renderedPosition:{x:cy.width()/2,y:cy.height()/2}});if(focus&&focus.length)cy.center(focus);else cy.center(target);}if(cy.zoom()>2.2&&cy.nodes().length>12)cy.fit(target,padding);}\n  function positionDependencyGraph",
    )
    .replace(
      "document.getElementById('fit').onclick=function(){if(cy.elements().length)cy.fit(cy.elements(),70);};\n  document.getElementById('zoom-in').onclick=function(){cy.zoom({level:cy.zoom()*1.2,renderedPosition:{x:cy.width()/2,y:cy.height()/2}});};\n  document.getElementById('zoom-out').onclick=function(){cy.zoom({level:cy.zoom()/1.2,renderedPosition:{x:cy.width()/2,y:cy.height()/2}});};",
      "document.getElementById('fit').onclick=function(){if(cy.elements().length)smartFit(lastGraphFocus&&lastGraphFocus.layoutKind||'focus',lastGraphFocus&&lastGraphFocus.rootId);};\n  document.getElementById('zoom-in').onclick=function(){cy.zoom({level:cy.zoom()*1.45,renderedPosition:{x:cy.width()/2,y:cy.height()/2}});};\n  document.getElementById('zoom-out').onclick=function(){cy.zoom({level:cy.zoom()/1.45,renderedPosition:{x:cy.width()/2,y:cy.height()/2}});};",
    );
}
