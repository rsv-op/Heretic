import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { milestones, repositories } from "@/db/schema";
import { evaluateRepo, type MilestoneKind } from "@/lib/engines";
import { isUuid, fail, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const KINDS: MilestoneKind[] = ["IMPLEMENT_NOW", "DEFER", "CHANGES_NEEDED"];

async function refreshHealth(repoId: string) {
  const items = await db.select().from(milestones).where(eq(milestones.repoId, repoId)).orderBy(asc(milestones.position));
  const evaluation = evaluateRepo(items.map((m) => ({ title: m.title, kind: m.kind as MilestoneKind, done: m.done })));
  await db.update(repositories).set({ health: evaluation.health, updatedAt: new Date() }).where(eq(repositories.id, repoId));
  return evaluation;
}

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);

  const rows = await db.select().from(milestones).where(eq(milestones.id, id)).limit(1);
  const milestone = rows[0];
  if (!milestone || milestone.userId !== ctx.user.id) return fail("Milestone not found", 404);

  const body = await readJson<Record<string, unknown>>(req);
  const kind = body.kind !== undefined && KINDS.includes(str(body.kind) as MilestoneKind) ? (str(body.kind) as MilestoneKind) : milestone.kind;

  const [updated] = await db
    .update(milestones)
    .set({
      title: str(body.title) || milestone.title,
      detail: body.detail === undefined ? milestone.detail : str(body.detail),
      kind,
      done: typeof body.done === "boolean" ? body.done : milestone.done,
      position: typeof body.position === "number" ? body.position : milestone.position,
    })
    .where(eq(milestones.id, milestone.id))
    .returning();

  const evaluation = await refreshHealth(milestone.repoId);
  return ok({ milestone: updated, evaluation });
}

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);

  const rows = await db.select().from(milestones).where(eq(milestones.id, id)).limit(1);
  const milestone = rows[0];
  if (!milestone || milestone.userId !== ctx.user.id) return fail("Milestone not found", 404);

  await db.delete(milestones).where(eq(milestones.id, milestone.id));
  const evaluation = await refreshHealth(milestone.repoId);
  return ok({ deleted: milestone.id, evaluation });
}
