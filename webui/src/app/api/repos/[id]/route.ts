import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { milestones, repositories } from "@/db/schema";
import { evaluateRepo, type MilestoneKind } from "@/lib/engines";
import { isUuid, fail, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function owned(userId: string, id: string) {
  const rows = await db.select().from(repositories).where(eq(repositories.id, id)).limit(1);
  const row = rows[0];
  return row && row.userId === userId ? row : null;
}

export async function GET(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const repo = await owned(ctx.user.id, id);
  if (!repo) return fail("Repository not found", 404);
  const items = await db
    .select()
    .from(milestones)
    .where(eq(milestones.repoId, repo.id))
    .orderBy(asc(milestones.position));
  return ok({
    repo: {
      ...repo,
      milestones: items,
      evaluation: evaluateRepo(items.map((m) => ({ title: m.title, kind: m.kind as MilestoneKind, done: m.done }))),
    },
  });
}

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const repo = await owned(ctx.user.id, id);
  if (!repo) return fail("Repository not found", 404);

  const body = await readJson<Record<string, unknown>>(req);
  const items = await db.select().from(milestones).where(eq(milestones.repoId, repo.id));
  const evaluation = evaluateRepo(items.map((m) => ({ title: m.title, kind: m.kind as MilestoneKind, done: m.done })));

  const [updated] = await db
    .update(repositories)
    .set({
      name: str(body.name) || repo.name,
      remote: str(body.remote) || repo.remote,
      branch: str(body.branch) || repo.branch,
      summary: body.summary === undefined ? repo.summary : str(body.summary),
      lastCommit: str(body.lastCommit) || repo.lastCommit,
      health: evaluation.health,
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, repo.id))
    .returning();

  return ok({ repo: updated });
}

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const repo = await owned(ctx.user.id, id);
  if (!repo) return fail("Repository not found", 404);
  await db.delete(repositories).where(eq(repositories.id, repo.id));
  return ok({ deleted: repo.id });
}
