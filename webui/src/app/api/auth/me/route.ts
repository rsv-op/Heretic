import { getCurrentUser, publicUser } from "@/lib/auth";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  return ok({ user: user ? publicUser(user) : null });
}
