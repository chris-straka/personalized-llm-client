import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
// Explicit node: imports (never global `process`): with tsconfig
// `types: []`, @types/node stays out of the frontend, where no
// process object exists at runtime.
import process from "node:process";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [sveltekit()],
  // Staleness marker (settings footer): installed builds show when
  // they were compiled, so "am I behind?" is one glance. Dev shows
  // "live" instead (HMR is always fresh; a server-start stamp would lie).
  define: {
    __BUILD_STAMP__: JSON.stringify(new Date().toISOString().slice(0, 16).replace("T", " ") + "Z"),
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.0.0")
  },
  optimizeDeps: {
    // lindera-wasm resolves its .wasm sibling via `new URL(..., import.meta.url)`;
    // pre-bundling would relocate the glue and break that link (per its docs).
    exclude: ["lindera-wasm"]
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
    // No hmr key at all without a mobile host: HmrOptions takes no
    // explicit undefined.
    ...(host ? { hmr: { protocol: "ws", host, port: 1421 } } : {}),
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
