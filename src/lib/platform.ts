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

/** One tracked touch point (identifier + last-seen position). */
export interface FingerTrack {
	id: number;
	x: number;
	y: number;
}

/**
 * Two-finger chat step: both fingers glide together along whichever axis
 * dominates. Pinches change finger spread instead of gliding, so a spread
 * change vetoes the step and page zoom keeps working. Right/down steps
 * newer (+1), left/up steps older (-1). One finger still scrolls, so the
 * spare second finger owns navigation.
 */
export function twoFingerSwipeDir(
	start: [FingerTrack, FingerTrack],
	end: [FingerTrack, FingerTrack],
	minDistance = 96
): 1 | -1 | null {
	const delta = (i: number, axis: "x" | "y"): number | null => {
		const s = start[i];
		const e = end[i];
		if (!s || !e) return null;
		return e[axis] - s[axis];
	};
	const dx0 = delta(0, "x");
	const dx1 = delta(1, "x");
	const dy0 = delta(0, "y");
	const dy1 = delta(1, "y");
	if (dx0 === null || dx1 === null || dy0 === null || dy1 === null) return null;
	// Dominant axis wins; both fingers must agree on its direction.
	const horizontal = Math.abs(dx0) + Math.abs(dx1) >= Math.abs(dy0) + Math.abs(dy1);
	const d0 = horizontal ? dx0 : dy0;
	const d1 = horizontal ? dx1 : dy1;
	const c0 = horizontal ? dy0 : dx0;
	const c1 = horizontal ? dy1 : dx1;
	if (d0 === 0 || Math.sign(d0) !== Math.sign(d1)) return null;
	const d = (d0 + d1) / 2;
	if (Math.abs(d) < minDistance) return null;
	if (Math.abs(c0) > Math.abs(d) / 2 || Math.abs(c1) > Math.abs(d) / 2) return null;
	const spread0 = Math.hypot(start[0].x - start[1].x, start[0].y - start[1].y);
	const spread1 = Math.hypot(end[0].x - end[1].x, end[0].y - end[1].y);
	if (Math.abs(spread1 - spread0) > 24) return null;
	return d > 0 ? 1 : -1;
}

/**
 * Three-finger double-tap delete: each tap is short, near-stationary, and
 * exactly three fingers. The pairing window lives at the call site (it
 * needs a clock); this judges one tap. Pure so the shape unit-tests
 * without touch hardware.
 */
export function isThreeFingerTap(
	fingers: number,
	moved: number,
	durationMs: number,
	maxMove = 12,
	maxDuration = 400
): boolean {
	return fingers === 3 && moved <= maxMove && durationMs <= maxDuration;
}

/**
 * Provider ids visible under the platform caps. `local-gemma` is the
 * future on-device entry: it lists only on Android (nowhere else has
 * its bridge), and it is the ONLY entry when Android is offline —
 * cloud models can't answer without a connection. Desktop and online
 * phones see everything. Pure so the contract unit-tests without a
 * device; call sites feed `navigator.onLine` plus online/offline
 * events when the bridge lands.
 */
export function visibleProviderIds(
	all: string[],
	caps: { android: boolean; online: boolean; local: boolean }
): string[] {
	const listed = all.filter((id) => id !== "local-gemma" || (caps.android && caps.local));
	if (caps.android && !caps.online) return listed.filter((id) => id === "local-gemma");
	return listed;
}

/**
 * Edge-swipe target for touch sidebars: a mostly-horizontal swipe of at
 * least `minDistance` px starting inside the screen's edge zone. Left
 * edge swipes right to open chats; right edge swipes left for settings.
 * Vertical scrolls, short drags, and mid-screen swipes never qualify,
 * so code blocks and the prompt keep their own gestures. (A bottom-up
 * summon was tried and dropped: it fires during message scrolling.)
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

/**
 * Mid-screen swipe (phone only): right opens chats, left opens settings.
 * Longer stroke than the edge rule, since mid-screen horizontal drift
 * during vertical scrolling is common. Callers gate this on the Android
 * UA plus their own guards (no text selected, started outside editable
 * text) — desktops with touchscreens must never see it.
 */
export function contentSwipeTarget(
	startX: number,
	startY: number,
	endX: number,
	endY: number,
	minDistance = 64
): EdgePanel | null {
	const dx = endX - startX;
	const dy = endY - startY;
	if (Math.abs(dx) < minDistance || Math.abs(dy) > Math.abs(dx)) return null;
	return dx > 0 ? "chats" : "settings";
}
