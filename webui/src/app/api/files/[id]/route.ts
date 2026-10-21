import { eq } from "drizzle-orm";
import { db } from "@/db";
import { fileAssets } from "@/db/schema";
import { assessFile } from "@/lib/engines";
import { isUuid, fail, num, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const toEnum = (relevance: string) => relevance.replace(/ /g, "_") as "WORKS" | "PARTIALLY_MATCHES" | "NOT_RELEVANT";

async function owned(userId: string, id: string) {
  const rows = await db.select().from(fileAssets).where(eq(fileAssets.id, id)).limit(1);
  const row = rows[0];
  return row && row.userId === userId ? row : null;
}

export async function GET(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const row = await owned(ctx.user.id, id);
  if (!row) return fail("File assessment not found", 404);
  return ok({ file: row });
}

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const row = await owned(ctx.user.id, id);
  if (!row) return fail("File assessment not found", 404);

  const body = await readJson<Record<string, unknown>>(req);
  const fileName = str(body.fileName) || row.fileName;
  const sizeBytes = body.sizeBytes === undefined ? row.sizeBytes : Math.max(0, num(body.sizeBytes, 0));
  const reassessed = fileName !== row.fileName || sizeBytes !== row.sizeBytes ? assessFile(fileName, sizeBytes) : null;

  const [updated] = await db
    .update(fileAssets)
    .set({
      fileName: reassessed?.fileName ?? fileName,
      sizeBytes,
      origin: str(body.origin) || row.origin,
      notes: body.notes === undefined ? row.notes : str(body.notes) || null,
      targetModule: str(body.targetModule) || reassessed?.targetModule || row.targetModule,
      relevance: reassessed ? toEnum(reassessed.relevance) : row.relevance,
      usefulness: reassessed?.usefulness ?? row.usefulness,
      whyNotUseful: reassessed ? reassessed.whyNotUseful : row.whyNotUseful,
      rationale: reassessed?.rationale ?? row.rationale,
      integrationSteps: reassessed?.integrationSteps ?? row.integrationSteps,
      updatedAt: new Date(),
    })
    .where(eq(fileAssets.id, row.id))
    .returning();

  return ok({ file: updated });
}

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const row = await owned(ctx.user.id, id);
  if (!row) return fail("File assessment not found", 404);
  await db.delete(fileAssets).where(eq(fileAssets.id, row.id));
  return ok({ deleted: row.id });
}
