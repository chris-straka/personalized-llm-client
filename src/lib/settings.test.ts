import { describe, it, expect } from "vitest";
import {
	defaultSettings,
	loadSettings,
	saveSettings,
	memoryStore,
	DEFAULT_SYSTEM_PROMPT
} from "./settings";

describe("settings", () => {
	it("defaults to high thinking, aids off, voice off, brief system prompt", () => {
		const s = defaultSettings();
		expect(s.thinkingLevel).toBe("high");
		expect(s.readingAids).toBe(false);
		expect(s.voice).toBe(false);
		expect(s.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
		expect(s.providers["deepseek"].model).toBe("deepseek-v4-pro");
		expect(s.providers["muse"].model).toBe("muse-spark-1.3-contributor");
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
