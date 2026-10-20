import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { coreReply } from "@/lib/engines";
import { isUuid, fail, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const turns = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));
  return ok({ messages: turns });
}

/**
 * Sends a prompt through HereticCore. In the APK the same call is answered by
 * `window.HereticNative.reply(prompt)`; the server route keeps the browser
 * build fully functional and persists the transcript.
 */
export async function POST(req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);
  const body = await readJson<Record<string, unknown>>(req);
  const content = str(body.content);
  if (!content) return fail("Message content is required.");

  const convoRows = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  const convo = convoRows[0];
  if (!convo || convo.userId !== ctx.user.id) return fail("Conversation not found", 404);

  const [userMessage] = await db
    .insert(messages)
    .values({ conversationId: convo.id, userId: ctx.user.id, role: "user", content })
    .returning();

  const reply = coreReply(content);

  const [hereticMessage] = await db
    .insert(messages)
    .values({
      conversationId: convo.id,
      userId: ctx.user.id,
      role: "heretic",
      content: reply.text,
      intent: reply.intent,
      latencyMs: reply.latencyMs,
      spoken: convo.mode === "voice",
    })
    .returning();

  await db
    .update(conversations)
    .set({
      updatedAt: new Date(),
      mode: body.mode === "voice" || body.mode === "text" ? body.mode : convo.mode,
      title: convo.title === "Untitled session" ? content.slice(0, 52) : convo.title,
    })
    .where(eq(conversations.id, convo.id));

  return ok({
    userMessage,
    reply: hereticMessage,
    core: { speak: reply.speak, intent: reply.intent, confidence: reply.confidence, engine: reply.engine, actions: reply.actions, latencyMs: reply.latencyMs },
  }, { status: 201 });
}
