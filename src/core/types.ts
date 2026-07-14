export const graphNodeTypes = [
  "project", "folder", "file", "package", "module", "controller", "service",
  "provider", "repository", "entity", "dto", "method", "function", "route",
  "guard", "pipe", "interceptor", "middleware", "decorator", "database",
  "table", "column", "model", "environment_variable", "external_api",
  "message_broker", "message_topic", "queue", "processor",
  "config", "test", "library", "risk",
] as const;

export const graphEdgeTypes = [
  "contains", "imports", "exports", "declares", "provides", "injects", "calls",
  "uses", "reads", "writes", "handles", "depends_on", "decorates", "validates",
  "returns", "references", "connects_to", "tests", "has_method", "has_column",
  "publishes_to", "delivers_to", "enqueues", "processes",
] as const;

export type GraphNodeType = (typeof graphNodeTypes)[number];
export type GraphEdgeType = (typeof graphEdgeTypes)[number];
export type GraphSourceType =
  | "static_analysis"
  | "ast"
  | "config"
  | "package_json"
  | "heuristic"
  | "manual";

export interface SourceLocation {
  file: string;
  startLine?: number;
  endLine?: number;
}

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  name?: string;
  file?: string;
  language?: string;
  framework?: string;
  sourceLocation?: SourceLocation;
  confidence?: number;
  source?: GraphSourceType;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  type: GraphEdgeType;
  label?: string;
  confidence?: number;
  source?: GraphSourceType;
  metadata?: Record<string, unknown>;
}

export interface DetectedStack {
  name: string;
  confidence: number;
  evidence: string[];
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  byNodeType: Partial<Record<GraphNodeType, number>>;
  byEdgeType: Partial<Record<GraphEdgeType, number>>;
}

export interface ArchitectureGraph {
  version: string;
  project: {
    name: string;
    root: string;
    detectedStacks: string[];
    createdAt: string;
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
}

export interface ScannedFile {
  absolutePath: string;
  path: string;
  extension: string;
  size: number;
  hash?: string;
  lastModified: string;
}

export interface ScanMetadata {
  version: string;
  projectName: string;
  projectRoot: string;
  scanStartedAt: string;
  scanFinishedAt: string;
  durationMs: number;
  filesScanned: number;
  filesIgnored: number;
  detectedStacks: DetectedStack[];
}

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export interface ArchitectureRisk {
  id: string;
  type: string;
  severity: RiskSeverity;
  title: string;
  description: string;
  recommendation: string;
  nodeId?: string;
  file?: string;
  metadata?: Record<string, unknown>;
}

export interface GraphSubgraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphSearchResult {
  node: GraphNode;
  score: number;
  matches: string[];
}

export type ScanProgressStage =
  | "scan_files"
  | "detect_stack"
  | "parse_architecture"
  | "build_graph"
  | "detect_risks"
  | "write_outputs";

export interface ScanProgress {
  stage: ScanProgressStage;
  message: string;
}

export interface ScanOptions {
  projectPath: string;
  outputPath?: string;
  debug?: boolean;
  onProgress?: (progress: ScanProgress) => void;
}

export interface ScanResult {
  graph: ArchitectureGraph;
  metadata: ScanMetadata;
  risks: ArchitectureRisk[];
  outputPath: string;
}
