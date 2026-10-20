import { analyzeError } from "@/lib/engines";
import { fail, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Ephemeral run of the Error Engine — no case is persisted. */
export async function POST(req: Request) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const body = await readJson<Record<string, unknown>>(req);
  const rawLog = str(body.rawLog);
  if (rawLog.length < 12) return fail("Paste a longer log excerpt first.");
  return ok({ analysis: analyzeError(rawLog) });
}
