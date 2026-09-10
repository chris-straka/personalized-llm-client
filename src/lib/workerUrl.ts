/**
 * App-root derivation for Web Workers. A bundled worker chunk lives in
 * `_app/immutable/workers`, so a relative asset URL resolves under it
 * and 404s (this broke the furigana dictionary in production builds,
 * where BASE_URL inlines as "./"). SvelteKit's `$app/paths` cannot
 * help: it pulls the client runtime, whose top-level `window` patch
 * throws in a worker. Derive the root from our own script URL instead:
 * production chunks sit under `_app/` (subpath deployments included),
 * while vite dev serves the app at the server root.
 */
export function appRoot(workerHref: string): string {
	const appDir = workerHref.indexOf("/_app/");
	if (appDir >= 0) return workerHref.slice(0, appDir);
	return new URL("/", workerHref).origin;
}
