import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ enums */

export const relevanceEnum = pgEnum("relevance", [
  "WORKS",
  "PARTIALLY_MATCHES",
  "NOT_RELEVANT",
]);

export const caseStatusEnum = pgEnum("case_status", [
  "OPEN",
  "AWAITING_PASTE_BACK",
  "CHECK_PASSED",
  "CHECK_FAILED",
]);

export const gateDecisionEnum = pgEnum("gate_decision", [
  "PENDING",
  "GRANTED",
  "DENIED",
  "REVOKED",
]);

export const milestoneKindEnum = pgEnum("milestone_kind", [
  "IMPLEMENT_NOW",
  "DEFER",
  "CHANGES_NEEDED",
]);

export const buildStatusEnum = pgEnum("build_status", [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
]);

export const messageRoleEnum = pgEnum("message_role", ["user", "heretic", "system"]);

/* ------------------------------------------------------------------ identity */

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    handle: text("handle").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("operator"),
    deviceModel: text("device_model").notNull().default("Pixel 7 · Android 14"),
    bridgeMode: text("bridge_mode").notNull().default("browser"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sessions_token_idx").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------------ chat & voice */

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    mode: text("mode").notNull().default("text"),
    voiceEngine: text("voice_engine").notNull().default("android-native"),
    sttEngine: text("stt_engine").notNull().default("android-native"),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_user_idx").on(t.userId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    role: messageRoleEnum("role").notNull().default("user"),
    content: text("content").notNull(),
    intent: text("intent"),
    latencyMs: integer("latency_ms"),
    spoken: boolean("spoken").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId)],
);

/* ------------------------------------------------------------------ error loop */

export const errorCases = pgTable(
  "error_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ref: text("ref").notNull(),
    title: text("title").notNull(),
    rawLog: text("raw_log").notNull(),
    what: text("what").notNull(),
    why: text("why").notNull(),
    solution: text("solution").notNull(),
    formatted: text("formatted").notNull(),
    rules: text("rules").array().notNull().default([]),
    severity: text("severity").notNull().default("high"),
    confidence: integer("confidence").notNull().default(0),
    status: caseStatusEnum("status").notNull().default("OPEN"),
    pasteBack: text("paste_back"),
    verdictNote: text("verdict_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("error_cases_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------------ file assessor */

export const fileAssets = pgTable(
  "file_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    origin: text("origin").notNull().default("saf-open-document"),
    // bigint: model checkpoints routinely exceed the 2 GB integer ceiling
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
    relevance: relevanceEnum("relevance").notNull().default("WORKS"),
    usefulness: integer("usefulness").notNull().default(0),
    whyNotUseful: text("why_not_useful"),
    rationale: text("rationale").notNull(),
    integrationSteps: text("integration_steps").array().notNull().default([]),
    targetModule: text("target_module").notNull().default("app/src/main/assets/models"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("file_assets_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------------ repo tracker */

export const repositories = pgTable(
  "repositories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    remote: text("remote").notNull(),
    branch: text("branch").notNull().default("main"),
    summary: text("summary").notNull().default(""),
    health: text("health").notNull().default("ON_TRACK"),
    lastCommit: text("last_commit").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("repositories_user_idx").on(t.userId)],
);

export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    kind: milestoneKindEnum("kind").notNull().default("IMPLEMENT_NOW"),
    done: boolean("done").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("milestones_repo_idx").on(t.repoId)],
);

/* ------------------------------------------------------------------ authorization gates */

export const gates = pgTable(
  "gates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    gateKey: text("gate_key").notNull(),
    action: text("action").notNull(),
    scope: text("scope").notNull().default("this-instance-only"),
    risk: text("risk").notNull().default("medium"),
    reason: text("reason").notNull(),
    decision: gateDecisionEnum("decision").notNull().default("PENDING"),
    decidedBy: text("decided_by"),
    prevHash: text("prev_hash").notNull().default("genesis"),
    auditHash: text("audit_hash").notNull().default("genesis"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("gates_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------------ decision log */

export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ref: text("ref").notNull(),
    title: text("title").notNull(),
    context: text("context").notNull().default(""),
    options: text("options").array().notNull().default([]),
    choice: text("choice").notNull().default(""),
    reasoning: text("reasoning").notNull(),
    impact: text("impact").notNull().default(""),
    tags: text("tags").array().notNull().default([]),
    status: text("status").notNull().default("ACCEPTED"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("decisions_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------------ embedded android project */

export const androidSources = pgTable(
  "android_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    language: text("language").notNull().default("kotlin"),
    summary: text("summary").notNull().default(""),
    content: text("content").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    dirty: boolean("dirty").notNull().default(false),
    position: integer("position").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("android_sources_user_idx").on(t.userId)],
);

export const buildRuns = pgTable(
  "build_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    runNumber: integer("run_number").notNull().default(1),
    ref: text("ref").notNull().default("main"),
    trigger: text("trigger").notNull().default("workflow_dispatch"),
    status: buildStatusEnum("status").notNull().default("QUEUED"),
    gradleVersion: text("gradle_version").notNull().default("8.7"),
    jdkVersion: text("jdk_version").notNull().default("temurin-17"),
    variant: text("variant").notNull().default("assembleDebug"),
    logs: jsonb("logs").notNull().default([]),
    artifactName: text("artifact_name"),
    artifactBytes: integer("artifact_bytes").notNull().default(0),
    testsPassed: integer("tests_passed").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("build_runs_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------------ inference profiles (LiteRT) */

export const inferenceProfiles = pgTable(
  "inference_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    runtime: text("runtime").notNull().default("LiteRT 2.3.0"),
    model: text("model").notNull(),
    delegate: text("delegate").notNull().default("GPU"),
    threads: integer("threads").notNull().default(4),
    latencyMs: integer("latency_ms").notNull().default(0),
    ramMb: integer("ram_mb").notNull().default(0),
    active: boolean("active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inference_profiles_user_idx").on(t.userId)],
);

export type User = typeof users.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type ErrorCase = typeof errorCases.$inferSelect;
export type FileAsset = typeof fileAssets.$inferSelect;
export type Repository = typeof repositories.$inferSelect;
export type Milestone = typeof milestones.$inferSelect;
export type Gate = typeof gates.$inferSelect;
export type Decision = typeof decisions.$inferSelect;
export type AndroidSource = typeof androidSources.$inferSelect;
export type BuildRun = typeof buildRuns.$inferSelect;
export type InferenceProfile = typeof inferenceProfiles.$inferSelect;
