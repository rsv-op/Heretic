import { eq } from "drizzle-orm";
import { db } from "@/db";
import { errorCases } from "@/db/schema";
import { confirmSolution } from "@/lib/engines";
import { isUuid, fail, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Paste-back verification: CHECK PASSED / CHECK FAILED / AWAITING USER PASTE-BACK. */
export async function POST(req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const body = await readJson<Record<string, unknown>>(req);
  const pasteBack = str(body.pasteBack);
  if (!pasteBack) return fail("Paste the result back so the loop can be graded.");

  const rows = await db.select().from(errorCases).where(eq(errorCases.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.userId !== ctx.user.id) return fail("Case not found", 404);

  const verdict = confirmSolution(pasteBack);
  const status =
    verdict.status === "CHECK PASSED"
      ? "CHECK_PASSED"
      : verdict.status === "CHECK FAILED"
        ? "CHECK_FAILED"
        : "AWAITING_PASTE_BACK";

  const [updated] = await db
    .update(errorCases)
    .set({
      pasteBack,
      status,
      verdictNote: `${verdict.status} — ${verdict.note}`,
      updatedAt: new Date(),
    })
    .where(eq(errorCases.id, row.id))
    .returning();

  return ok({ case: updated, verdict });
}
