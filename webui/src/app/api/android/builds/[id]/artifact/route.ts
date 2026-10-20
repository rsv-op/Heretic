import { eq } from "drizzle-orm";
import { db } from "@/db";
import { androidSources, buildRuns } from "@/db/schema";
import { buildZip, toZipEntries } from "@/lib/artifact";
import { isUuid, fail, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const { id } = await params;
  if (!isUuid(id)) return fail("Not found", 404);

  const runs = await db.select().from(buildRuns).where(eq(buildRuns.id, id)).limit(1);
  const run = runs[0];
  if (!run || run.userId !== ctx.user.id) return fail("Build run not found", 404);
  if (run.status !== "SUCCEEDED" || !run.artifactName) return fail("This run produced no artifact.", 409);

  const sources = await db.select().from(androidSources).where(eq(androidSources.userId, ctx.user.id));
  const meta = [
    `# HeretIc run ${run.runNumber}`,
    ``,
    `- ref: ${run.ref}`,
    `- variant: ${run.variant}`,
    `- trigger: ${run.trigger}`,
    `- gradle 8.7 · jdk temurin-17`,
    `- core tests passed: ${run.testsPassed}`,
    `- generated: ${run.createdAt.toISOString()}`,
    ``,
    `APK compilation needs the Android SDK, Gradle 8.7 and JDK 17.`,
    `Run: cd HeretIc && ./gradlew :app:assembleDebug`,
  ].join("\n");

  const zip = buildZip(toZipEntries(sources, meta));
  const fileName = run.artifactName.endsWith(".zip") ? run.artifactName : `${run.artifactName}.zip`;

  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(zip.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
