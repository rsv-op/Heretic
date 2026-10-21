import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { gates } from "@/db/schema";
import { auditHash } from "@/lib/seed";

/**
 * Re-walks the authorization ledger so every entry's `prevHash` points at the
 * previous entry's `auditHash` — the offline equivalent of
 * `AuthorizationGate.verify()` in Kotlin.
 */
export async function rechain(userId: string) {
  const rows = await db.select().from(gates).where(eq(gates.userId, userId)).orderBy(asc(gates.createdAt));
  let prev = "genesis";
  for (const row of rows) {
    const hash = auditHash(prev, row.gateKey, row.decision, row.scope, row.createdAt);
    if (row.prevHash !== prev || row.auditHash !== hash) {
      await db
        .update(gates)
        .set({ prevHash: prev, auditHash: hash })
        .where(eq(gates.id, row.id));
    }
    prev = hash;
  }
  return { entries: rows.length, head: prev };
}

export async function verifyChain(userId: string) {
  const rows = await db.select().from(gates).where(eq(gates.userId, userId)).orderBy(asc(gates.createdAt));
  let prev = "genesis";
  for (const [index, row] of rows.entries()) {
    if (row.prevHash !== prev) return { intact: false, brokenAt: index, entries: rows.length, head: prev };
    prev = row.auditHash;
  }
  return { intact: true, brokenAt: -1, entries: rows.length, head: prev };
}
