import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { fileAssets } from "@/db/schema";
import { assessFile } from "@/lib/engines";
import { fail, num, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

const toEnum = (relevance: string) => relevance.replace(/ /g, "_") as "WORKS" | "PARTIALLY_MATCHES" | "NOT_RELEVANT";

export async function GET() {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const rows = await db
    .select()
    .from(fileAssets)
    .where(eq(fileAssets.userId, ctx.user.id))
    .orderBy(desc(fileAssets.createdAt));
  return ok({ files: rows });
}

/**
 * Mirrors the SAF pick: `window.HereticNative.triggerFilePicker()` returns a
 * single display name, which the assessor grades deterministically.
 */
export async function POST(req: Request) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const body = await readJson<Record<string, unknown>>(req);
  const fileName = str(body.fileName);
  if (!fileName) return fail("A file name is required — pick exactly one file.");

  const sizeBytes = Math.max(0, num(body.sizeBytes, 0));
  const assessment = assessFile(fileName, sizeBytes);

  const [created] = await db
    .insert(fileAssets)
    .values({
      userId: ctx.user.id,
      fileName: assessment.fileName,
      origin: str(body.origin) || "saf-open-document",
      sizeBytes,
      relevance: toEnum(assessment.relevance),
      usefulness: assessment.usefulness,
      whyNotUseful: assessment.whyNotUseful,
      rationale: assessment.rationale,
      integrationSteps: assessment.integrationSteps,
      targetModule: assessment.targetModule,
      notes: str(body.notes) || null,
    })
    .returning();

  return ok({ file: created, assessment }, { status: 201 });
}
