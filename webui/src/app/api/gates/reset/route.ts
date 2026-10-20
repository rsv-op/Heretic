import { eq } from "drizzle-orm";
import { db } from "@/db";
import { gates } from "@/db/schema";
import { rechain, verifyChain } from "@/lib/audit";
import { fail, ok, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Clears every per-instance grant — the Android equivalent of `clearInstanceGrants()`. */
export async function POST() {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);

  await db
    .update(gates)
    .set({ decision: "PENDING", decidedBy: null, decidedAt: null })
    .where(eq(gates.userId, ctx.user.id));

  const chain = await rechain(ctx.user.id);
  const audit = await verifyChain(ctx.user.id);
  return ok({ ok: true, chain, audit });
}
