import { eq } from "drizzle-orm";
import { db } from "@/db";
import { androidSources } from "@/db/schema";
import { buildZip, toZipEntries } from "@/lib/artifact";
import { fail, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Downloads the whole embedded Android project as a ZIP. */
export async function GET() {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);

  const sources = await db.select().from(androidSources).where(eq(androidSources.userId, ctx.user.id));
  if (!sources.length) return fail("No embedded sources in this workspace yet.", 404);

  const meta = `# HeretIc embedded Android project\n\nFiles: ${sources.length}\nExported from the Heretic.ai command center.\n`;
  const zip = buildZip(toZipEntries(sources, meta));

  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="HeretIc-android-sources.zip"',
      "Content-Length": String(zip.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
