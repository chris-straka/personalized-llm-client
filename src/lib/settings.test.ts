import { describe, it, expect } from "vitest";
import {
	defaultSettings,
	envProviderDefaults,
	loadSettings,
	saveSettings,
	memoryStore,
	DEFAULT_SYSTEM_PROMPT,
	activeThinkingId,
	effectiveSystemPrompt,
	systemLocale,
	resolveTheme,
	type AppSettings
} from "./settings";

/** Blank slate: tests must never see the developer's real `.env`. */
function blankSettings() {
	const s = defaultSettings();
	s.providers["deepseek"]!.apiKey = "";
	s.providers["muse"]!.apiKey = "";
	return s;
}

describe("settings", () => {
	it("defaults to per-model thinking, voice off, empty system prompt", () => {
		const s = defaultSettings();
		expect(s.thinking).toEqual({});
		// Unset resolves to each model's default (muse → medium).
		expect(activeThinkingId(s)).toBe("medium");
		expect("readingAids" in s).toBe(false);
		expect(s.vim).toBe(true);
		expect(s.voice).toBe(false);
		expect(s.ownBubble).toBe(true);
		expect(s.hoverUserActions).toBe(false);
		expect(s.hoverAssistantActions).toBe(false);
		expect(s.voiceEngine).toBe("native");
		expect(s.voiceLang).toBe("en-US");
		expect(s.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
		expect(s.providers["deepseek"]!.model).toBe("deepseek-flash");
		expect(s.providers["muse"]!.model).toBe("muse-spark-1.3-contributor");
		expect(s.providers["muse"]!.models).toEqual([]);
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

	it("migrates the shared thinking dial to per-provider native ids", () => {
		const raw = blankSettings();
		(raw as unknown as Record<string, unknown>)["thinkingLevel"] = "high";
		delete (raw as unknown as Record<string, unknown>)["thinking"];
		saveSettings(raw, memoryStore);
		const loaded = loadSettings(memoryStore);
		expect(loaded.thinking).toEqual({ muse: "high", deepseek: "max" });
		expect("thinkingLevel" in loaded).toBe(false);
		const low = blankSettings();
		(low as unknown as Record<string, unknown>)["thinkingLevel"] = "low";
		delete (low as unknown as Record<string, unknown>)["thinking"];
		saveSettings(low, memoryStore);
		expect(loadSettings(memoryStore).thinking).toEqual({ muse: "low", deepseek: "high" });
	});

	it("composes thinking hint and reply language into the prompt", () => {
		const s = defaultSettings();
		s.systemPrompt = "Be brief.";
		// Muse sends thinking natively: no prompt hint.
		expect(effectiveSystemPrompt(s)).toBe("Be brief.");
		// Generic providers fall back to prompt hints.
		s.customProviders = [
			{
				id: "x",
				label: "X",
				defaultBaseUrl: "https://x.test",
				defaultModel: "xm",
				keyHint: ""
			}
		];
		s.providers["x"] = { baseUrl: "https://x.test", apiKey: "", model: "xm", models: [] };
		s.activeProviderId = "x";
		s.thinking = { x: "high" };
		expect(effectiveSystemPrompt(s)).toBe("Be brief. Think carefully before answering.");
		s.thinking = { x: "medium" };
		expect(effectiveSystemPrompt(s)).toBe("Be brief.");
		s.thinking = { x: "low" };
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

	it("drops the retired global reading-aids key", () => {
		const s = blankSettings();
		(s as unknown as Record<string, unknown>)["readingAids"] = true;
		saveSettings(s, memoryStore);
		expect("readingAids" in loadSettings(memoryStore)).toBe(false);
	});

	it("splits the legacy hover-actions toggle across both sides", () => {
		const s = blankSettings();
		(s as unknown as Record<string, unknown>).hoverActions = true;
		delete (s as unknown as Record<string, unknown>).hoverUserActions;
		delete (s as unknown as Record<string, unknown>).hoverAssistantActions;
		saveSettings(s, memoryStore);
		const loaded = loadSettings(memoryStore);
		expect(loaded.hoverUserActions).toBe(true);
		expect(loaded.hoverAssistantActions).toBe(true);
		expect("hoverActions" in loaded).toBe(false);
		const kept = blankSettings();
		kept.hoverUserActions = true;
		kept.hoverAssistantActions = false;
		saveSettings(kept, memoryStore);
		const reloaded = loadSettings(memoryStore);
		expect(reloaded.hoverUserActions).toBe(true);
		expect(reloaded.hoverAssistantActions).toBe(false);
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

	it("drops a persisted reply language and its voice override on load", () => {
		const s = blankSettings();
		s.replyLang = "ar";
		s.voiceLang = "ar-SA";
		saveSettings(s, memoryStore);
		const loaded = loadSettings(memoryStore);
		expect(loaded.replyLang).toBeNull();
		expect(loaded.voiceLang).toBe(systemLocale());
	});

	it("keeps a pinned voice across restarts", () => {
		const s = blankSettings();
		s.replyLang = null;
		s.voiceLang = "fr-FR";
		s.voiceLangPinned = true;
		saveSettings(s, memoryStore);
		const loaded = loadSettings(memoryStore);
		expect(loaded.replyLang).toBeNull();
		expect(loaded.voiceLang).toBe("fr-FR");
	});

	it("returns an unpinned voice to the default on load", () => {
		const s = blankSettings();
		s.replyLang = null;
		s.voiceLang = "fr-FR";
		s.voiceLangPinned = false;
		saveSettings(s, memoryStore);
		const loaded = loadSettings(memoryStore);
		expect(loaded.voiceLang).toBe(systemLocale());
	});

	it("never clobbers a saved key when loading", () => {
		const s = blankSettings();
		s.providers["muse"]!.apiKey = "typed";
		saveSettings(s, memoryStore);
		expect(loadSettings(memoryStore).providers["muse"]!.apiKey).toBe("typed");
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
			}).muse!.apiKey
		).toBe("sk-vite");
		expect(envProviderDefaults({}).muse!.apiKey).toBe("");
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
		s.providers["muse"]!.apiKey = "secret";
		saveSettings(s, memoryStore);
		const loaded = loadSettings(memoryStore);
		expect(loaded.providers["muse"]!.apiKey).toBe("secret");

		memoryStore.setItem("ccez-studio-settings-v1", "{not json");
		expect(loadSettings(memoryStore)).toEqual(defaultSettings());
	});
});

describe("theme", () => {
	it("defaults to system and resolves pins over the OS", () => {
		expect(blankSettings().theme).toBe("system");
		expect(resolveTheme("system", true)).toBe("dark");
		expect(resolveTheme("system", false)).toBe("light");
		expect(resolveTheme("dark", false)).toBe("dark");
		expect(resolveTheme("light", true)).toBe("light");
	});
	it("heals unknown saved values back to system", () => {
		const store = memoryStore;
		const s = blankSettings();
		saveSettings({ ...s, theme: "midnight" as never }, store);
		expect(loadSettings(store).theme).toBe("system");
	});
});

describe("touch toggles", () => {
	it("default to shown messages, hidden buttons, speaking selections", () => {
		const s = blankSettings();
		expect(s.hideMessages).toBe(false);
		expect(s.hideButtons).toBe(true);
		expect(s.autoSpeakSelection).toBe(true);
	});
	it("defaults the overlay pill on", () => {
		expect(blankSettings().overlayActions).toBe(true);
	});
	it("drops the retired iOS bubble toggle from older saves", () => {
		const store = memoryStore;
		const s = blankSettings();
		const stale = {
			...s,
			hideMessages: "yes",
			hideButtons: 0,
			autoSpeakSelection: 0,
			overlayActions: 0
		} as unknown as Record<string, unknown>;
		stale.iosNativeCallout = true;
		saveSettings(stale as unknown as AppSettings, store);
		const healed = loadSettings(store);
		expect(healed.hideMessages).toBe(false);
		expect(healed.hideButtons).toBe(true);
		expect(healed.autoSpeakSelection).toBe(true);
		expect(healed.overlayActions).toBe(true);
		expect("iosNativeCallout" in healed).toBe(false);
	});
});
