import type { DetectedStack, GraphEdge, GraphNode, ScannedFile } from "../core/types.js";

export interface AdapterContext {
  projectRoot: string;
  files: ScannedFile[];
  detectedStacks: DetectedStack[];
  debug?: boolean;
}

export interface AdapterResult {
  nodes: GraphNode[];
  edges: Array<Omit<GraphEdge, "id"> & { id?: string }>;
  warnings: string[];
}

export interface ArchitectureAdapter {
  readonly name: string;
  detect(context: AdapterContext): Promise<boolean>;
  scan(context: AdapterContext): Promise<AdapterResult>;
}
