import { defineConfig, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const host = process.env.TAURI_DEV_HOST;

/**
 * pdf.js loads font data, character maps and image decoders from URLs at runtime. They're served
 * from `/pdfjs/<dir>/` in development and copied there in builds (see `src/lib/pdf/pdf.svelte.ts`).
 */
function pdfjsResources(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const DIRS = ["cmaps", "standard_fonts", "wasm", "iccs"];
  return {
    name: "pdfjs-resources",
    configureServer(server) {
      server.middlewares.use("/pdfjs", (req, res, next) => {
        const [dir, file] = (req.url ?? "").split("?")[0].split("/").filter(Boolean);
        if (!DIRS.includes(dir) || !file || file.includes("..")) return next();
        try {
          const bytes = readFileSync(join(root, dir, decodeURIComponent(file)));
          if (file.endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
          res.end(bytes);
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const dir of DIRS) {
        for (const file of readdirSync(join(root, dir))) {
          this.emitFile({ type: "asset", fileName: `pdfjs/${dir}/${file}`, source: readFileSync(join(root, dir, file)) });
        }
      }
    },
  };
}

// https://v2.tauri.app/start/frontend/vite/
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [svelte(), pdfjsResources()],
  // The app's version, shown in Settings → About.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  // Keep Rust errors visible in the terminal.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: ["es2022", "safari16", "chrome110"],
  },
});
