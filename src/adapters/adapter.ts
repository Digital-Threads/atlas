import type { DetectedStack, GraphEdge, GraphNode, ScannedFile } from "../core/types.js";

export interface AdapterContext {
  projectRoot: string;
  files: ScannedFile[];
  detectedStacks: DetectedStack[];
  readFile: (file: ScannedFile) => Promise<string>;
  debug?: boolean;
}

export interface AdapterResult {
  nodes: GraphNode[];
  edges: Array<Omit<GraphEdge, "id"> & { id?: string }>;
  warnings: string[];
}

export interface AdapterDetectionResult {
  detected: boolean;
  confidence: number;
  evidence: string[];
}

export interface ArchitectureAdapter {
  readonly name: string;
  detect(context: AdapterContext): Promise<AdapterDetectionResult>;
  scan(context: AdapterContext): Promise<AdapterResult>;
  buildNodes(result: AdapterResult): Promise<GraphNode[]>;
  buildEdges(result: AdapterResult): Promise<AdapterResult["edges"]>;
}
