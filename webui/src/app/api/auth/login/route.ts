import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, publicUser, verifyPassword } from "@/lib/auth";
import { fail, ok, readJson, str } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson<Record<string, unknown>>(req);
  const email = str(body.email).toLowerCase();
  const password = str(body.password);
  if (!email || !password) return fail("Email and password are required.");

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return fail("Incorrect email or password.", 401);
  }

  await createSession(user.id, req.headers.get("user-agent"));
  return ok({ user: publicUser(user) });
}
