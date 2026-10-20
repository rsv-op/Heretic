import { defineConfig } from "drizzle-kit";

// Migrations are generated from the same schema the Next.js app uses, then
// applied to the in-browser PGlite database on first start.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
