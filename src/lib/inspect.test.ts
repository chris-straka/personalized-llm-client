import { describe, expect, it } from "vitest";
import { getInspectData, isSingleHanChar, shouldShowInspect } from "./inspect";
import { defaultSettings, loadSettings, saveSettings, memoryStore } from "./settings";

describe("isSingleHanChar", () => {
	it("accepts exactly one Han character", () => {
		expect(isSingleHanChar("語")).toBe(true);
		expect(isSingleHanChar(" 漢 ")).toBe(true);
	});

	it("rejects multi-char, kana, latin, and empty highlights", () => {
		expect(isSingleHanChar("漢字")).toBe(false);
		expect(isSingleHanChar("あ")).toBe(false);
		expect(isSingleHanChar("ア")).toBe(false);
		expect(isSingleHanChar("a")).toBe(false);
		expect(isSingleHanChar("")).toBe(false);
		expect(isSingleHanChar("  ")).toBe(false);
		expect(isSingleHanChar("語学")).toBe(false);
	});
});

describe("shouldShowInspect", () => {
	it("requires the setting AND a single Han character", () => {
		expect(shouldShowInspect("語", true)).toBe(true);
		expect(shouldShowInspect("語", false)).toBe(false);
	});

	it("never shows for multi-char or non-CJK highlights", () => {
		expect(shouldShowInspect("漢字", true)).toBe(false);
		expect(shouldShowInspect("テスト", true)).toBe(false);
		expect(shouldShowInspect("hello", true)).toBe(false);
		expect(shouldShowInspect("", true)).toBe(false);
		expect(shouldShowInspect("あ", true)).toBe(false);
	});

	it("never shows anywhere when the setting is off", () => {
		expect(shouldShowInspect("語", false)).toBe(false);
		expect(shouldShowInspect("漢", false)).toBe(false);
	});
});

describe("getInspectData", () => {
	it("returns radicals, stroke count, and definition offline", () => {
		expect(getInspectData("語")).toEqual({
			char: "語",
			components: ["言", "吾"],
			strokeCount: 14,
			definition: "language; to speak",
			mandarin: "yǔ",
			japaneseOn: "GO GYO",
			japaneseKun: "KATARU KOTOBA TSUGERU",
			hasStrokePaths: false
		});
		expect(getInspectData("好")).toMatchObject({
			components: ["女", "子"],
			strokeCount: 6
		});
	});

	it("trims the input before lookup", () => {
		expect(getInspectData(" 漢 ").char).toBe("漢");
		expect(getInspectData(" 漢 ").strokeCount).toBe(13);
	});

	it("falls back honestly outside the compact table", () => {
		// 鬱 is Han but outside the hand table: the vendored subset
		// supplies components; Unihan still enriches readings.
		const out = getInspectData("鬱");
		expect(out).toEqual({
			char: "鬱",
			components: ["林", "缶", "冖", "鬯", "彡"],
			strokeCount: null,
			definition: "luxuriant; dense, thick; moody",
			mandarin: "yù",
			japaneseOn: "UTSU",
			japaneseKun: "SHIGERU",
			hasStrokePaths: false
		});
	});

	it("prefers the curated gloss over the Unihan definition", () => {
		// The curated table's short gloss wins; Unihan's longer
		// "language, words; saying, expression" stays the fallback.
		expect(getInspectData("語").definition).toBe("language; to speak");
	});

	it("reports null readings for characters outside Unihan coverage", () => {
		expect(getInspectData("あ")).toMatchObject({
			definition: null,
			mandarin: null,
			japaneseOn: null,
			japaneseKun: null
		});
	});

	it("reports no bundled stroke paths (KanjiVG follow-up)", () => {
		expect(getInspectData("語").hasStrokePaths).toBe(false);
	});
});

describe("inspect setting", () => {
	it("defaults off (opt-in)", () => {
		expect(defaultSettings().inspectEnabled).toBe(false);
	});

	it("backfills false on older saves and keeps an explicit on", () => {
		const blank = defaultSettings();
		blank.providers["deepseek"]!.apiKey = "";
		blank.providers["muse"]!.apiKey = "";
		delete (blank as unknown as Record<string, unknown>).inspectEnabled;
		saveSettings(blank, memoryStore);
		expect(loadSettings(memoryStore).inspectEnabled).toBe(false);

		const on = defaultSettings();
		on.providers["deepseek"]!.apiKey = "";
		on.providers["muse"]!.apiKey = "";
		on.inspectEnabled = true;
		saveSettings(on, memoryStore);
		expect(loadSettings(memoryStore).inspectEnabled).toBe(true);

		const junk = defaultSettings();
		junk.providers["deepseek"]!.apiKey = "";
		junk.providers["muse"]!.apiKey = "";
		(junk as unknown as Record<string, unknown>).inspectEnabled = "yes";
		saveSettings(junk, memoryStore);
		expect(loadSettings(memoryStore).inspectEnabled).toBe(false);
	});
});
