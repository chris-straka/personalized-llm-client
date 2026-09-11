import { describe, expect, it } from "vitest";
import {
	SIDE_VIEW_DOCK_WIDTH,
	SIDE_VIEW_ENGINES,
	isSideviewUrlAllowed,
	sideviewEngine,
	sideviewLayout,
	toggleSideviewOpen
} from "./sideview";

describe("sideview engines", () => {
	it("defaults to Google Translate with Bing as fallback", () => {
		expect(SIDE_VIEW_ENGINES[0]?.id).toBe("google");
		expect(SIDE_VIEW_ENGINES.map((engine) => engine.id)).toContain("bing");
		for (const engine of SIDE_VIEW_ENGINES) {
			expect(engine.url.startsWith("https://")).toBe(true);
			expect(isSideviewUrlAllowed(engine.url)).toBe(true);
		}
	});

	it("resolves unknown engine ids to the default", () => {
		expect(sideviewEngine("google").id).toBe("google");
		expect(sideviewEngine("bing").id).toBe("bing");
		expect(sideviewEngine("nope").id).toBe("google");
		expect(sideviewEngine("").id).toBe("google");
	});
});

describe("isSideviewUrlAllowed", () => {
	it("allows remote http(s) pages", () => {
		expect(isSideviewUrlAllowed("https://translate.google.com/")).toBe(true);
		expect(isSideviewUrlAllowed("http://localhost:1420/")).toBe(true);
		expect(isSideviewUrlAllowed("  https://www.bing.com/translator  ")).toBe(true);
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
