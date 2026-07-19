export const RESOURCE_KINDS = ["skill", "agent", "prompt", "mcp-server", "catalog"] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export interface AgentResource {
  id: string;
  name: string;
  kind: ResourceKind;
  description: string;
  tags: string[];
  path: string;
  details?: Readonly<Record<string, string>>;
}

export interface ScannedResource extends AgentResource {
  corpus: string;
}

export type Severity = "error" | "warning";

export interface LintIssue {
  severity: Severity;
  code: string;
  message: string;
  path: string;
  resourceId?: string;
}

export interface ScanResult {
  root: string;
  resources: ScannedResource[];
  diagnostics: LintIssue[];
  filesVisited: number;
}

export interface SearchHit {
  resource: AgentResource;
  score: number;
  matchedTerms: string[];
}

export interface ReportData {
  command: "index" | "find" | "lint";
  title: string;
  root: string;
  query?: string;
  resources?: AgentResource[];
  hits?: SearchHit[];
  issues?: LintIssue[];
  summary: Readonly<Record<string, number | string>>;
}

export type OutputFormat = "json" | "markdown" | "html";
