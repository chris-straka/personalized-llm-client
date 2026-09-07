import { describe, it, expect } from "vitest";
import {
	defaultSettings,
	envProviderDefaults,
	loadSettings,
	saveSettings,
	memoryStore,
	DEFAULT_SYSTEM_PROMPT,
	cycleThinkingLevel,
	effectiveSystemPrompt,
	systemLocale
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
		expect(s.vim).toBe(true);
		expect(s.voice).toBe(false);
		expect(s.voiceEngine).toBe("native");
		expect(s.voiceLang).toBe("en-US");
		expect(s.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
		expect(s.providers["deepseek"].model).toBe("deepseek-v4-pro");
		expect(s.providers["muse"].model).toBe("muse-spark-1.3-contributor");
		expect(s.providers["muse"].models).toEqual([]);
	});

	it("defaults text size to 1 and backfills/clamps old saves", () => {
		expect(defaultSettings().fontScale).toBe(1);
		const s = blankSettings();
		delete (s as unknown as Record<string, unknown>).fontScale;
		saveSettings(s, memoryStore);
		expect(loadSettings(memoryStore).fontScale).toBe(1);
		const bad = blankSettings();
		(bad as unknown as Record<string, unknown>).fontScale = "huge";
		saveSettings(bad, memoryStore);
		expect(loadSettings(memoryStore).fontScale).toBe(1);
		const kept = blankSettings();
		kept.fontScale = 1.2;
		saveSettings(kept, memoryStore);
		expect(loadSettings(memoryStore).fontScale).toBe(1.2);
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

	it("migrates the retired default prompt but keeps custom ones", () => {
		const s = blankSettings();
		s.systemPrompt = "Be brief, no summaries.";
		saveSettings(s, memoryStore);
		expect(loadSettings(memoryStore).systemPrompt).toBe("");
		s.systemPrompt = "Talk like a pirate.";
		saveSettings(s, memoryStore);
		expect(loadSettings(memoryStore).systemPrompt).toBe("Talk like a pirate.");
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
			model: "muse-spark-1.3-contributor",
			models: []
		});
		expect(
			envProviderDefaults({
				META_OPENAI_API_KEY_MUSE_SPARK_ONE_POINT_THREE: "sk-legacy",
				VITE_MUSE_API_KEY: "sk-vite"
			}).muse.apiKey
		).toBe("sk-vite");
		expect(envProviderDefaults({}).muse.apiKey).toBe("");
	});

	it("starts with no custom providers and resets unknown active ids", () => {
		expect(defaultSettings().customProviders).toEqual([]);
		const s = blankSettings();
		s.activeProviderId = "custom-gone";
		saveSettings(s, memoryStore);
		expect(loadSettings(memoryStore).activeProviderId).toBe("muse");
	});

	it("backfills customProviders on older saves", () => {
		const s = blankSettings();
		delete (s as unknown as Record<string, unknown>).customProviders;
		saveSettings(s, memoryStore);
		expect(loadSettings(memoryStore).customProviders).toEqual([]);
	});

	it("backfills a null voice pick on older saves", () => {
		const s = blankSettings();
		delete (s as unknown as Record<string, unknown>).nativeVoiceId;
		saveSettings(s, memoryStore);
		expect(loadSettings(memoryStore).nativeVoiceId).toBeNull();
	});

	it("defaults voice locale from the system locale", () => {
		// Node 21+ ships a getter-only global navigator: swap it by descriptor.
		const desc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
		const setNavigator = (language: string) =>
			Object.defineProperty(globalThis, "navigator", {
				value: { language },
				configurable: true
			});
		const restore = () => {
			if (desc) Object.defineProperty(globalThis, "navigator", desc);
		};
		setNavigator("fr-FR");
		try {
			expect(systemLocale()).toBe("fr-FR");
			expect(defaultSettings().voiceLang).toBe("fr-FR");
		} finally {
			restore();
		}
		setNavigator("not a tag!!!");
		try {
			expect(systemLocale()).toBe("en-US");
		} finally {
			restore();
		}
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
