import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { readFile } from "node:fs/promises";
// @ts-expect-error type error without @types/node package
import { fileURLToPath } from "node:url";

const zlibGunzipBridge = fileURLToPath(
  new URL("./vendor/zlib-gunzip.ts", import.meta.url)
);

/**
 * Vite's static middleware serves `.gz` files with `Content-Encoding: gzip`,
 * so browsers transparently decode kuromoji's dictionary before its own
 * gunzip sees it ("invalid file signature"). Serve the dictionary bytes raw
 * (dev only; Tauri's asset server does not sniff encodings).
 */
function kuromojiDictFix() {
  return {
    // Runs before SvelteKit's static server so dictionary bytes stay raw.
    name: "kuromoji-dict-fix",
    enforce: "pre",
    configureServer(/** @type {any} */ server) {
      server.middlewares.use(
        async (/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ next) => {
          try {
            const url = (req.url || "").split("?")[0];
            if (!url.startsWith("/kuromoji/") || !url.endsWith(".gz")) {
              return next();
            }
            const data = await readFile(`${server.config.root}/static${url}`);
            res.setHeader("Content-Type", "application/octet-stream");
            res.setHeader("Content-Length", data.length);
            res.statusCode = 200;
            res.end(data);
          } catch {
            next();
          }
        }
      );
    },
  };
}

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [sveltekit(), kuromojiDictFix()],
  resolve: {
    // kuromoji joins dictionary URLs with node:path; shim it in the browser.
    // kuromoji gunzips its dictionary through zlibjs, a global script whose
    // top-level `this` is undefined inside bundled ESM. Swap in a tiny ESM
    // bridge (vendor/zlib-gunzip.ts) exposing the same `Zlib.Gunzip` surface.
    alias: [
      { find: /^path$/, replacement: "path-browserify" },
      {
        find: /^zlibjs\/bin\/gunzip\.min\.js$/,
        replacement: zlibGunzipBridge,
      },
    ],
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
