import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, publicUser } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { DEMO_EMAIL, DEMO_PASSWORD, ensureDemoSeed } from "@/lib/seed";
import { verifyPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** One tap into the fully seeded operator workspace. */
export async function POST(req: Request) {
  await ensureDemoSeed();
  const rows = await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
  const demo = rows[0];
  if (!demo) return fail("Demo workspace could not be provisioned.", 500);
  if (!verifyPassword(DEMO_PASSWORD, demo.passwordHash)) return fail("Demo credential mismatch.", 500);
  await createSession(demo.id, req.headers.get("user-agent"));
  return ok({ user: publicUser(demo), demo: true });
}
