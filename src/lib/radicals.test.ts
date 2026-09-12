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
		// No hand table anymore: 漢 comes from the vendored subset
		// (finer grain than the old hand split 氵+堇).
		expect(decomposeChar("漢")).toEqual({ char: "漢", components: ["氵", "廿", "中", "夫"] });
	});

	it("returns null for unknown or non-Han input", () => {
		// 㐀 is Han but in neither the hand table nor the data subset.
		expect(decomposeChar("㐀")).toBeNull();
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
		const out = decomposeText("㐀");
		expect(out).toEqual([{ char: "㐀", components: [] }]);
	});

	it("returns nothing for text without Han characters", () => {
		expect(decomposeText("hello ひらがな")).toEqual([]);
	});
});

describe("vendored subset splits", () => {
	it("covers common characters from data", () => {
		// 館 resolves from the subset (variants normalized at
		// build time: 飠→食).
		expect(decomposeChar("館")).toEqual({ char: "館", components: ["食", "官"] });
		// 鬱 used to be the honest-null example; the subset covers it now.
		expect(decomposeChar("鬱")).toEqual({
			char: "鬱",
			components: ["林", "缶", "冖", "鬯", "彡"]
		});
	});

	it("uses the vendored data everywhere, Mainland forms included", () => {
		// No hand overrides left: 電 resolves to the subset's Mainland
		// form (雨+电, not the old hand split 日乚土).
		expect(decomposeChar("電")).toEqual({ char: "電", components: ["雨", "电"] });
		expect(decomposeChar("好")).toEqual({ char: "好", components: ["女", "子"] });
	});
});
