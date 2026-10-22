import { clearWorkspaceData, seedDemoWorkspace } from "@/lib/seed";
import { fail, ok, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Loads (or reloads) the realistic demo workspace for the signed-in operator. */
export async function POST() {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);

  await clearWorkspaceData(ctx.user.id);
  await seedDemoWorkspace(ctx.user.id);
  return ok({ ok: true, seededFor: ctx.user.email });
}
