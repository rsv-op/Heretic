import { eq } from "drizzle-orm";
import { db } from "@/db";
import { inferenceProfiles } from "@/db/schema";
import { isUuid, fail, num, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);

  const rows = await db.select().from(inferenceProfiles).where(eq(inferenceProfiles.id, id)).limit(1);
  const profile = rows[0];
  if (!profile || profile.userId !== ctx.user.id) return fail("Profile not found", 404);

  const body = await readJson<Record<string, unknown>>(req);

  const [updated] = await db
    .update(inferenceProfiles)
    .set({
      name: str(body.name) || profile.name,
      model: str(body.model) || profile.model,
      runtime: str(body.runtime) || profile.runtime,
      delegate: str(body.delegate) || profile.delegate,
      threads: body.threads === undefined ? profile.threads : Math.max(1, Math.min(8, num(body.threads, profile.threads))),
      latencyMs: body.latencyMs === undefined ? profile.latencyMs : Math.max(0, num(body.latencyMs, 0)),
      ramMb: body.ramMb === undefined ? profile.ramMb : Math.max(0, num(body.ramMb, 0)),
      active: typeof body.active === "boolean" ? body.active : profile.active,
    })
    .where(eq(inferenceProfiles.id, profile.id))
    .returning();

  return ok({ profile: updated });
}

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);

  const rows = await db.select().from(inferenceProfiles).where(eq(inferenceProfiles.id, id)).limit(1);
  const profile = rows[0];
  if (!profile || profile.userId !== ctx.user.id) return fail("Profile not found", 404);

  await db.delete(inferenceProfiles).where(eq(inferenceProfiles.id, profile.id));
  return ok({ deleted: profile.id });
}
