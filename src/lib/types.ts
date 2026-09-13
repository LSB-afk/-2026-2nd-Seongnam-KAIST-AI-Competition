export type Mode = "fixture" | "live";
export type CreationPurpose = "place_intro" | "visit_guide" | "youth_story";
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
  placeId?: string;
  purpose?: CreationPurpose;
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
  publishedAt?: string;
  modifiedAt?: string;
  searchIds?: string[];
}
export interface Evidence {
  id: string;
  sourceId: string;
  quote: string;
  locator: string;
  searchId?: string;
  targetClaimIds?: string[];
  start?: number;
  end?: number;
}
export interface SearchIntent {
  query: string;
  targetClaimIds: string[];
  missingInformation: string[];
  reason: string;
}
export interface SearchRecord extends SearchIntent {
  id: string;
  at: string;
  version: number;
  visitedPages: number;
  newEvidenceCount: number;
  evidenceIds: string[];
  resolvedClaimIds: string[];
  remainingInformation: string[];
  errors: string[];
}
export interface ClaimAssessment {
  id: string;
  claimId: string;
  cardId: string;
  field: "title" | "body" | "script";
  text: string;
  verdict: "supported" | "contradicted" | "insufficient";
  evidenceIds: string[];
  rationale: string;
  action: "keep" | "search" | "revise" | "delete" | "human_review";
  start?: number;
  end?: number;
  freshness?: "stable" | "current" | "unverified" | "outdated" | "conflicting";
  citations?: {
    evidenceId: string;
    sourceId: string;
    quote: string;
    relation: "supports" | "contradicts" | "context";
    explanation: string;
  }[];
}
export interface ReviewSnapshot {
  version: number;
  at: string;
  sourceSnapshotIds: string[];
  assessments: ClaimAssessment[];
  issues: ReviewIssue[];
}
export interface ModelCallRecord {
  id: string;
  at: string;
  model: string;
  promptVersion: string;
  status: "reserved" | "succeeded" | "failed";
  reservedCostUsd: number;
  costUsd: number;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}
export interface ProposedChange {
  cardId: string;
  expectedVersion: number;
  before: Card;
  after: Card;
  claims: Claim[];
  reason: string;
  evidenceIds: string[];
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
  image?: CardImage;
}
export interface ImageAsset {
  id: string;
  placeId: string;
  kind: "photo" | "upload" | "ai";
  src: string;
  sha256: string;
  width: number;
  height: number;
  mime: "image/jpeg" | "image/png" | "image/webp";
  sourceUrl: string;
  author: string;
  license: string;
  licenseUrl: string;
  createdAt: string;
  prompt?: ImagePrompt;
  reference?: Pick<ImageAsset, "id" | "placeId" | "sha256" | "sourceUrl" | "author" | "license" | "licenseUrl">;
}
export interface CardImage extends ImageAsset {
  crop: { x: number; y: number; zoom: number };
}
export interface ImagePrompt {
  place: string;
  subject: string;
  composition: string;
  lighting: string;
  palette: string;
  materials: string;
  referenceImage: string | null;
  textSpace: string;
  imagination: boolean;
}
export interface ImageJob {
  id: string;
  cardId: string;
  expectedVersion: number;
  status: "running" | "succeeded" | "failed" | "cancelled";
  prompt: ImagePrompt;
  startedAt: string;
  baseElapsedMs?: number;
  error?: string;
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
  origin?: "model" | "human";
  evidenceIds?: string[];
}
export interface Decision {
  action: Action;
  targetIds: string[];
  evidenceIds: string[];
  reasonSummary: string;
  uncertainty: string;
  blockedReason?: string;
  search?: SearchIntent | null;
  expectedVersion?: number;
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
  searches?: SearchRecord[];
  assessments?: ClaimAssessment[];
  reviews?: ReviewSnapshot[];
  automaticRevisions?: number;
  protectedCardIds?: string[];
  proposedChanges?: ProposedChange[];
  execution?: {
    model: string | null;
    promptVersion: string;
    reviewRulesVersion: string;
    sourceSnapshotIds: string[];
    apiCalls: number;
  };
  modelCallLog?: ModelCallRecord[];
  imageJob?: ImageJob;
}
export interface SourceResult {
  sources: Source[];
  evidence: Evidence[];
  search?: SearchRecord;
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
