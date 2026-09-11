import { PROMPT_IDLE_MAX, PROMPT_IDLE_MIN } from "./settings";

/**
 * App-chrome helpers (pure, DOM-free): prompt idle-hide and slider
 * drag-to-reset. The Svelte shells own listeners and classes; the
 * decisions live here so Vitest can pin them.
 */

/** Pixels a slider drag must travel upward past its start to count as a reset. */
export const SLIDER_DRAG_RESET_PX = 48;

/**
 * Whether the prompt should hide: the last input was at least
 * `idleSec` seconds before `now` (epoch millis both). A non-positive
 * timeout disables hiding entirely.
 */
export function isPromptIdle(lastInputAt: number, now: number, idleSec: number): boolean {
	if (!(idleSec > 0)) return false;
	return now - lastInputAt >= idleSec * 1000;
}

/** Clamp a raw idle-timeout value into the settings range (whole seconds). */
export function clampPromptIdleSec(raw: number): number {
	if (typeof raw !== "number" || Number.isNaN(raw)) return PROMPT_IDLE_MIN;
	return Math.min(PROMPT_IDLE_MAX, Math.max(PROMPT_IDLE_MIN, Math.round(raw)));
}

/**
 * Whether a pointer gesture on a slider counts as "dragged upward past
 * its top": released at least SLIDER_DRAG_RESET_PX above where the
 * press began (clientY grows downward, so up means endY < startY).
 */
export function draggedSliderPastTop(startY: number, endY: number): boolean {
	return startY - endY >= SLIDER_DRAG_RESET_PX;
}
