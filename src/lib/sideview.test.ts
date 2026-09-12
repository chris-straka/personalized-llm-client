import { describe, expect, it } from "vitest";
import {
	BROWSER_HOME_URL,
	BROWSER_SEARCH_PREFIX,
	SIDE_VIEW_DOCK_WIDTH,
	clampSideviewWidth,
	isSideviewUrlAllowed,
	resolveBrowserUrl,
	sideviewLayout,
	toggleSideviewOpen
} from "./sideview";

describe("resolveBrowserUrl", () => {
	it("opens home on empty input", () => {
		expect(resolveBrowserUrl("")).toBe(BROWSER_HOME_URL);
		expect(resolveBrowserUrl("   ")).toBe(BROWSER_HOME_URL);
		expect(isSideviewUrlAllowed(BROWSER_HOME_URL)).toBe(true);
	});

	it("loads full http(s) URLs as-is", () => {
		expect(resolveBrowserUrl("https://example.com/page")).toBe("https://example.com/page");
		expect(resolveBrowserUrl("http://localhost:1420/")).toBe("http://localhost:1420/");
	});

	it("adds https to bare hosts", () => {
		expect(resolveBrowserUrl("example.com")).toBe("https://example.com/");
		expect(resolveBrowserUrl("  example.com/docs  ")).toBe("https://example.com/docs");
	});

	it("searches anything that is not a URL", () => {
		expect(resolveBrowserUrl("cats")).toBe(`${BROWSER_SEARCH_PREFIX}cats`);
		expect(resolveBrowserUrl("what is furigana")).toBe(
			`${BROWSER_SEARCH_PREFIX}what%20is%20furigana`
		);
		// javascript: input must never become the tab URL.
		expect(resolveBrowserUrl("javascript:alert(1)")).toBe(
			`${BROWSER_SEARCH_PREFIX}javascript%3Aalert(1)`
		);
	});

	it("always resolves to a gate-allowed URL", () => {
		for (const raw of ["", "example.com", "cats and dogs", "javascript:alert(1)", "data:x"]) {
			expect(isSideviewUrlAllowed(resolveBrowserUrl(raw))).toBe(true);
		}
	});
});

describe("clampSideviewWidth", () => {
	it("rounds and clamps the dragged width into range", () => {
		expect(clampSideviewWidth(420.6)).toBe(421);
		expect(clampSideviewWidth(100)).toBe(280);
		expect(clampSideviewWidth(2000)).toBe(720);
		expect(clampSideviewWidth(500)).toBe(500);
	});
});

describe("isSideviewUrlAllowed", () => {
	it("allows remote http(s) pages", () => {
		expect(isSideviewUrlAllowed("https://duckduckgo.com/")).toBe(true);
		expect(isSideviewUrlAllowed("http://localhost:1420/")).toBe(true);
		expect(isSideviewUrlAllowed("  https://example.com/  ")).toBe(true);
	});

	it("rejects script, data, file, and unparseable URLs", () => {
		expect(isSideviewUrlAllowed("javascript:alert(1)")).toBe(false);
		expect(isSideviewUrlAllowed("JaVaScRiPt:alert(1)")).toBe(false);
		expect(isSideviewUrlAllowed("data:text/html,<h1>x</h1>")).toBe(false);
		expect(isSideviewUrlAllowed("file:///etc/passwd")).toBe(false);
		expect(isSideviewUrlAllowed("blob:https://example.com/x")).toBe(false);
		expect(isSideviewUrlAllowed("")).toBe(false);
		expect(isSideviewUrlAllowed("   ")).toBe(false);
		expect(isSideviewUrlAllowed("not a url")).toBe(false);
		expect(isSideviewUrlAllowed("//translate.google.com/")).toBe(false);
	});
});

describe("toggleSideviewOpen", () => {
	it("flips the open state", () => {
		expect(toggleSideviewOpen(false)).toBe(true);
		expect(toggleSideviewOpen(true)).toBe(false);
	});
});

describe("sideviewLayout", () => {
	it("splits wide windows: main left, panel docked right", () => {
		const layout = sideviewLayout(1280, 860);
		expect(layout.overlay).toBe(false);
		expect(layout.side.width).toBe(SIDE_VIEW_DOCK_WIDTH);
		expect(layout.side.x).toBe(1280 - SIDE_VIEW_DOCK_WIDTH);
		expect(layout.main).toEqual({ x: 0, y: 0, width: 1280 - SIDE_VIEW_DOCK_WIDTH, height: 860 });
		expect(layout.main.width + layout.side.width).toBe(1280);
	});

	it("clamps the dock on medium windows so the main view keeps 320px", () => {
		const layout = sideviewLayout(700, 500);
		expect(layout.overlay).toBe(false);
		expect(layout.main.width).toBeGreaterThanOrEqual(320);
		expect(layout.main.width + layout.side.width).toBe(700);
		expect(layout.side.width).toBeLessThan(SIDE_VIEW_DOCK_WIDTH);
	});

	it("overlays small viewports instead of splitting", () => {
		const layout = sideviewLayout(390, 844);
		expect(layout.overlay).toBe(true);
		expect(layout.side).toEqual({ x: 0, y: 0, width: 390, height: 844 });
	});

	it("never emits negative sizes", () => {
		const layout = sideviewLayout(0, 0);
		expect(layout.main.width).toBeGreaterThanOrEqual(0);
		expect(layout.side.width).toBeGreaterThanOrEqual(0);
		expect(sideviewLayout(-50, -20).side.width).toBe(0);
	});
});
