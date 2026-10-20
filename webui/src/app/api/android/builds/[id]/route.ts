import { eq } from "drizzle-orm";
import { db } from "@/db";
import { buildRuns } from "@/db/schema";
import { isUuid, fail, ok, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const rows = await db.select().from(buildRuns).where(eq(buildRuns.id, id)).limit(1);
  const run = rows[0];
  if (!run || run.userId !== ctx.user.id) return fail("Build run not found", 404);
  return ok({ run });
}

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const rows = await db.select().from(buildRuns).where(eq(buildRuns.id, id)).limit(1);
  const run = rows[0];
  if (!run || run.userId !== ctx.user.id) return fail("Build run not found", 404);
  await db.delete(buildRuns).where(eq(buildRuns.id, run.id));
  return ok({ deleted: run.id });
}
