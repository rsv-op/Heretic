import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { androidSources } from "@/db/schema";
import { fail, ok, readJson, requireUser, str } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const rows = await db
    .select()
    .from(androidSources)
    .where(eq(androidSources.userId, ctx.user.id))
    .orderBy(asc(androidSources.position), asc(androidSources.path));
  return ok({
    sources: rows,
    totals: {
      files: rows.length,
      bytes: rows.reduce((sum, r) => sum + r.sizeBytes, 0),
      dirty: rows.filter((r) => r.dirty).length,
      languages: Array.from(new Set(rows.map((r) => r.language))),
    },
  });
}

export async function POST(req: Request) {
  const ctx = await requireUser();
  if (!ctx) return fail("Not authenticated", 401);
  const body = await readJson<Record<string, unknown>>(req);

  const path = str(body.path).replace(/^\/+/, "");
  const content = typeof body.content === "string" ? body.content : "";
  if (!path) return fail("A file path is required.");
  if (!content.trim()) return fail("File content cannot be empty.");

  const duplicates = await db
    .select({ id: androidSources.id })
    .from(androidSources)
    .where(and(eq(androidSources.userId, ctx.user.id), eq(androidSources.path, path)));
  if (duplicates.length) return fail("That path already exists in the embedded project.", 409);

  const extension = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
  const languageMap: Record<string, string> = {
    kt: "kotlin",
    kts: "kotlin",
    java: "java",
    xml: "xml",
    yml: "yaml",
    yaml: "yaml",
    md: "markdown",
    html: "html",
    pro: "text",
    properties: "text",
    json: "json",
  };

  const maxPosition = await db
    .select({ position: androidSources.position })
    .from(androidSources)
    .where(eq(androidSources.userId, ctx.user.id));

  const [created] = await db
    .insert(androidSources)
    .values({
      userId: ctx.user.id,
      path,
      language: str(body.language) || languageMap[extension] || "text",
      summary: str(body.summary) || "Added from the command center.",
      content,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      dirty: true,
      position: maxPosition.length ? Math.max(...maxPosition.map((p) => p.position)) + 1 : 0,
    })
    .returning();

  return ok({ source: created }, { status: 201 });
}
