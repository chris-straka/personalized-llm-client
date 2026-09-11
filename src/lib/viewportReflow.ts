/**
 * Viewport reflow helpers (search-mobile bucket): pure math for the
 * VisualViewport-based composer reflow above the Android keyboard.
 * Call sites feed `window.innerHeight` plus the visual viewport's
 * height/offsetTop; tests pass explicit values — Vitest runs in node,
 * where no viewport exists.
 */

/** Pixels of the layout viewport covered by the keyboard (0 when closed). */
export function keyboardOverlapPx(
	innerHeight: number,
	viewportHeight: number,
	viewportOffsetTop = 0
): number {
	return Math.max(0, innerHeight - viewportHeight - viewportOffsetTop);
}

/**
 * True when the overlap reads as an open soft keyboard rather than
 * rounding noise or a partially-visible viewport. Matches the 100px
 * floor the page already used before this helper existed.
 */
export function isKeyboardOpen(
	innerHeight: number,
	viewportHeight: number,
	viewportOffsetTop = 0,
	minOverlap = 100
): boolean {
	return keyboardOverlapPx(innerHeight, viewportHeight, viewportOffsetTop) >= minOverlap;
}
