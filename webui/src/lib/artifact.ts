import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { androidSources, type AndroidSource } from "@/db/schema";
import { createZip, type ZipEntry } from "@/lib/zip";

/** Normalises embedded paths into the layout Gradle expects. */
export function artifactPath(path: string) {
  if (path.startsWith("public/android/HeretIc/")) return path.replace("public/android/HeretIc/", "HeretIc/");
  if (path.startsWith(".github/")) return path;
  return `HeretIc/${path}`;
}

export async function loadSources(userId: string): Promise<AndroidSource[]> {
  return db
    .select()
    .from(androidSources)
    .where(eq(androidSources.userId, userId))
    .orderBy(asc(androidSources.position), asc(androidSources.path));
}

export function toZipEntries(sources: AndroidSource[], meta?: string): ZipEntry[] {
  const entries: ZipEntry[] = sources.map((source) => ({
    path: artifactPath(source.path),
    content: source.content,
  }));
  if (meta) entries.push({ path: "HeretIc/BUILD-INFO.md", content: meta });
  return entries;
}

export function buildZip(entries: ZipEntry[]) {
  return createZip(entries);
}

export function byteLength(bytes: Uint8Array) {
  return bytes.byteLength;
}
