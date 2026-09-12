import { defineConfig } from "@playwright/test";
// Explicit import (never global `process`): see vite.config.js.
import process from "node:process";

// E2E_PORT isolates parallel checkouts/agents: each suite gets its own dev
// server instead of sharing (and killing) port 5213 via reuseExistingServer.
const PORT = Number(process.env.E2E_PORT ?? 5213);

export default defineConfig({
	testDir: "e2e",
	// Vitest's default include would also grab *.spec.ts, so e2e specs
	// use *.e2e.ts and are invisible to `bun run test`.
	testMatch: "**/*.e2e.ts",
	timeout: 60_000,
	expect: { timeout: 10_000 },
	fullyParallel: false,
	// Two browsers at a time: the suite boots one dev server, and more
	// workers only contend on cold compile (seen as flakes, never signal).
	workers: 2,
	// One retry absorbs cold-compile flakes (two workers contending on the
	// first Vite compile can exceed the timeout once, then pass warm).
	// Persistent failures still fail twice, so retries never hide signal.
	retries: 1,
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		trace: "retain-on-failure"
	},
	webServer: {
		command: `bun run dev -- --port ${PORT} --strictPort`,
		url: `http://127.0.0.1:${PORT}`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000
	}
});
