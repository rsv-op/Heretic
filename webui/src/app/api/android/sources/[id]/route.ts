import { eq } from "drizzle-orm";
import { db } from "@/db";
import { androidSources } from "@/db/schema";
import { isUuid, fail, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function owned(userId: string, id: string) {
  const rows = await db.select().from(androidSources).where(eq(androidSources.id, id)).limit(1);
  const row = rows[0];
  return row && row.userId === userId ? row : null;
}

export async function GET(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const row = await owned(ctx.user.id, id);
  if (!row) return fail("Source file not found", 404);
  return ok({ source: row });
}

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const row = await owned(ctx.user.id, id);
  if (!row) return fail("Source file not found", 404);

  const body = await readJson<Record<string, unknown>>(req);
  const content = typeof body.content === "string" ? body.content : row.content;

  const [updated] = await db
    .update(androidSources)
    .set({
      path: str(body.path) || row.path,
      language: str(body.language) || row.language,
      summary: body.summary === undefined ? row.summary : str(body.summary),
      content,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      dirty: content !== row.content ? true : (body.dirty === undefined ? row.dirty : Boolean(body.dirty)),
      updatedAt: new Date(),
    })
    .where(eq(androidSources.id, row.id))
    .returning();

  return ok({ source: updated });
}

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const row = await owned(ctx.user.id, id);
  if (!row) return fail("Source file not found", 404);
  await db.delete(androidSources).where(eq(androidSources.id, row.id));
  return ok({ deleted: row.id, path: row.path });
}
