/**
 * Mobile-platform guards (Android milestone): the desktop app assumes a
 * keyboard, hover, and macOS speech. These pure helpers decide the
 * touch/Android branches. Call sites read navigator/matchMedia; tests
 * pass explicit values — Vitest runs in node, where neither exists.
 */

/** Android WebView or browser, by user agent string. */
export function isAndroidUserAgent(ua: string): boolean {
	return /android/i.test(ua);
}

/**
 * Primary input is touch (no hover to wait for). The query runner is
 * injected so tests can stub it: pass `(q) => window.matchMedia(q)`.
 */
export function isCoarsePointer(query: (media: string) => { matches: boolean }): boolean {
	try {
		return query("(pointer: coarse)").matches;
	} catch {
		return false;
	}
}

export type EdgePanel = "chats" | "settings";

/**
 * Edge-swipe target for touch sidebars: a mostly-horizontal swipe of at
 * least `minDistance` px starting inside the screen's edge zone. Left
 * edge swipes right to open chats; right edge swipes left for settings.
 * Vertical scrolls, short drags, and mid-screen swipes never qualify,
 * so code blocks and the prompt keep their own gestures.
 */
export function edgeSwipeTarget(
	startX: number,
	startY: number,
	endX: number,
	endY: number,
	width: number,
	minDistance = 48,
	edgeZone = 24
): EdgePanel | null {
	const dx = endX - startX;
	const dy = endY - startY;
	if (Math.abs(dx) < minDistance || Math.abs(dy) > Math.abs(dx)) return null;
	if (dx > 0 && startX <= edgeZone) return "chats";
	if (dx < 0 && startX >= width - edgeZone) return "settings";
	return null;
}
