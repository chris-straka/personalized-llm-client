import { describe, expect, it } from "vitest";
import {
	ESCAPE_HOLD_MS,
	GG_WINDOW_MS,
	HOVER_EDGE_MARGIN_PX,
	SCROLLKEY_LINE_PX,
	ggArmed,
	halfPageDy,
	isEscapeHold,
	messageEdgeScrollTop,
	unselectedScrollIntent
} from "./scrollkeys";

describe("unselectedScrollIntent", () => {
	it("steps a few lines on j/k", () => {
		expect(unselectedScrollIntent("j", false)).toEqual({ kind: "line", dy: SCROLLKEY_LINE_PX });
		expect(unselectedScrollIntent("k", false)).toEqual({ kind: "line", dy: -SCROLLKEY_LINE_PX });
		expect(SCROLLKEY_LINE_PX).toBeGreaterThan(0);
	});

	it("fast-scrolls on d/u", () => {
		expect(unselectedScrollIntent("d", false)).toEqual({ kind: "half-page", dir: 1 });
		expect(unselectedScrollIntent("u", false)).toEqual({ kind: "half-page", dir: -1 });
	});

	it("arms gg on the first g, tops on the second", () => {
		expect(unselectedScrollIntent("g", false)).toEqual({ kind: "gg-prefix" });
		expect(unselectedScrollIntent("g", true)).toEqual({ kind: "top" });
	});

	it("bottoms on G, lands the hovered message on z/Z", () => {
		expect(unselectedScrollIntent("G", false)).toEqual({ kind: "bottom" });
		expect(unselectedScrollIntent("z", false)).toEqual({ kind: "hovered-edge", edge: "start" });
		expect(unselectedScrollIntent("Z", false)).toEqual({ kind: "hovered-edge", edge: "end" });
	});

	it("leaves every other key (and shifted fast-scroll spellings) alone", () => {
		for (const key of ["J", "K", "D", "U", "f", "e", "x", " ", "Enter", "Escape", "ArrowDown"]) {
			expect(unselectedScrollIntent(key, false), key).toBeNull();
		}
		// Existing bindings keep their keys: bare f/e/x stay unclaimed.
		expect(unselectedScrollIntent("f", false)).toBeNull();
	});
});

describe("ggArmed", () => {
	it("arms inside the beat, expires past it", () => {
		expect(ggArmed(1000, 1000 + GG_WINDOW_MS - 1)).toBe(true);
		expect(ggArmed(1000, 1000 + GG_WINDOW_MS)).toBe(false);
		expect(ggArmed(0, Date.now())).toBe(false);
	});
});

describe("halfPageDy", () => {
	it("covers half the visible chat per d/u", () => {
		expect(halfPageDy(800, 1)).toBe(400);
		expect(halfPageDy(800, -1)).toBe(-400);
		expect(halfPageDy(1, 1)).toBe(1);
	});
});

describe("messageEdgeScrollTop", () => {
	it("parks the hovered top a margin under the chat top", () => {
		expect(
			messageEdgeScrollTop({ scrollTop: 200, boxTop: 100, elTop: 300, elHeight: 60, viewH: 600, edge: "start" })
		).toBe(200 + 200 - HOVER_EDGE_MARGIN_PX);
	});

	it("parks the hovered bottom a margin above the chat bottom", () => {
		expect(
			messageEdgeScrollTop({ scrollTop: 200, boxTop: 100, elTop: 300, elHeight: 60, viewH: 600, edge: "end" })
		).toBe(200 + 200 + 60 - 600 + HOVER_EDGE_MARGIN_PX);
	});
});

describe("isEscapeHold", () => {
	it("holds past the timer threshold, taps below it", () => {
		expect(isEscapeHold(1000, 1000 + ESCAPE_HOLD_MS)).toBe(true);
		expect(isEscapeHold(1000, 1000 + ESCAPE_HOLD_MS + 2000)).toBe(true);
		expect(isEscapeHold(1000, 1000 + ESCAPE_HOLD_MS - 1)).toBe(false);
		expect(isEscapeHold(1000, 1000)).toBe(false);
	});

	it("never fires without a tracked keydown", () => {
		expect(isEscapeHold(0, 60_000)).toBe(false);
	});
});
