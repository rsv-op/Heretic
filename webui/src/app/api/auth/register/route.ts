import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword, publicUser } from "@/lib/auth";
import { fail, ok, readJson, str } from "@/lib/http";
import { seedWorkspaceSkeleton } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await readJson<Record<string, unknown>>(req);
  const email = str(body.email).toLowerCase();
  const name = str(body.name) || email.split("@")[0] || "operator";
  const password = str(body.password);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Enter a valid email address.");
  if (password.length < 8) return fail("Password must be at least 8 characters.");

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length) return fail("That email is already registered.", 409);

  const handle = (str(body.handle) || email.split("@")[0])
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 24) || "operator";

  const [user] = await db
    .insert(users)
    .values({
      email,
      handle,
      name,
      passwordHash: hashPassword(password),
      role: "operator",
      deviceModel: str(body.deviceModel) || "Pixel 7 · Android 14",
      bridgeMode: "browser",
    })
    .returning();

  await seedWorkspaceSkeleton(user.id);
  await createSession(user.id, req.headers.get("user-agent"));

  return ok({ user: publicUser(user), workspace: "skeleton" });
}
