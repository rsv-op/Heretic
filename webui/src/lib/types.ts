export interface ConversationRow {
  id: string;
  title: string;
  mode: string;
  sttEngine: string;
  voiceEngine: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  turnCount?: number;
  lastMessage?: string | null;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  role: "user" | "heretic" | "system";
  content: string;
  intent: string | null;
  latencyMs: number | null;
  spoken: boolean;
  createdAt: string;
}

export type CaseStatus = "OPEN" | "AWAITING_PASTE_BACK" | "CHECK_PASSED" | "CHECK_FAILED";

export interface ErrorCaseRow {
  id: string;
  ref: string;
  title: string;
  rawLog: string;
  what: string;
  why: string;
  solution: string;
  formatted: string;
  rules: string[];
  severity: "critical" | "high" | "medium" | "low";
  confidence: number;
  status: CaseStatus;
  pasteBack: string | null;
  verdictNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RelevanceEnum = "WORKS" | "PARTIALLY_MATCHES" | "NOT_RELEVANT";

export interface FileAssetRow {
  id: string;
  fileName: string;
  origin: string;
  sizeBytes: number;
  relevance: RelevanceEnum;
  usefulness: number;
  whyNotUseful: string | null;
  rationale: string;
  integrationSteps: string[];
  targetModule: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MilestoneKind = "IMPLEMENT_NOW" | "DEFER" | "CHANGES_NEEDED";

export interface MilestoneRow {
  id: string;
  repoId: string;
  title: string;
  detail: string;
  kind: MilestoneKind;
  done: boolean;
  position: number;
  createdAt: string;
}

export interface RepoEvaluation {
  progress: number;
  health: string;
  counts: Record<MilestoneKind, number>;
  done: number;
  total: number;
  blockers: string[];
  nextAction: string;
  verdict: string;
}

export interface RepoRow {
  id: string;
  name: string;
  remote: string;
  branch: string;
  summary: string;
  health: string;
  lastCommit: string;
  createdAt: string;
  updatedAt: string;
  milestones: MilestoneRow[];
  evaluation: RepoEvaluation;
}

export type GateDecision = "PENDING" | "GRANTED" | "DENIED" | "REVOKED";

export interface GateRow {
  id: string;
  gateKey: string;
  action: string;
  scope: string;
  risk: string;
  reason: string;
  decision: GateDecision;
  decidedBy: string | null;
  prevHash: string;
  auditHash: string;
  createdAt: string;
  decidedAt: string | null;
}

export interface DecisionRow {
  id: string;
  ref: string;
  title: string;
  context: string;
  options: string[];
  choice: string;
  reasoning: string;
  impact: string;
  tags: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
  wordCount?: number;
}

export interface SourceRow {
  id: string;
  path: string;
  language: string;
  summary: string;
  content: string;
  sizeBytes: number;
  dirty: boolean;
  position: number;
  updatedAt: string;
}

export interface BuildLogLine {
  t: number;
  step: string;
  line: string;
}

export interface BuildRunRow {
  id: string;
  runNumber: number;
  ref: string;
  trigger: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
  gradleVersion: string;
  jdkVersion: string;
  variant: string;
  logs: BuildLogLine[];
  artifactName: string | null;
  artifactBytes: number;
  testsPassed: number;
  durationMs: number;
  createdAt: string;
}

export interface ProfileRow {
  id: string;
  name: string;
  runtime: string;
  model: string;
  delegate: string;
  threads: number;
  latencyMs: number;
  ramMb: number;
  active: boolean;
  createdAt: string;
}

export interface DashboardPayload {
  counters: Record<string, number>;
  repos: { id: string; name: string; branch: string; health: string; progress: number; nextAction: string }[];
  audit: { entries: number; chainIntact: boolean; brokenAt: number; head: string };
  inference: { id: string; name: string; runtime: string; delegate: string; latencyMs: number; ramMb: number; active: boolean }[];
  latestBuild: {
    id: string;
    runNumber: number;
    status: string;
    artifactName: string | null;
    testsPassed: number;
    createdAt: string;
  } | null;
  activity: { id: string; kind: string; title: string; detail: string; at: string; href: string }[];
}
