import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { inferenceProfiles } from "@/db/schema";
import { fail, num, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const rows = await db
    .select()
    .from(inferenceProfiles)
    .where(eq(inferenceProfiles.userId, ctx.user.id))
    .orderBy(desc(inferenceProfiles.active), desc(inferenceProfiles.createdAt));
  return ok({ profiles: rows });
}

export async function POST(req: Request) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const body = await readJson<Record<string, unknown>>(req);

  const name = str(body.name);
  const model = str(body.model);
  if (!name || !model) return fail("A profile needs a name and a model file.");

  const [created] = await db
    .insert(inferenceProfiles)
    .values({
      userId: ctx.user.id,
      name,
      model,
      runtime: str(body.runtime) || "LiteRT 2.3.0",
      delegate: str(body.delegate) || "CPU",
      threads: Math.max(1, Math.min(8, num(body.threads, 4))),
      latencyMs: Math.max(0, num(body.latencyMs, 0)),
      ramMb: Math.max(0, num(body.ramMb, 0)),
      active: Boolean(body.active),
    })
    .returning();

  return ok({ profile: created }, { status: 201 });
}
