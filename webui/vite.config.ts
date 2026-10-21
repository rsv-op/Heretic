import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { defineConfig } from "vite";

const src = fileURLToPath(new URL("./src", import.meta.url));
const shim = (name: string) => fileURLToPath(new URL(`./src/shims/${name}`, import.meta.url));

/**
 * Two-tier bundle for the APK.
 *
 * `index.html` carries the UI, the CSS and the two landing images (inlined as
 * base64 data URIs) and stays around 1.3 MB. The PGlite/Postgres WebAssembly
 * runtime is emitted as its own chunk (`pglite-*.js`) instead of being base64'd
 * into the HTML, which is what used to inflate the single file to 53 MB.
 *
 * The Android asset loader serves both files over
 * https://appassets.androidplatform.net/assets/ so the WebView can still load
 * the ES module and the WebAssembly with no INTERNET permission.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteSingleFile({
      // We control the build config ourselves (see below) so that the SQL
      // engine can stay in its own chunk.
      useRecommendedBuildConfig: false,
      // Only the entry script and the stylesheet are inlined into index.html.
      // Every other chunk (pglite-*.js) is written next to it.
      inlinePattern: ["index-*.js", "style-*.css"],
    }),
  ],
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${src}/` },
      { find: /^next\/link$/, replacement: shim("next-link.tsx") },
      { find: /^next\/navigation$/, replacement: shim("next-navigation.ts") },
      { find: /^next\/headers$/, replacement: shim("next-headers.ts") },
      { find: /^next\/server$/, replacement: shim("next-server.ts") },
      { find: /^node:crypto$/, replacement: shim("node-crypto.ts") },
    ],
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  // Relative paths so the page works from the asset-loader origin.
  base: "./",
  build: {
    target: "es2022",
    assetsDir: "",
    cssCodeSplit: false,
    // Inline the landing images (a few hundred KB) but never the SQL engine:
    // pglite is split into its own chunk by the dynamic import in src/db/index.ts.
    assetsInlineLimit: 2_000_000,
    chunkSizeWarningLimit: 100_000,
    outDir: "dist",
    rollupOptions: {
      output: {
        inlineDynamicImports: false,
        manualChunks(id: string) {
          if (id.includes("@electric-sql/pglite") || id.includes("drizzle-orm")) return "pglite";
          return undefined;
        },
      },
    },
  },
});
