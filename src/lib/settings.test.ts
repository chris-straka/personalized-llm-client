import { describe, it, expect } from "vitest";
import {
	defaultSettings,
	envProviderDefaults,
	loadSettings,
	saveSettings,
	memoryStore,
	DEFAULT_SYSTEM_PROMPT,
	cycleThinkingLevel,
	effectiveSystemPrompt
} from "./settings";

/** Blank slate: tests must never see the developer's real `.env`. */
function blankSettings() {
	const s = defaultSettings();
	s.providers["deepseek"].apiKey = "";
	s.providers["muse"].apiKey = "";
	return s;
}

describe("settings", () => {
	it("defaults to high thinking, aids off, voice off, empty system prompt", () => {
		const s = defaultSettings();
		expect(s.thinkingLevel).toBe("high");
		expect(s.readingAids).toBe(false);
		expect(s.voice).toBe(false);
		expect(s.voiceLang).toBe("en-US");
		expect(s.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
		expect(s.providers["deepseek"].model).toBe("deepseek-v4-pro");
		expect(s.providers["muse"].model).toBe("muse-spark-1.3-contributor");
	});

	it("cycles low → medium → high and back", () => {
		expect(cycleThinkingLevel("low", 1)).toBe("medium");
		expect(cycleThinkingLevel("medium", 1)).toBe("high");
		expect(cycleThinkingLevel("high", 1)).toBe("low");
		expect(cycleThinkingLevel("high", -1)).toBe("medium");
		expect(cycleThinkingLevel("low", -1)).toBe("high");
	});

	it("composes thinking hint and reply language into the prompt", () => {
		const s = defaultSettings();
		s.systemPrompt = "Be brief.";
		expect(effectiveSystemPrompt(s)).toBe("Be brief. Think carefully before answering.");
		s.thinkingLevel = "medium";
		expect(effectiveSystemPrompt(s)).toBe("Be brief.");
		s.thinkingLevel = "low";
		s.replyLang = "fr";
		expect(effectiveSystemPrompt(s)).toBe(
			"Be brief. Answer directly with minimal deliberation. Reply in French."
		);
		s.replyLang = "nope";
		expect(effectiveSystemPrompt(s)).toBe("Be brief. Answer directly with minimal deliberation.");
	});

	it("defaults to Muse with an empty system prompt", () => {
		const s = defaultSettings();
		expect(s.activeProviderId).toBe("muse");
		expect(s.systemPrompt).toBe("");
	});

	it("never clobbers a saved key when loading", () => {
		const s = blankSettings();
		s.providers["muse"].apiKey = "typed";
		saveSettings(s, memoryStore);
		expect(loadSettings(memoryStore).providers["muse"].apiKey).toBe("typed");
	});

	it("resolves dev-time env names, VITE_ first", () => {
		expect(
			envProviderDefaults({
				META_OPENAI_API_KEY_MUSE_SPARK_ONE_POINT_THREE: "sk-legacy",
				META_BASE_URL: "https://meta.example"
			}).muse
		).toEqual({
			baseUrl: "https://meta.example",
			apiKey: "sk-legacy",
			model: "muse-spark-1.3-contributor"
		});
		expect(
			envProviderDefaults({
				META_OPENAI_API_KEY_MUSE_SPARK_ONE_POINT_THREE: "sk-legacy",
				VITE_MUSE_API_KEY: "sk-vite"
			}).muse.apiKey
		).toBe("sk-vite");
		expect(envProviderDefaults({}).muse.apiKey).toBe("");
	});

	it("round-trips through a store and survives corrupt JSON", () => {
		const s = blankSettings();
		s.providers["muse"].apiKey = "secret";
		saveSettings(s, memoryStore);
		const loaded = loadSettings(memoryStore);
		expect(loaded.providers["muse"].apiKey).toBe("secret");

		memoryStore.setItem("ccez-studio-settings-v1", "{not json");
		expect(loadSettings(memoryStore)).toEqual(defaultSettings());
	});
});
