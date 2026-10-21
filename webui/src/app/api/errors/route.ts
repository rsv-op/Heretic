import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { errorCases } from "@/db/schema";
import { analyzeError } from "@/lib/engines";
import { fail, ok, readJson, requireUser, str } from "@/lib/http";
import { shortId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const rows = await db
    .select()
    .from(errorCases)
    .where(eq(errorCases.userId, ctx.user.id))
    .orderBy(desc(errorCases.createdAt));
  return ok({ cases: rows });
}

/** Creates a case by running the raw log through the Error Engine. */
export async function POST(req: Request) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const body = await readJson<Record<string, unknown>>(req);
  const rawLog = str(body.rawLog);
  if (rawLog.length < 12) return fail("Paste a longer log excerpt — include the exception and its frames.");

  const analysis = analyzeError(rawLog);
  const title = str(body.title) || firstLine(rawLog).slice(0, 90);

  const [created] = await db
    .insert(errorCases)
    .values({
      userId: ctx.user.id,
      ref: shortId("ERR"),
      title,
      rawLog,
      what: analysis.what,
      why: analysis.why,
      solution: analysis.solution,
      formatted: analysis.formatted,
      rules: analysis.rules,
      severity: analysis.severity,
      confidence: analysis.confidence,
      status: "AWAITING_PASTE_BACK",
    })
    .returning();

  return ok({ case: created, analysis }, { status: 201 });
}

function firstLine(log: string) {
  const line = log
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 12 && !l.startsWith("at "));
  return line ?? "Untitled failure";
}
