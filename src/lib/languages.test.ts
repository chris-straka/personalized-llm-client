import { describe, it, expect } from "vitest";
import {
	LANGUAGE_MENUS,
	EUROPEAN_LANGUAGES,
	ASIAN_LANGUAGES,
	CLASSICAL_LANGUAGES,
	QUICK_LANG_CODES,
	quickKeyFor,
	replyLanguageFor
} from "./languages";

describe("reply languages", () => {
	it("has three menus in order", () => {
		expect(LANGUAGE_MENUS.map((m) => m.id)).toEqual(["europe", "asia", "classics"]);
	});

	it("keeps the requested European order", () => {
		expect(EUROPEAN_LANGUAGES.map((l) => l.code)).toEqual([
			"fr",
			"de",
			"es",
			"pt",
			"ru",
			"pl",
			"it",
			"no",
			"cs",
			"el",
			"ro",
			"bg",
			"hu",
			"uk",
			"nl"
		]);
	});

	it("keeps the requested Asian order", () => {
		expect(ASIAN_LANGUAGES.map((l) => l.code)).toEqual([
			"zh",
			"ja",
			"ko",
			"ar",
			"hi",
			"id",
			"tr",
			"fa",
			"th",
			"vi",
			"hy",
			"ur",
			"he"
		]);
	});

	it("labels Arabic short and resolves the new languages", () => {
		expect(replyLanguageFor("ar")?.name).toBe("Arabic (MSA)");
		expect(replyLanguageFor("ar")?.prompt).toBe("Reply in Modern Standard Arabic.");
		for (const code of ["uk", "nl", "ur", "he"]) {
			expect(replyLanguageFor(code)?.prompt).toBe(`Reply in ${replyLanguageFor(code)?.name}.`);
		}
		expect(quickKeyFor("ar")).toBe("⌘8");
	});

	it("lists Latin, Ancient Greek, Sanskrit", () => {
		expect(CLASSICAL_LANGUAGES.map((l) => l.code)).toEqual(["la", "grc", "sa"]);
	});

	it("resolves codes and tolerates unknowns", () => {
		expect(replyLanguageFor("ja")?.prompt).toBe("Reply in Japanese.");
		expect(replyLanguageFor("ja")?.voice).toBe("ja-JP");
		expect(replyLanguageFor(null)).toBeNull();
		expect(replyLanguageFor("xx")).toBeNull();
	});

	it("maps ⌘1…⌘0 to the priority flags in order", () => {
		expect([...QUICK_LANG_CODES]).toEqual([
			"fr",
			"de",
			"es",
			"zh",
			"ja",
			"pt",
			"ko",
			"ar",
			"hi",
			"ru"
		]);
	});

	it("resolves every quick code and labels its key", () => {
		for (const code of QUICK_LANG_CODES) {
			expect(replyLanguageFor(code)).not.toBeNull();
		}
		expect(quickKeyFor("fr")).toBe("⌘1");
		expect(quickKeyFor("zh")).toBe("⌘4");
		expect(quickKeyFor("hi")).toBe("⌘9");
		expect(quickKeyFor("ru")).toBe("⌘0");
		expect(quickKeyFor("it")).toBeNull();
		expect(quickKeyFor("xx")).toBeNull();
	});
});
