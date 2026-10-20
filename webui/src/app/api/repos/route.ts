import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { milestones, repositories } from "@/db/schema";
import { evaluateRepo, type MilestoneKind } from "@/lib/engines";
import { fail, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);

  const repos = await db
    .select()
    .from(repositories)
    .where(eq(repositories.userId, ctx.user.id))
    .orderBy(desc(repositories.updatedAt));
  const items = await db
    .select()
    .from(milestones)
    .where(eq(milestones.userId, ctx.user.id))
    .orderBy(asc(milestones.position));

  return ok({
    repos: repos.map((repo) => {
      const owned = items.filter((m) => m.repoId === repo.id);
      return {
        ...repo,
        milestones: owned,
        evaluation: evaluateRepo(owned.map((m) => ({ title: m.title, kind: m.kind as MilestoneKind, done: m.done }))),
      };
    }),
  });
}

export async function POST(req: Request) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const body = await readJson<Record<string, unknown>>(req);
  const name = str(body.name);
  if (!name) return fail("Repository name is required.");

  const [repo] = await db
    .insert(repositories)
    .values({
      userId: ctx.user.id,
      name,
      remote: str(body.remote) || `github.com/heretic-ai/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      branch: str(body.branch) || "main",
      summary: str(body.summary),
      lastCommit: str(body.lastCommit) || "— no commits synced (offline workspace)",
    })
    .returning();

  const seeded = Array.isArray(body.milestones) ? (body.milestones as Record<string, unknown>[]) : [];
  for (const [position, item] of seeded.entries()) {
    await db.insert(milestones).values({
      repoId: repo.id,
      userId: ctx.user.id,
      title: str(item.title) || `Milestone ${position + 1}`,
      detail: str(item.detail),
      kind: (["IMPLEMENT_NOW", "DEFER", "CHANGES_NEEDED"].includes(str(item.kind)) ? str(item.kind) : "IMPLEMENT_NOW") as MilestoneKind,
      done: Boolean(item.done),
      position,
    });
  }

  return ok({ repo }, { status: 201 });
}
