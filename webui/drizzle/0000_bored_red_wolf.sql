CREATE TYPE "public"."build_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('OPEN', 'AWAITING_PASTE_BACK', 'CHECK_PASSED', 'CHECK_FAILED');--> statement-breakpoint
CREATE TYPE "public"."gate_decision" AS ENUM('PENDING', 'GRANTED', 'DENIED', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'heretic', 'system');--> statement-breakpoint
CREATE TYPE "public"."milestone_kind" AS ENUM('IMPLEMENT_NOW', 'DEFER', 'CHANGES_NEEDED');--> statement-breakpoint
CREATE TYPE "public"."relevance" AS ENUM('WORKS', 'PARTIALLY_MATCHES', 'NOT_RELEVANT');--> statement-breakpoint
CREATE TABLE "android_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"path" text NOT NULL,
	"language" text DEFAULT 'kotlin' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"content" text NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"dirty" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "build_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"run_number" integer DEFAULT 1 NOT NULL,
	"ref" text DEFAULT 'main' NOT NULL,
	"trigger" text DEFAULT 'workflow_dispatch' NOT NULL,
	"status" "build_status" DEFAULT 'QUEUED' NOT NULL,
	"gradle_version" text DEFAULT '8.7' NOT NULL,
	"jdk_version" text DEFAULT 'temurin-17' NOT NULL,
	"variant" text DEFAULT 'assembleDebug' NOT NULL,
	"logs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"artifact_name" text,
	"artifact_bytes" integer DEFAULT 0 NOT NULL,
	"tests_passed" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"mode" text DEFAULT 'text' NOT NULL,
	"voice_engine" text DEFAULT 'android-native' NOT NULL,
	"stt_engine" text DEFAULT 'android-native' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"title" text NOT NULL,
	"context" text DEFAULT '' NOT NULL,
	"options" text[] DEFAULT '{}' NOT NULL,
	"choice" text DEFAULT '' NOT NULL,
	"reasoning" text NOT NULL,
	"impact" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'ACCEPTED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "error_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ref" text NOT NULL,
	"title" text NOT NULL,
	"raw_log" text NOT NULL,
	"what" text NOT NULL,
	"why" text NOT NULL,
	"solution" text NOT NULL,
	"formatted" text NOT NULL,
	"rules" text[] DEFAULT '{}' NOT NULL,
	"severity" text DEFAULT 'high' NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL,
	"status" "case_status" DEFAULT 'OPEN' NOT NULL,
	"paste_back" text,
	"verdict_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"origin" text DEFAULT 'saf-open-document' NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"relevance" "relevance" DEFAULT 'WORKS' NOT NULL,
	"usefulness" integer DEFAULT 0 NOT NULL,
	"why_not_useful" text,
	"rationale" text NOT NULL,
	"integration_steps" text[] DEFAULT '{}' NOT NULL,
	"target_module" text DEFAULT 'app/src/main/assets/models' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"gate_key" text NOT NULL,
	"action" text NOT NULL,
	"scope" text DEFAULT 'this-instance-only' NOT NULL,
	"risk" text DEFAULT 'medium' NOT NULL,
	"reason" text NOT NULL,
	"decision" "gate_decision" DEFAULT 'PENDING' NOT NULL,
	"decided_by" text,
	"prev_hash" text DEFAULT 'genesis' NOT NULL,
	"audit_hash" text DEFAULT 'genesis' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inference_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"runtime" text DEFAULT 'LiteRT 2.3.0' NOT NULL,
	"model" text NOT NULL,
	"delegate" text DEFAULT 'GPU' NOT NULL,
	"threads" integer DEFAULT 4 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"ram_mb" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "message_role" DEFAULT 'user' NOT NULL,
	"content" text NOT NULL,
	"intent" text,
	"latency_ms" integer,
	"spoken" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"kind" "milestone_kind" DEFAULT 'IMPLEMENT_NOW' NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"remote" text NOT NULL,
	"branch" text DEFAULT 'main' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"health" text DEFAULT 'ON_TRACK' NOT NULL,
	"last_commit" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"handle" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'operator' NOT NULL,
	"device_model" text DEFAULT 'Pixel 7 · Android 14' NOT NULL,
	"bridge_mode" text DEFAULT 'browser' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "android_sources" ADD CONSTRAINT "android_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_runs" ADD CONSTRAINT "build_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "error_cases" ADD CONSTRAINT "error_cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gates" ADD CONSTRAINT "gates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inference_profiles" ADD CONSTRAINT "inference_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_repo_id_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "android_sources_user_idx" ON "android_sources" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "build_runs_user_idx" ON "build_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "decisions_user_idx" ON "decisions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "error_cases_user_idx" ON "error_cases" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "file_assets_user_idx" ON "file_assets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "gates_user_idx" ON "gates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "inference_profiles_user_idx" ON "inference_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "milestones_repo_idx" ON "milestones" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "repositories_user_idx" ON "repositories" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");