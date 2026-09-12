// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import {
	decomposeChar,
	decomposeText,
	isHanChar,
	openHanPartsOverlay,
	closeHanPartsOverlay,
	isHanPartsOverlayOpen,
	shouldShowHanParts
} from "./radicals";

describe("isHanChar", () => {
	it("accepts CJK unified characters", () => {
		expect(isHanChar("漢")).toBe(true);
		expect(isHanChar("語")).toBe(true);
	});

	it("rejects kana, latin, and multi-char strings", () => {
		expect(isHanChar("あ")).toBe(false);
		expect(isHanChar("ア")).toBe(false);
		expect(isHanChar("a")).toBe(false);
		expect(isHanChar("漢字")).toBe(false);
		expect(isHanChar("")).toBe(false);
	});
});

describe("decomposeChar", () => {
	it("splits common characters into components", () => {
		expect(decomposeChar("好")).toEqual({ char: "好", components: ["女", "子"] });
		expect(decomposeChar("語")).toEqual({ char: "語", components: ["言", "吾"] });
		expect(decomposeChar("漢")).toEqual({ char: "漢", components: ["氵", "堇"] });
	});

	it("returns null for unknown or non-Han input", () => {
		// 鬱 is Han but outside the curated subset: honest null.
		expect(decomposeChar("鬱")).toBeNull();
		expect(decomposeChar("あ")).toBeNull();
	});
});

describe("decomposeText", () => {
	it("dedupes Han characters in order and skips kana", () => {
		const out = decomposeText("今日は語学");
		expect(out.map((e) => e.char)).toEqual(["今", "日", "語", "学"]);
		expect(out.find((e) => e.char === "語")?.components).toEqual(["言", "吾"]);
	});

	it("marks unknown Han characters with empty components", () => {
		const out = decomposeText("鬱");
		expect(out).toEqual([{ char: "鬱", components: [] }]);
	});

	it("returns nothing for text without Han characters", () => {
		expect(decomposeText("hello ひらがな")).toEqual([]);
	});
});

describe("shouldShowHanParts", () => {
	it("shows for multi-character highlights holding Han", () => {
		expect(shouldShowHanParts("漢字", true)).toBe(true);
		expect(shouldShowHanParts("漢字のテスト", true)).toBe(true);
		expect(shouldShowHanParts("你好世界", true)).toBe(true);
	});

	it("never shows for single characters (Inspect owns those)", () => {
		expect(shouldShowHanParts("語", true)).toBe(false);
		expect(shouldShowHanParts("あ", true)).toBe(false);
	});

	it("never shows without Han or without the setting", () => {
		expect(shouldShowHanParts("hello ひらがな", true)).toBe(false);
		expect(shouldShowHanParts("漢字", false)).toBe(false);
		expect(shouldShowHanParts("", true)).toBe(false);
	});
});

describe("character components overlay open/close", () => {
	beforeEach(() => {
		closeHanPartsOverlay();
	});

	it("opens a dialog showing components and closes it", () => {
		const el = openHanPartsOverlay({ x: 100, y: 100 }, "語学");
		expect(isHanPartsOverlayOpen()).toBe(true);
		expect(el.getAttribute("role")).toBe("dialog");
		expect(el.textContent).toContain("語");
		expect(el.textContent).toContain("言");
		expect(el.textContent).toContain("吾");

		closeHanPartsOverlay();
		expect(isHanPartsOverlayOpen()).toBe(false);
		expect(document.getElementById("han-parts-overlay")).toBeNull();
	});

	it("is never named Radicals", () => {
		const el = openHanPartsOverlay({ x: 10, y: 10 }, "好学");
		expect(el.textContent).toContain("Character components");
		expect(el.textContent).not.toMatch(/radical/i);
		expect(el.getAttribute("aria-label")).toBe("Character components");
	});

	it("reuses the existing ann-pop card styling", () => {
		const el = openHanPartsOverlay({ x: 10, y: 10 }, "好学");
		expect(el.classList.contains("ann-pop")).toBe(true);
	});

	it("says so honestly when nothing is decomposable", () => {
		const el = openHanPartsOverlay({ x: 10, y: 10 }, "hello");
		expect(el.textContent).toContain("No Han characters");
	});

	it("reopening replaces the previous overlay", () => {
		openHanPartsOverlay({ x: 10, y: 10 }, "好学");
		openHanPartsOverlay({ x: 20, y: 20 }, "明語");
		expect(document.querySelectorAll("#han-parts-overlay")).toHaveLength(1);
		expect(document.getElementById("han-parts-overlay")?.textContent).toContain("明");
	});

	it("Escape closes the overlay", () => {
		const el = openHanPartsOverlay({ x: 10, y: 10 }, "好学");
		el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(isHanPartsOverlayOpen()).toBe(false);
	});
});

describe("character components overlay language", () => {
	beforeEach(() => {
		closeHanPartsOverlay();
	});

	it("defaults to Chinese for Han-only text and offers a JP/中文 toggle", () => {
		const el = openHanPartsOverlay({ x: 10, y: 10 }, "漢字");
		const chars = el.querySelectorAll(".hp-char");
		expect(chars.length).toBeGreaterThan(0);
		for (const node of chars) {
			expect((node as HTMLElement).lang).toBe("zh-CN");
		}
		const toggle = el.querySelector(".hp-toggle");
		expect(toggle?.getAttribute("aria-label")).toBe("Reading language");
		expect(toggle?.textContent).toContain("JP");
		expect(toggle?.textContent).toContain("中文");
		// Chinese default is pressed; Japanese is not.
		expect(toggle?.querySelector('button[aria-label="Show Chinese reading"]')?.getAttribute("aria-pressed")).toBe(
			"true"
		);
	});

	it("the toggle flips every shown character to Japanese and back", () => {
		const el = openHanPartsOverlay({ x: 10, y: 10 }, "漢字");
		const jp = el.querySelector(
			'.hp-toggle button[aria-label="Show Japanese reading"]'
		) as HTMLButtonElement;
		jp.click();
		for (const node of el.querySelectorAll(".hp-char")) {
			expect((node as HTMLElement).lang).toBe("ja-JP");
		}
		expect(jp.getAttribute("aria-pressed")).toBe("true");
		const zh = el.querySelector(
			'.hp-toggle button[aria-label="Show Chinese reading"]'
		) as HTMLButtonElement;
		expect(zh.getAttribute("aria-pressed")).toBe("false");
		zh.click();
		for (const node of el.querySelectorAll(".hp-char")) {
			expect((node as HTMLElement).lang).toBe("zh-CN");
		}
	});

	it("kana present reads as Japanese with no toggle (unambiguous)", () => {
		const el = openHanPartsOverlay({ x: 10, y: 10 }, "漢字を読む");
		for (const node of el.querySelectorAll(".hp-char")) {
			expect((node as HTMLElement).lang).toBe("ja-JP");
		}
		expect(el.querySelector(".hp-toggle")).toBeNull();
	});
});
