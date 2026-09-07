import { describe, it, expect } from "vitest";
import { hasQualityVoices, tierLabel, voicesForLang } from "./voiceTiers";
import type { NativeVoice } from "./nativeTts";

const voice = (id: string, lang: string, quality: number, name?: string): NativeVoice => ({
	id,
	name: name ?? id.split(".").pop() ?? id,
	lang,
	quality
});

describe("hasQualityVoices", () => {
	it("is true when a premium or enhanced voice is installed", () => {
		const voices = [
			voice("com.apple.voice.compact.en-US.Samantha", "en-US", 1),
			voice("com.apple.voice.enhanced.bg-BG.Daria", "bg-BG", 2)
		];
		expect(hasQualityVoices(voices)).toBe(true);
		expect(
			hasQualityVoices([voice("com.apple.voice.premium.de-DE.Petra", "de-DE", 3)])
		).toBe(true);
	});

	it("is false for default-tier voices, Siri personas, and empty lists", () => {
		expect(
			hasQualityVoices([
				voice("com.apple.voice.compact.en-US.Samantha", "en-US", 1),
				voice("com.apple.eloquence.en-US.Eddy", "en-US", 1),
				voice("a", "en-US", 0)
			])
		).toBe(false);
		expect(hasQualityVoices([])).toBe(false);
	});
});

describe("tierLabel", () => {
	it("labels premium, enhanced, Siri, and default voices", () => {
		expect(tierLabel(voice("com.apple.voice.premium.de-DE.Petra", "de-DE", 3))).toBe("premium");
		expect(tierLabel(voice("com.apple.voice.enhanced.bg-BG.Daria", "bg-BG", 2))).toBe(
			"enhanced"
		);
		expect(tierLabel(voice("com.apple.eloquence.en-US.Eddy", "en-US", 1))).toBe("Siri");
		expect(tierLabel(voice("com.apple.voice.compact.en-US.Samantha", "en-US", 1))).toBe(
			"default"
		);
	});
});

describe("voicesForLang", () => {
	const voices = [
		voice("com.apple.voice.compact.en-GB.Daniel", "en-GB", 1, "Daniel"),
		voice("com.apple.voice.premium.en-GB.Malcolm", "en-GB", 3, "Jamie"),
		voice("com.apple.voice.premium.de-DE.Petra", "de-DE", 3, "Petra"),
		voice("com.apple.voice.compact.en-US.Samantha", "en-US", 1, "Samantha"),
		voice("com.apple.eloquence.en-US.Eddy", "en-US", 1, "Eddy"),
		voice("com.apple.voice.enhanced.en-US.Zoe", "en-US", 2, "Zoe")
	];

	it("lists the exact locale first, then the same language", () => {
		expect(voicesForLang(voices, "en-US").map((v) => v.name)).toEqual(["Zoe", "Jamie"]);
		expect(voicesForLang(voices, "de-DE").map((v) => v.name)).toEqual(["Petra"]);
	});

	it("leaves out default-tier voices, including Siri personas", () => {
		const names = voicesForLang(voices, "en-US").map((v) => v.name);
		expect(names).not.toContain("Daniel");
		expect(names).not.toContain("Samantha");
		expect(names).not.toContain("Eddy");
	});

	it("matches locales case-insensitively and sorts by name", () => {
		expect(voicesForLang(voices, "EN-us").map((v) => v.id)).toEqual([
			"com.apple.voice.enhanced.en-US.Zoe",
			"com.apple.voice.premium.en-GB.Malcolm"
		]);
	});

	it("is empty when the language has nothing above the default tier", () => {
		expect(voicesForLang(voices, "fr-FR")).toEqual([]);
	});

	it("attaches tier labels to options", () => {
		expect(voicesForLang(voices, "en-US")[1]).toMatchObject({
			name: "Jamie",
			lang: "en-GB",
			tier: "premium"
		});
	});
});
