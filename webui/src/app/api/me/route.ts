import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { publicUser } from "@/lib/auth";
import { fail, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  return ok({ user: ctx.publicUser });
}

export async function PATCH(req: Request) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const body = await readJson<Record<string, unknown>>(req);

  const name = str(body.name) || ctx.user.name;
  const handle = (str(body.handle) || ctx.user.handle).toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 24);
  const deviceModel = str(body.deviceModel) || ctx.user.deviceModel;
  const bridgeMode = ["browser", "native-webview", "compose"].includes(str(body.bridgeMode))
    ? str(body.bridgeMode)
    : ctx.user.bridgeMode;

  const [updated] = await db
    .update(users)
    .set({ name, handle, deviceModel, bridgeMode })
    .where(eq(users.id, ctx.user.id))
    .returning();

  return ok({ user: publicUser(updated) });
}
