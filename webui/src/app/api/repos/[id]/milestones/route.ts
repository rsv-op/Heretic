import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { milestones, repositories } from "@/db/schema";
import { evaluateRepo, type MilestoneKind } from "@/lib/engines";
import { isUuid, fail, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const KINDS: MilestoneKind[] = ["IMPLEMENT_NOW", "DEFER", "CHANGES_NEEDED"];

async function refreshHealth(repoId: string, userId: string) {
  const items = await db.select().from(milestones).where(eq(milestones.repoId, repoId));
  const evaluation = evaluateRepo(items.map((m) => ({ title: m.title, kind: m.kind as MilestoneKind, done: m.done })));
  await db
    .update(repositories)
    .set({ health: evaluation.health, updatedAt: new Date() })
    .where(eq(repositories.id, repoId));
  return evaluation;
}

export async function GET(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const items = await db.select().from(milestones).where(eq(milestones.repoId, id)).orderBy(asc(milestones.position));
  return ok({ milestones: items });
}

export async function POST(req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);

  const repoRows = await db.select().from(repositories).where(eq(repositories.id, id)).limit(1);
  const repo = repoRows[0];
  if (!repo || repo.userId !== ctx.user.id) return fail("Repository not found", 404);

  const body = await readJson<Record<string, unknown>>(req);
  const title = str(body.title);
  if (!title) return fail("Milestone title is required.");
  const kind = (KINDS.includes(str(body.kind) as MilestoneKind) ? str(body.kind) : "IMPLEMENT_NOW") as MilestoneKind;

  const existing = await db.select({ position: milestones.position }).from(milestones).where(eq(milestones.repoId, repo.id));

  const [created] = await db
    .insert(milestones)
    .values({
      repoId: repo.id,
      userId: ctx.user.id,
      title,
      detail: str(body.detail),
      kind,
      done: Boolean(body.done),
      position: existing.length ? Math.max(...existing.map((e) => e.position)) + 1 : 0,
    })
    .returning();

  const evaluation = await refreshHealth(repo.id, ctx.user.id);
  return ok({ milestone: created, evaluation }, { status: 201 });
}
