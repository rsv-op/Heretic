import { eq } from "drizzle-orm";
import { db } from "@/db";
import { decisions } from "@/db/schema";
import { validateDecision } from "@/lib/engines";
import { isUuid, fail, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function owned(userId: string, id: string) {
  const rows = await db.select().from(decisions).where(eq(decisions.id, id)).limit(1);
  const row = rows[0];
  return row && row.userId === userId ? row : null;
}

export async function GET(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const row = await owned(ctx.user.id, id);
  if (!row) return fail("Decision not found", 404);
  return ok({ decision: row });
}

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const row = await owned(ctx.user.id, id);
  if (!row) return fail("Decision not found", 404);

  const body = await readJson<Record<string, unknown>>(req);
  const title = str(body.title) || row.title;
  const choice = str(body.choice) || row.choice;
  const reasoning = body.reasoning === undefined ? row.reasoning : str(body.reasoning);

  const validation = validateDecision({ title, choice, reasoning });
  if (!validation.valid) {
    return fail("Update rejected by the DecisionLogger rule.", 422, { errors: validation.errors });
  }

  const [updated] = await db
    .update(decisions)
    .set({
      title,
      choice,
      reasoning,
      context: body.context === undefined ? row.context : str(body.context),
      impact: body.impact === undefined ? row.impact : str(body.impact),
      options: Array.isArray(body.options) ? (body.options as unknown[]).map((o) => str(o)).filter(Boolean) : row.options,
      tags: Array.isArray(body.tags) ? (body.tags as unknown[]).map((t) => str(t)).filter(Boolean) : row.tags,
      status: str(body.status).toUpperCase() || row.status,
      updatedAt: new Date(),
    })
    .where(eq(decisions.id, row.id))
    .returning();

  return ok({ decision: updated, validation });
}

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const row = await owned(ctx.user.id, id);
  if (!row) return fail("Decision not found", 404);
  await db.delete(decisions).where(eq(decisions.id, row.id));
  return ok({ deleted: row.id });
}
