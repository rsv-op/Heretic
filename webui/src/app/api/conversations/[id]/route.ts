import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { isUuid, fail, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function owned(userId: string, id: string) {
  const rows = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  const convo = rows[0];
  if (!convo || convo.userId !== userId) return null;
  return convo;
}

export async function GET(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const convo = await owned(ctx.user.id, id);
  if (!convo) return fail("Conversation not found", 404);

  const turns = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convo.id))
    .orderBy(asc(messages.createdAt));

  return ok({ conversation: convo, messages: turns });
}

export async function PATCH(req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const convo = await owned(ctx.user.id, id);
  if (!convo) return fail("Conversation not found", 404);

  const body = await readJson<Record<string, unknown>>(req);
  const [updated] = await db
    .update(conversations)
    .set({
      title: str(body.title) || convo.title,
      mode: body.mode === "voice" || body.mode === "text" ? body.mode : convo.mode,
      sttEngine: str(body.sttEngine) || convo.sttEngine,
      voiceEngine: str(body.voiceEngine) || convo.voiceEngine,
      pinned: typeof body.pinned === "boolean" ? body.pinned : convo.pinned,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, convo.id))
    .returning();

  return ok({ conversation: updated });
}

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const convo = await owned(ctx.user.id, id);
  if (!convo) return fail("Conversation not found", 404);

  await db.delete(conversations).where(eq(conversations.id, convo.id));
  return ok({ deleted: convo.id });
}
