// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { decomposeChar, decomposeText, isHanChar } from "./radicals";

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
