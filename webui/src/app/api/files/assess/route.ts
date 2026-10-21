import { assessFile } from "@/lib/engines";
import { fail, num, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Ephemeral assessment — nothing is stored until the operator saves it. */
export async function POST(req: Request) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const body = await readJson<Record<string, unknown>>(req);
  const fileName = str(body.fileName);
  if (!fileName) return fail("Provide a file name to assess.");
  return ok({ assessment: assessFile(fileName, Math.max(0, num(body.sizeBytes, 0))) });
}
