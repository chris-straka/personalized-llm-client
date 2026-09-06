import { getProviderDef } from "./providers/registry";
import { replyLanguageFor } from "./languages";

export type ThinkingLevel = "low" | "medium" | "high";
export type VoiceEngine = "web";

export const THINKING_LEVELS: ThinkingLevel[] = ["low", "medium", "high"];

/** System-prompt deliberation hint per level (medium = the plain default). */
export const THINKING_HINT: Record<ThinkingLevel, string> = {
	low: "Answer directly with minimal deliberation.",
	medium: "",
	high: "Think carefully before answering."
};

export function cycleThinkingLevel(level: ThinkingLevel, direction: 1 | -1): ThinkingLevel {
	const next =
		(THINKING_LEVELS.indexOf(level) + direction + THINKING_LEVELS.length) %
		THINKING_LEVELS.length;
	return THINKING_LEVELS[next];
}

export interface ProviderSettings {
	baseUrl: string;
	apiKey: string;
	model: string;
}

export interface AppSettings {
	version: 1;
	activeProviderId: string;
	providers: Record<string, ProviderSettings>;
	systemPrompt: string;
	thinkingLevel: ThinkingLevel;
	/** Reading aids (pinyin / furigana / tashkeel). Off unless toggled. */
	readingAids: boolean;
	/** Voice readback. Off unless toggled. */
	voice: boolean;
	voiceEngine: VoiceEngine;
	/**
	 * Default voice locale for Latin-script text (French, German, English…),
	 * which cannot self-identify by script. BCP-47, e.g. "fr-FR". Follows
	 * the reply language when one is chosen.
	 */
	voiceLang: string;
	/** Reply-language code from the empty-state menus; null = default. */
	replyLang: string | null;
	/** Left chat-list sidebar collapsed. */
	sidebarCollapsed: boolean;
}

const STORAGE_KEY = "ccez-studio-settings-v1";

export const DEFAULT_SYSTEM_PROMPT = "Be brief, no summaries.";

/**
 * Dev-time `.env` prefill (Vite bakes these into dev/preview builds only —
 * the installed app cannot read `.env` and uses Settings → Keychain).
 * Add to `.env`, never commit it:
 *   VITE_DEEPSEEK_API_KEY=...  VITE_MUSE_API_KEY=...
 *   VITE_DEEPSEEK_BASE_URL=... VITE_MUSE_BASE_URL=...
 */
function devEnv(): Record<string, string | undefined> {
	try {
		return (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
	} catch {
		return {};
	}
}

export function defaultSettings(): AppSettings {
	const env = devEnv();
	const providers: Record<string, ProviderSettings> = {};
	for (const id of ["deepseek", "muse"]) {
		const def = getProviderDef(id);
		const prefix = `VITE_${id.toUpperCase()}`;
		providers[id] = {
			baseUrl: env[`${prefix}_BASE_URL`] || def.defaultBaseUrl,
			apiKey: env[`${prefix}_API_KEY`] || "",
			model: def.defaultModel
		};
	}
	return {
		version: 1,
		activeProviderId: "deepseek",
		providers,
		systemPrompt: DEFAULT_SYSTEM_PROMPT,
		thinkingLevel: "high",
		readingAids: false,
		voice: false,
		voiceEngine: "web",
		voiceLang: "en-US",
		replyLang: null,
		sidebarCollapsed: false
	};
}

/** Base prompt + thinking deliberation hint + reply-language suffix. */
export function effectiveSystemPrompt(settings: AppSettings): string {
	const parts = [settings.systemPrompt.trim()];
	const hint = THINKING_HINT[settings.thinkingLevel] ?? "";
	if (hint) parts.push(hint);
	const lang = replyLanguageFor(settings.replyLang);
	if (lang) parts.push(lang.prompt);
	return parts.filter(Boolean).join(" ");
}

/** Storage behind an interface so Tauri secure storage can replace it later. */
export interface KeyValueStore {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

const memory = new Map<string, string>();
export const memoryStore: KeyValueStore = {
	getItem: (k) => memory.get(k) ?? null,
	setItem: (k, v) => void memory.set(k, v)
};

function browserStore(): KeyValueStore | null {
	try {
		if (typeof localStorage === "undefined") return null;
		return localStorage;
	} catch {
		return null;
	}
}

export function loadSettings(store?: KeyValueStore): AppSettings {
	const backend = store ?? browserStore() ?? memoryStore;
	const raw = backend.getItem(STORAGE_KEY);
	if (!raw) return defaultSettings();
	try {
		const parsed = JSON.parse(raw) as Partial<AppSettings>;
		const fresh = defaultSettings();
		const merged: AppSettings = {
			...fresh,
			...parsed,
			version: 1,
			providers: { ...fresh.providers, ...(parsed.providers ?? {}) }
		};
		// Drop the removed translate-target setting from older saves.
		delete (merged as unknown as Record<string, unknown>).translateTarget;
		return merged;
	} catch {
		return defaultSettings();
	}
}

export function saveSettings(settings: AppSettings, store?: KeyValueStore): void {
	const backend = store ?? browserStore() ?? memoryStore;
	backend.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** Masked display for a stored key: bullets plus the last 4 characters. */
export function maskKey(key: string): string {
	const trimmed = key.trim();
	if (!trimmed) return "";
	return trimmed.length <= 8 ? "••••" : `••••${trimmed.slice(-4)}`;
}
