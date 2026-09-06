import { describe, it, expect } from "vitest";
import {
	LANGUAGE_MENUS,
	EUROPEAN_LANGUAGES,
	ASIAN_LANGUAGES,
	CLASSICAL_LANGUAGES,
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
			"hu"
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
			"hy"
		]);
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
});
