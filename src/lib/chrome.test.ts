import { describe, expect, it } from "vitest";
import {
	clampPromptIdleSec,
	draggedSliderPastTop,
	isPromptIdle,
	SLIDER_DRAG_RESET_PX
} from "./chrome";
import { PROMPT_IDLE_DEFAULT, PROMPT_IDLE_MAX, PROMPT_IDLE_MIN } from "./settings";

describe("isPromptIdle", () => {
	it("hides once the timeout has fully elapsed", () => {
		expect(isPromptIdle(0, 5999, 6)).toBe(false);
		expect(isPromptIdle(0, 6000, 6)).toBe(true);
		expect(isPromptIdle(0, 60_001, 6)).toBe(true);
	});

	it("never hides on a non-positive timeout", () => {
		expect(isPromptIdle(0, 3_600_000, 0)).toBe(false);
		expect(isPromptIdle(0, 3_600_000, -5)).toBe(false);
	});

	it("restores the instant fresh input lands", () => {
		const now = 100_000;
		expect(isPromptIdle(now, now, 6)).toBe(false);
	});
});

describe("clampPromptIdleSec", () => {
	it("rounds to whole seconds inside the range", () => {
		expect(clampPromptIdleSec(6.4)).toBe(6);
		expect(clampPromptIdleSec(PROMPT_IDLE_DEFAULT)).toBe(PROMPT_IDLE_DEFAULT);
	});

	it("clamps strays to the range edges", () => {
		expect(clampPromptIdleSec(PROMPT_IDLE_MIN - 10)).toBe(PROMPT_IDLE_MIN);
		expect(clampPromptIdleSec(PROMPT_IDLE_MAX + 10)).toBe(PROMPT_IDLE_MAX);
		expect(clampPromptIdleSec(Number.NaN)).toBe(PROMPT_IDLE_MIN);
	});
});

describe("draggedSliderPastTop", () => {
	it("needs a full upward travel past the threshold", () => {
		expect(draggedSliderPastTop(200, 200 - SLIDER_DRAG_RESET_PX)).toBe(true);
		expect(draggedSliderPastTop(200, 200 - SLIDER_DRAG_RESET_PX + 1)).toBe(false);
	});

	it("ignores downward and sideways travel", () => {
		expect(draggedSliderPastTop(200, 400)).toBe(false);
		expect(draggedSliderPastTop(200, 200)).toBe(false);
	});
});
