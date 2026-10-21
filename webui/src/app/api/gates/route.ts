import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { gates } from "@/db/schema";
import { GATE_CATALOG } from "@/lib/engines";
import { rechain, verifyChain } from "@/lib/audit";
import { auditHash } from "@/lib/seed";
import { fail, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);

  const rows = await db.select().from(gates).where(eq(gates.userId, ctx.user.id)).orderBy(asc(gates.createdAt));
  const audit = await verifyChain(ctx.user.id);

  return ok({
    gates: rows,
    catalog: GATE_CATALOG,
    audit: {
      ...audit,
      granted: rows.filter((g) => g.decision === "GRANTED").length,
      denied: rows.filter((g) => g.decision === "DENIED").length,
      pending: rows.filter((g) => g.decision === "PENDING").length,
    },
  });
}

/** Opens a new consent request (PENDING) and appends it to the ledger. */
export async function POST(req: Request) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const body = await readJson<Record<string, unknown>>(req);

  const gateKey = str(body.gateKey) || str(body.action).toLowerCase().replace(/[^a-z0-9]+/g, ".");
  const action = str(body.action);
  if (!gateKey || !action) return fail("A gate needs an action label.");

  const catalogEntry = GATE_CATALOG.find((g) => g.key === gateKey);
  const scope = str(body.scope) || catalogEntry?.scope || "this-instance-only";
  const risk = ["low", "medium", "high"].includes(str(body.risk)) ? str(body.risk) : (catalogEntry?.risk ?? "medium");
  const reason = str(body.reason) || catalogEntry?.reason || "Requested from the command center.";
  const at = new Date();

  const existing = await db.select().from(gates).where(eq(gates.userId, ctx.user.id)).orderBy(asc(gates.createdAt));
  const prev = existing.length ? existing[existing.length - 1].auditHash : "genesis";

  const [created] = await db
    .insert(gates)
    .values({
      userId: ctx.user.id,
      gateKey,
      action,
      scope,
      risk,
      reason,
      decision: "PENDING",
      prevHash: prev,
      auditHash: auditHash(prev, gateKey, "PENDING", scope, at),
      createdAt: at,
    })
    .returning();

  const audit = await rechain(ctx.user.id);
  return ok({ gate: created, audit }, { status: 201 });
}
