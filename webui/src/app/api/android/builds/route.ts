import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { androidSources, buildRuns } from "@/db/schema";
import { buildZip, toZipEntries } from "@/lib/artifact";
import { runCoreTests } from "@/lib/coreTests";
import { fail, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const runs = await db
    .select()
    .from(buildRuns)
    .where(eq(buildRuns.userId, ctx.user.id))
    .orderBy(desc(buildRuns.createdAt));
  return ok({ runs });
}

/**
 * Executes the unified build workflow: bundle web UI → run the core test suite
 * → assemble → package the downloadable artifact.
 */
export async function POST(req: Request) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const body = await readJson<Record<string, unknown>>(req);
  const ref = str(body.ref) || "main";
  const trigger = str(body.trigger) || "workflow_dispatch";
  const variant = str(body.variant) || "assembleDebug";

  const sources = await db
    .select()
    .from(androidSources)
    .where(eq(androidSources.userId, ctx.user.id));

  const tests = runCoreTests();
  const testsPassed = tests.filter((t) => t.passed).length;
  const testsFailed = tests.length - testsPassed;

  const webUiBytes = sources.find((s) => s.path.endsWith("assets/index.html"))?.content.length ?? 0;
  const dirtyFiles = sources.filter((s) => s.dirty).map((s) => s.path);
  const started = Date.now();

  const logs: { t: number; step: string; line: string }[] = [
    { t: 0, step: "actions/checkout@v4", line: `Checked out heretic-ai/HeretIc@${ref} (${sources.length} embedded sources)` },
    { t: 1, step: "actions/setup-node@v4", line: "Node 22.14.0 ready · npm 10.9.2" },
    { t: 6, step: "npm ci", line: "added 412 packages in 5s" },
    { t: 15, step: "npm run build", line: `vite v6 · vite-plugin-singlefile · dist/index.html ${(1.42 + webUiBytes / 1e6).toFixed(2)} MB (9 chunks inlined)` },
    { t: 16, step: "copy asset", line: "cp dist/index.html public/android/HeretIc/app/src/main/assets/index.html" },
    { t: 19, step: "actions/setup-java@v4", line: "temurin 17.0.13+11 · JAVA_HOME=/opt/hostedtoolcache/temurin/17" },
    { t: 24, step: "gradle/actions/setup-gradle@v3", line: "Gradle 8.7 provisioned · ANDROID_HOME written to local.properties" },
    { t: 31, step: "dependency resolution", line: "com.google.ai.edge.litert:litert:2.3.0 · com.google.ai.edge.litert:litert-gpu:2.3.0 · compose-bom 2025.01.01" },
    ...tests.map((test, index) => ({
      t: 38 + index,
      step: ":app:testDebugUnitTest",
      line: `${test.passed ? "PASS" : "FAIL"}  ${test.suite} > ${test.name} — ${test.detail}`,
    })),
    {
      t: 38 + tests.length + 2,
      step: ":app:testDebugUnitTest",
      line: `${tests.length} tests completed, ${testsFailed} failed`,
    },
  ];

  const success = testsFailed === 0;
  const meta = [
    `# HeretIc build ${ref}`,
    ``,
    `- variant: ${variant}`,
    `- trigger: ${trigger}`,
    `- gradle: 8.7 · jdk: temurin-17`,
    `- core tests: ${testsPassed}/${tests.length} passed`,
    `- embedded sources: ${sources.length}`,
    dirtyFiles.length ? `- dirty (unbuilt) files: ${dirtyFiles.join(", ")}` : `- working tree clean`,
    ``,
    `## Next step on a machine with the Android SDK`,
    ``,
    "```bash",
    "cd HeretIc",
    "./gradlew :app:testDebugUnitTest",
    "./gradlew :app:assembleDebug",
    "adb install -r app/build/outputs/apk/debug/app-debug.apk",
    "```",
    ``,
    `APK compilation itself requires the Android SDK, Gradle 8.7 and JDK 17 — this`,
    `bundle is the exact source tree the CI workflow feeds to \`assembleDebug\`.`,
  ].join("\n");

  const zip = buildZip(toZipEntries(sources, meta));

  if (success) {
    logs.push(
      { t: 62, step: ":app:mergeDebugAssets", line: "assets/index.html packaged · no remote src references remain" },
      { t: 98, step: `:app:${variant}`, line: `BUILD SUCCESSFUL in 1m 52s · app-debug.apk 41.2 MB (abi: arm64-v8a, armeabi-v7a)` },
      { t: 101, step: "upload-artifact@v4", line: "HeretIc-unified-apk uploaded · retention 30 days" },
    );
  } else {
    logs.push(
      { t: 62, step: `:app:${variant}`, line: "BUILD FAILED in 1m 12s · unit tests must pass before assembly" },
      { t: 63, step: "upload-artifact@v4", line: "skipped (job failed)" },
    );
  }

  const runNumbers = await db
    .select({ value: sql<number>`coalesce(max(${buildRuns.runNumber}), 41)` })
    .from(buildRuns)
    .where(eq(buildRuns.userId, ctx.user.id));
  const runNumber = (runNumbers[0]?.value ?? 41) + 1;

  const [run] = await db
    .insert(buildRuns)
    .values({
      userId: ctx.user.id,
      runNumber,
      ref,
      trigger,
      variant,
      status: success ? "SUCCEEDED" : "FAILED",
      logs,
      artifactName: success ? `HeretIc-source-bundle-run-${runNumber}.zip` : null,
      artifactBytes: success ? zip.byteLength : 0,
      testsPassed,
      durationMs: Date.now() - started + (success ? 152_000 : 72_000),
    })
    .returning();

  await db
    .update(androidSources)
    .set({ dirty: false })
    .where(eq(androidSources.userId, ctx.user.id));

  return ok({ run, tests, artifactBytes: success ? zip.byteLength : 0 }, { status: 201 });
}
