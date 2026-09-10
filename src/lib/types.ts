export type Mode = "fixture" | "live";
export type Strategy = "agent" | "baseline";
export type Status =
  | "queued"
  | "running"
  | "needs_review"
  | "ready_for_approval"
  | "approved"
  | "failed"
  | "cancelled";
export type Scenario =
  | "normal"
  | "causal"
  | "future"
  | "mismatch"
  | "unavailable"
  | "persistent";
export type Action =
  | "search_sources"
  | "compose_story"
  | "verify_content"
  | "render_cards"
  | "finish"
  | "escalate";
export interface Brief {
  place: string;
  audience: string;
  goal: string;
  cardCount: 4;
  includeFuture: true;
}
export interface Source {
  id: string;
  url: string;
  title: string;
  publisher: string;
  retrievedAt: string;
  status: "ok" | "unavailable";
  snapshot: string;
  hash: string;
  license: string;
}
export interface Evidence {
  id: string;
  sourceId: string;
  quote: string;
  locator: string;
}
export interface Claim {
  id: string;
  cardId: string;
  text: string;
  kind: "fact" | "analogy" | "imagination";
  evidenceIds: string[];
  support: "supported" | "insufficient" | "contradicted" | "not_applicable";
}
export interface Card {
  id: string;
  title: string;
  body: string;
  script: string;
  claimIds: string[];
  imagination: boolean;
}
export interface ReviewIssue {
  id: string;
  targetId: string;
  type: string;
  severity: "error" | "warning";
  message: string;
  evidenceIds: string[];
  recommendation: string;
  resolved: boolean;
}
export interface Revision {
  version: number;
  createdAt: string;
  cards: Card[];
  claims: Claim[];
  reason: string;
}
export interface Decision {
  action: Action;
  targetIds: string[];
  evidenceIds: string[];
  reasonSummary: string;
  uncertainty: string;
  blockedReason?: string;
}
export interface RunEvent {
  id: string;
  at: string;
  action: Action | "started" | "cancelled" | "approved" | "edited" | "error";
  message: string;
  version: number;
  decision?: Decision;
}
export interface Artifact {
  name: string;
  path: string;
  sha256: string;
  version: number;
  reviewVersion: number;
  kind: "png" | "zip" | "text" | "json";
}
export interface Limits {
  maxToolCalls: number;
  maxRevisions: number;
  maxDurationMs: number;
  maxModelCalls: number;
  maxCostUsd: number;
}
export interface Usage {
  toolCalls: number;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costKind: "fixture" | "estimated";
  elapsedMs?: number;
}
export interface Run {
  id: string;
  brief: Brief;
  mode: Mode;
  strategy: Strategy;
  scenario: Scenario;
  status: Status;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  attemptBaseElapsedMs?: number;
  version: number;
  reviewVersion: number | null;
  sources: Source[];
  evidence: Evidence[];
  cards: Card[];
  claims: Claim[];
  issues: ReviewIssue[];
  revisions: Revision[];
  events: RunEvent[];
  artifacts: Artifact[];
  usage: Usage;
  limits: Limits;
  approval: { version: number; at: string; reviewer: string } | null;
  stopReason: string | null;
}
export interface SourceResult {
  sources: Source[];
  evidence: Evidence[];
}
export interface AgentDeps {
  search: (
    run: Run,
    decision: Decision,
    signal: AbortSignal,
  ) => Promise<SourceResult>;
  render: (run: Run, signal: AbortSignal) => Promise<Artifact[]>;
  persist: (run: Run) => void;
  signal: AbortSignal;
  now?: () => number;
}
