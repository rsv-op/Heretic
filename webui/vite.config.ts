import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { defineConfig } from "vite";

const src = fileURLToPath(new URL("./src", import.meta.url));
const shim = (name: string) => fileURLToPath(new URL(`./src/shims/${name}`, import.meta.url));

// Single HTML file for the APK: JS, CSS and the PGlite WebAssembly are all inlined.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
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
  build: {
    target: "es2022",
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 100_000,
    outDir: "dist",
  },
});
