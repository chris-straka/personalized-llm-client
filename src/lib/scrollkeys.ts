/**
 * Scrollkeys (bucket): desktop keyboard scrolling when no message is
 * selected, plus the press-and-HOLD Escape threshold for exiting
 * fullscreen. Pure helpers only — call sites feed DOM measurements
 * (scrollBox rects, `Date.now()`); Vitest runs in node, where no
 * window exists. DOM work stays in `+page.svelte`.
 */

/** One j/k step: a few lines, fixed so unit tests can pin it. */
export const SCROLLKEY_LINE_PX = 72;

/** How long Escape must be held to exit fullscreen: two full seconds,
Chrome parity — a tap or a firm press still only dismisses
menus/overlays exactly as today. */
export const ESCAPE_HOLD_MS = 2000;

/** Lone-g arming window for gg (mirrors the scroll-mode beat). */
export const GG_WINDOW_MS = 800;

/** Breathing room above/below a z/Z-landed message (matches the
chat's 1rem scroll-padding-top). */
export const HOVER_EDGE_MARGIN_PX = 16;

/** What a bare keypress means when nothing is selected (desktop,
outside the prompt/fields/menus — the page owns the guards). */
export type UnselectedScrollIntent =
	| { kind: "line"; dy: number }
	| { kind: "half-page"; dir: 1 | -1 }
	| { kind: "gg-prefix" }
	| { kind: "top" }
	| { kind: "bottom" }
	| { kind: "hovered-edge"; edge: "start" | "end" };

/**
 * Classify a bare keydown with no message selected. `gArmed` is true
 * while a lone g is still inside its beat (see `ggArmed`); shifted
 * keys arrive as their uppercase spelling ("G", "Z").
 */
export function unselectedScrollIntent(key: string, gArmed: boolean): UnselectedScrollIntent | null {
	switch (key) {
		case "j":
			return { kind: "line", dy: SCROLLKEY_LINE_PX };
		case "k":
			return { kind: "line", dy: -SCROLLKEY_LINE_PX };
		case "d":
			return { kind: "half-page", dir: 1 };
		case "u":
			return { kind: "half-page", dir: -1 };
		case "g":
			return gArmed ? { kind: "top" } : { kind: "gg-prefix" };
		case "G":
			return { kind: "bottom" };
		case "z":
			return { kind: "hovered-edge", edge: "start" };
		case "Z":
			return { kind: "hovered-edge", edge: "end" };
		default:
			return null;
	}
}

/** True while a lone g is still inside its gg beat. */
export function ggArmed(lastGAt: number, now: number, windowMs = GG_WINDOW_MS): boolean {
	return now - lastGAt < windowMs;
}

/** d/u fast scroll distance: half the visible chat height. */
export function halfPageDy(viewH: number, dir: 1 | -1): number {
	return dir * Math.max(1, Math.floor(viewH / 2));
}

/**
 * Target scrollTop landing the hovered message's top (`start`, z)
 * or bottom (`end`, Z) in view. All inputs are measured pixels:
 * the chat box's current scrollTop, the box and message top edges
 * in the same (viewport) coordinate space, the message height, and
 * the visible chat height.
 */
export function messageEdgeScrollTop(args: {
	scrollTop: number;
	boxTop: number;
	elTop: number;
	elHeight: number;
	viewH: number;
	edge: "start" | "end";
	margin?: number;
}): number {
	const margin = args.margin ?? HOVER_EDGE_MARGIN_PX;
	const elTopInBox = args.scrollTop + (args.elTop - args.boxTop);
	if (args.edge === "start") return elTopInBox - margin;
	return elTopInBox + args.elHeight - args.viewH + margin;
}

/**
 * True when an Escape press counts as a HOLD (exit fullscreen) rather
 * than a tap (dismiss menus/overlays as today). `downAt` is the
 * keydown timestamp (0 when no press is tracked); `now` the keyup
 * timestamp, both from the same clock.
 */
export function isEscapeHold(downAt: number, now: number, thresholdMs = ESCAPE_HOLD_MS): boolean {
	return downAt > 0 && now - downAt >= thresholdMs;
}

/** Hold-to-glide velocity for j/k: continuous pixels per second. */
export const SCROLLKEY_JK_VELOCITY_PX_S = 720;

/** Hold-to-glide velocity for d/u: deliberately faster than j/k. */
export const SCROLLKEY_DU_VELOCITY_PX_S = 2520;

/** A hold shorter than this is a tap: it lands one discrete step. */
export const SCROLL_HOLD_TAP_MS = 150;

/**
 * Glide velocity for a held scroll key, or null for keys that do not
 * glide (gg/G/z/Z and everything else keep their discrete behavior).
 */
export function scrollHoldVelocity(key: string): number | null {
	switch (key) {
		case "j":
			return SCROLLKEY_JK_VELOCITY_PX_S;
		case "k":
			return -SCROLLKEY_JK_VELOCITY_PX_S;
		case "d":
			return SCROLLKEY_DU_VELOCITY_PX_S;
		case "u":
			return -SCROLLKEY_DU_VELOCITY_PX_S;
		default:
			return null;
	}
}

/** Advance a glide by one frame: pure so tests can pin the pacing. */
export function stepScrollTop(current: number, velocityPxS: number, dtMs: number): number {
	return current + (velocityPxS * Math.max(0, dtMs)) / 1000;
}

/** True when a key hold was really a tap (lands one discrete step). */
export function holdIsTap(downAt: number, upAt: number, tapMs = SCROLL_HOLD_TAP_MS): boolean {
	return downAt > 0 && upAt - downAt < tapMs;
}
