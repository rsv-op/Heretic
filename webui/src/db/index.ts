/**
 * Browser replacement for the server's pg Pool.
 *
 * The same drizzle schema and route handlers run here against PGlite (Postgres
 * compiled to WebAssembly), persisted in IndexedDB. Migrations are the SQL files
 * generated from src/db/schema.ts (see drizzle/).
 */
// The Postgres/WASM runtime is imported dynamically so Rollup keeps it in its
// own chunk instead of base64-inlining ~50 MB of WebAssembly into index.html.
const { PGlite } = await import("@electric-sql/pglite");
const { drizzle } = await import("drizzle-orm/pglite");

const migrationFiles = import.meta.glob("../../drizzle/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const client = new PGlite("idb://heretic-webui");
await client.waitReady;

async function migrate() {
  const probe = await client.query<{ present: boolean }>(
    "select exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'users') as present",
  );
  if (probe.rows[0]?.present) return;
  for (const path of Object.keys(migrationFiles).sort()) {
    const statements = migrationFiles[path].split("--> statement-breakpoint");
    for (const statement of statements) {
      if (statement.trim()) await client.exec(statement);
    }
  }
}

await migrate();

export const pool = client;
export const db = drizzle(client);
