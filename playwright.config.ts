import { defineConfig } from "@playwright/test";
// Explicit import (never global `process`): see vite.config.js.
import process from "node:process";

const PORT = 5213;

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
	retries: 0,
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
