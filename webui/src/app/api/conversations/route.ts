import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { fail, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);

  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      mode: conversations.mode,
      sttEngine: conversations.sttEngine,
      voiceEngine: conversations.voiceEngine,
      pinned: conversations.pinned,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      turnCount: sql<number>`(select count(*)::int from ${messages} where ${messages.conversationId} = ${conversations.id})`,
      lastMessage: sql<string | null>`(select ${messages.content} from ${messages} where ${messages.conversationId} = ${conversations.id} order by ${messages.createdAt} desc limit 1)`,
    })
    .from(conversations)
    .where(eq(conversations.userId, ctx.user.id))
    .orderBy(desc(conversations.pinned), desc(conversations.updatedAt));

  return ok({ conversations: rows });
}

export async function POST(req: Request) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const body = await readJson<Record<string, unknown>>(req);

  const title = str(body.title) || "Untitled session";
  const [created] = await db
    .insert(conversations)
    .values({
      userId: ctx.user.id,
      title,
      mode: str(body.mode) === "voice" ? "voice" : "text",
      sttEngine: str(body.sttEngine) || "android-native",
      voiceEngine: str(body.voiceEngine) || "android-native",
    })
    .returning();

  await db.insert(messages).values({
    conversationId: created.id,
    userId: ctx.user.id,
    role: "system",
    content: `Session opened on ${ctx.user.deviceModel}. HereticCore 2.3.0-offline resident · no INTERNET permission declared · zero background services.`,
  });

  return ok({ conversation: created }, { status: 201 });
}
