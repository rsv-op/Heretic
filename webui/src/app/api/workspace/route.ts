import { destroySession } from "@/lib/auth";
import { fail, ok, requireUser } from "@/lib/http";
import { clearWorkspaceData, seedWorkspaceSkeleton } from "@/lib/seed";

export const dynamic = "force-dynamic";

/** Empties the workspace back to the skeleton (Android sources + gate catalog). */
export async function DELETE() {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);

  await clearWorkspaceData(ctx.user.id);
  await seedWorkspaceSkeleton(ctx.user.id);
  await destroySession();
  return ok({ ok: true });
}
