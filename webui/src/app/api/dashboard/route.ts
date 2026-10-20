import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  androidSources,
  buildRuns,
  conversations,
  decisions,
  errorCases,
  fileAssets,
  gates,
  inferenceProfiles,
  messages,
  milestones,
  repositories,
} from "@/db/schema";
import { fail, ok, requireUser } from "@/lib/http";
import { evaluateRepo } from "@/lib/engines";
import { auditHash } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const userId = ctx.user.id;

  const [
    convoCount,
    msgCount,
    errRows,
    fileRows,
    repoRows,
    milestoneRows,
    gateRows,
    decisionRows,
    sourceCount,
    profileRows,
    latestBuild,
  ] = await Promise.all([
    db.select({ value: sql<number>`count(*)::int` }).from(conversations).where(eq(conversations.userId, userId)),
    db.select({ value: sql<number>`count(*)::int` }).from(messages).where(eq(messages.userId, userId)),
    db.select().from(errorCases).where(eq(errorCases.userId, userId)),
    db.select().from(fileAssets).where(eq(fileAssets.userId, userId)),
    db.select().from(repositories).where(eq(repositories.userId, userId)),
    db.select().from(milestones).where(eq(milestones.userId, userId)),
    db.select().from(gates).where(eq(gates.userId, userId)).orderBy(gates.createdAt),
    db.select().from(decisions).where(eq(decisions.userId, userId)),
    db.select({ value: sql<number>`count(*)::int` }).from(androidSources).where(eq(androidSources.userId, userId)),
    db.select().from(inferenceProfiles).where(eq(inferenceProfiles.userId, userId)),
    db.select().from(buildRuns).where(eq(buildRuns.userId, userId)).orderBy(desc(buildRuns.createdAt)).limit(1),
  ]);

  const repoEvaluations = repoRows.map((repo) => ({
    repo,
    evaluation: evaluateRepo(
      milestoneRows
        .filter((m) => m.repoId === repo.id)
        .map((m) => ({ title: m.title, kind: m.kind, done: m.done })),
    ),
  }));

  // Re-walk the authorization hash chain exactly like AuthorizationGate.verify() does.
  let prev = "genesis";
  let brokenAt = -1;
  gateRows.forEach((gate, index) => {
    if (brokenAt >= 0) return;
    if (gate.prevHash !== prev) {
      brokenAt = index;
      return;
    }
    prev = gate.auditHash;
  });
  void auditHash;

  const recentMessages = await db
    .select({
      id: messages.id,
      content: messages.content,
      role: messages.role,
      createdAt: messages.createdAt,
      title: conversations.title,
      conversationId: messages.conversationId,
    })
    .from(messages)
    .innerJoin(conversations, and(eq(conversations.id, messages.conversationId), eq(conversations.userId, userId)))
    .orderBy(desc(messages.createdAt))
    .limit(6);

  return ok({
    counters: {
      conversations: convoCount[0]?.value ?? 0,
      messages: msgCount[0]?.value ?? 0,
      errorCases: errRows.length,
      openErrors: errRows.filter((e) => e.status === "OPEN" || e.status === "AWAITING_PASTE_BACK").length,
      passedErrors: errRows.filter((e) => e.status === "CHECK_PASSED").length,
      failedErrors: errRows.filter((e) => e.status === "CHECK_FAILED").length,
      files: fileRows.length,
      filesWorks: fileRows.filter((f) => f.relevance === "WORKS").length,
      filesPartial: fileRows.filter((f) => f.relevance === "PARTIALLY_MATCHES").length,
      filesRejected: fileRows.filter((f) => f.relevance === "NOT_RELEVANT").length,
      repos: repoRows.length,
      milestones: milestoneRows.length,
      milestonesDone: milestoneRows.filter((m) => m.done).length,
      gates: gateRows.length,
      gatesGranted: gateRows.filter((g) => g.decision === "GRANTED").length,
      gatesDenied: gateRows.filter((g) => g.decision === "DENIED").length,
      gatesPending: gateRows.filter((g) => g.decision === "PENDING").length,
      decisions: decisionRows.length,
      androidSources: sourceCount[0]?.value ?? 0,
      profiles: profileRows.length,
    },
    repos: repoEvaluations.map((r) => ({
      id: r.repo.id,
      name: r.repo.name,
      branch: r.repo.branch,
      health: r.evaluation.health,
      progress: r.evaluation.progress,
      nextAction: r.evaluation.nextAction,
    })),
    audit: {
      entries: gateRows.length,
      chainIntact: brokenAt === -1,
      brokenAt,
      head: gateRows[gateRows.length - 1]?.auditHash ?? "genesis",
    },
    inference: profileRows.map((p) => ({
      id: p.id,
      name: p.name,
      runtime: p.runtime,
      delegate: p.delegate,
      latencyMs: p.latencyMs,
      ramMb: p.ramMb,
      active: p.active,
    })),
    latestBuild: latestBuild[0]
      ? {
          id: latestBuild[0].id,
          runNumber: latestBuild[0].runNumber,
          status: latestBuild[0].status,
          artifactName: latestBuild[0].artifactName,
          testsPassed: latestBuild[0].testsPassed,
          createdAt: latestBuild[0].createdAt.toISOString(),
        }
      : null,
    activity: [
      ...recentMessages.map((m) => ({
        id: m.id,
        kind: "chat" as const,
        title: m.title,
        detail: m.content.slice(0, 120),
        at: m.createdAt.toISOString(),
        href: `/dashboard/chat?c=${m.conversationId}`,
      })),
      ...errRows.slice(0, 4).map((e) => ({
        id: e.id,
        kind: "error" as const,
        title: `${e.ref} · ${e.title}`,
        detail: e.status.replace(/_/g, " "),
        at: e.updatedAt.toISOString(),
        href: "/dashboard/errors",
      })),
      ...decisionRows.slice(0, 3).map((d) => ({
        id: d.id,
        kind: "decision" as const,
        title: `${d.ref} · ${d.title}`,
        detail: d.choice,
        at: d.createdAt.toISOString(),
        href: "/dashboard/decisions",
      })),
    ]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 10),
  });
}
