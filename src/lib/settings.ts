import { getProviderDef } from "./providers/registry";

export type ThinkingLevel = "low" | "high";
export type VoiceEngine = "web";

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
}

const STORAGE_KEY = "ccez-studio-settings-v1";

export const DEFAULT_SYSTEM_PROMPT = "Be brief, no summaries.";

export function defaultSettings(): AppSettings {
	const providers: Record<string, ProviderSettings> = {};
	for (const id of ["deepseek", "muse"]) {
		const def = getProviderDef(id);
		providers[id] = { baseUrl: def.defaultBaseUrl, apiKey: "", model: def.defaultModel };
	}
	return {
		version: 1,
		activeProviderId: "deepseek",
		providers,
		systemPrompt: DEFAULT_SYSTEM_PROMPT,
		thinkingLevel: "high",
		readingAids: false,
		voice: false,
		voiceEngine: "web"
	};
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
		return {
			...fresh,
			...parsed,
			version: 1,
			providers: { ...fresh.providers, ...(parsed.providers ?? {}) }
		};
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
