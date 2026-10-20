import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { decisions } from "@/db/schema";
import { validateDecision } from "@/lib/engines";
import { shortId } from "@/lib/auth";
import { fail, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const rows = await db
    .select()
    .from(decisions)
    .where(eq(decisions.userId, ctx.user.id))
    .orderBy(desc(decisions.createdAt));
  return ok({
    decisions: rows.map((d) => ({ ...d, wordCount: d.reasoning.trim().split(/\s+/).filter(Boolean).length })),
    rule: { minWords: 12, requiresBecause: true },
  });
}

/** Refuses any entry without the mandatory reasoning sentence. */
export async function POST(req: Request) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const body = await readJson<Record<string, unknown>>(req);

  const title = str(body.title);
  const choice = str(body.choice);
  const reasoning = str(body.reasoning);
  const validation = validateDecision({ title, choice, reasoning });
  if (!validation.valid) {
    return fail("Decision rejected by the DecisionLogger rule.", 422, {
      errors: validation.errors,
      wordCount: validation.wordCount,
      hasBecause: validation.hasBecause,
    });
  }

  const options = Array.isArray(body.options) ? (body.options as unknown[]).map((o) => str(o)).filter(Boolean) : [];
  const tags = Array.isArray(body.tags) ? (body.tags as unknown[]).map((t) => str(t)).filter(Boolean) : [];

  const [created] = await db
    .insert(decisions)
    .values({
      userId: ctx.user.id,
      ref: shortId("ADR"),
      title,
      context: str(body.context),
      options,
      choice,
      reasoning,
      impact: str(body.impact),
      tags,
      status: str(body.status).toUpperCase() || "ACCEPTED",
    })
    .returning();

  return ok({ decision: created, validation }, { status: 201 });
}
