import { describe, it, expect } from "vitest";
import {
	defaultSettings,
	loadSettings,
	saveSettings,
	memoryStore,
	DEFAULT_SYSTEM_PROMPT,
	cycleThinkingLevel,
	effectiveSystemPrompt
} from "./settings";

describe("settings", () => {
	it("defaults to high thinking, aids off, voice off, brief system prompt", () => {
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
		expect(effectiveSystemPrompt(s)).toBe(
			`${DEFAULT_SYSTEM_PROMPT} Think carefully before answering.`
		);
		s.thinkingLevel = "medium";
		expect(effectiveSystemPrompt(s)).toBe(DEFAULT_SYSTEM_PROMPT);
		s.thinkingLevel = "low";
		s.replyLang = "fr";
		expect(effectiveSystemPrompt(s)).toBe(
			`${DEFAULT_SYSTEM_PROMPT} Answer directly with minimal deliberation. Reply in French.`
		);
		s.replyLang = "nope";
		expect(effectiveSystemPrompt(s)).toBe(
			`${DEFAULT_SYSTEM_PROMPT} Answer directly with minimal deliberation.`
		);
	});

	it("round-trips through a store and survives corrupt JSON", () => {
		const s = defaultSettings();
		s.providers["muse"].apiKey = "secret";
		saveSettings(s, memoryStore);
		const loaded = loadSettings(memoryStore);
		expect(loaded.providers["muse"].apiKey).toBe("secret");

		memoryStore.setItem("ccez-studio-settings-v1", "{not json");
		expect(loadSettings(memoryStore).providers["muse"].apiKey).toBe("");
	});
});
