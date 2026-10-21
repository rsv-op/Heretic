import { eq } from "drizzle-orm";
import { db } from "@/db";
import { errorCases } from "@/db/schema";
import { analyzeError } from "@/lib/engines";
import { isUuid, fail, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function owned(userId: string, id: string) {
  const rows = await db.select().from(errorCases).where(eq(errorCases.id, id)).limit(1);
  const row = rows[0];
  return row && row.userId === userId ? row : null;
}

export async function GET(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const row = await owned(ctx.user.id, id);
  if (!row) return fail("Case not found", 404);
  return ok({ case: row });
}

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const row = await owned(ctx.user.id, id);
  if (!row) return fail("Case not found", 404);

  const body = await readJson<Record<string, unknown>>(req);
  const rawLog = str(body.rawLog) || row.rawLog;
  const reanalysed = rawLog !== row.rawLog ? analyzeError(rawLog) : null;

  const [updated] = await db
    .update(errorCases)
    .set({
      title: str(body.title) || row.title,
      rawLog,
      what: reanalysed?.what ?? row.what,
      why: reanalysed?.why ?? row.why,
      solution: reanalysed?.solution ?? row.solution,
      formatted: reanalysed?.formatted ?? row.formatted,
      rules: reanalysed?.rules ?? row.rules,
      severity: reanalysed?.severity ?? row.severity,
      confidence: reanalysed?.confidence ?? row.confidence,
      updatedAt: new Date(),
    })
    .where(eq(errorCases.id, row.id))
    .returning();

  return ok({ case: updated, reanalysed: Boolean(reanalysed) });
}

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const row = await owned(ctx.user.id, id);
  if (!row) return fail("Case not found", 404);
  await db.delete(errorCases).where(eq(errorCases.id, row.id));
  return ok({ deleted: row.id });
}
