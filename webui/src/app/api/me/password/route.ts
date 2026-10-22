import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { fail, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const body = await readJson<Record<string, unknown>>(req);

  const current = str(body.currentPassword);
  const next = str(body.newPassword);
  if (!verifyPassword(current, ctx.user.passwordHash)) return fail("Current password is incorrect.", 401);
  if (next.length < 8) return fail("New password must be at least 8 characters.");

  await db.update(users).set({ passwordHash: hashPassword(next) }).where(eq(users.id, ctx.user.id));
  return ok({ ok: true });
}
