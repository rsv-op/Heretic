import { eq } from "drizzle-orm";
import { db } from "@/db";
import { gates } from "@/db/schema";
import { rechain, verifyChain } from "@/lib/audit";
import { isUuid, fail, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const DECISIONS = ["PENDING", "GRANTED", "DENIED", "REVOKED"] as const;

async function owned(userId: string, id: string) {
  const rows = await db.select().from(gates).where(eq(gates.id, id)).limit(1);
  const row = rows[0];
  return row && row.userId === userId ? row : null;
}

/** Records a per-instance consent decision and re-chains the audit ledger. */
export async function PATCH(req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const gate = await owned(ctx.user.id, id);
  if (!gate) return fail("Gate not found", 404);

  const body = await readJson<Record<string, unknown>>(req);
  const decisionRaw = str(body.decision).toUpperCase();
  if (!DECISIONS.includes(decisionRaw as (typeof DECISIONS)[number])) {
    return fail("Decision must be one of GRANTED, DENIED, REVOKED or PENDING.");
  }
  const decision = decisionRaw as (typeof DECISIONS)[number];

  const [updated] = await db
    .update(gates)
    .set({
      decision,
      decidedBy: decision === "PENDING" ? null : ctx.user.email,
      decidedAt: decision === "PENDING" ? null : new Date(),
      reason: str(body.reason) || gate.reason,
      scope: str(body.scope) || gate.scope,
    })
    .where(eq(gates.id, gate.id))
    .returning();

  const chain = await rechain(ctx.user.id);
  const audit = await verifyChain(ctx.user.id);
  return ok({ gate: updated, chain, audit });
}

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const gate = await owned(ctx.user.id, id);
  if (!gate) return fail("Gate not found", 404);

  await db.delete(gates).where(eq(gates.id, gate.id));
  await rechain(ctx.user.id);
  const audit = await verifyChain(ctx.user.id);
  return ok({ deleted: gate.id, audit });
}
