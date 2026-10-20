import { eq } from "drizzle-orm";
import { db } from "@/db";
import { androidSources } from "@/db/schema";
import { ANDROID_SOURCES } from "@/lib/androidSources";
import { isUuid, fail, ok, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Restores the pristine version of an embedded source file. */
export async function POST(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);

  const rows = await db.select().from(androidSources).where(eq(androidSources.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.userId !== ctx.user.id) return fail("Source file not found", 404);

  const pristine = ANDROID_SOURCES.find((s) => s.path === row.path);
  if (!pristine) return fail("No pristine copy exists for this path — it was added locally.", 409);

  const [updated] = await db
    .update(androidSources)
    .set({
      content: pristine.content,
      summary: pristine.summary,
      language: pristine.language,
      sizeBytes: Buffer.byteLength(pristine.content, "utf8"),
      dirty: false,
      updatedAt: new Date(),
    })
    .where(eq(androidSources.id, row.id))
    .returning();

  return ok({ source: updated });
}
