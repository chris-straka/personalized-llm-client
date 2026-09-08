import { getProviderDef, listProviders, type ProviderDef } from "./providers/registry";
import { replyLanguageFor } from "./languages";
import {
	thinkingFor,
	resolveThinkingId,
	type ThinkingSupport
} from "./providers/thinking";

export type VoiceEngine = "web" | "native";

/**
 * Active provider entry. loadSettings backfills every listed id and clamps
 * activeProviderId to one of them, so a missing entry means corrupt state —
 * fail loud instead of scattering possibly-undefined through the panel.
 */
export function activeProviderSettings(s: AppSettings): ProviderSettings {
	const found = s.providers[s.activeProviderId];
	if (!found) throw new Error(`unknown provider ${s.activeProviderId}`);
	return found;
}

/**
 * Thinking support for the active provider + model (see
 * providers/thinking.ts): only the levels the model actually offers.
 */
export function activeThinkingSupport(settings: AppSettings): ThinkingSupport {
	const provider = settings.providers[settings.activeProviderId];
	return thinkingFor(settings.activeProviderId, provider?.model ?? "");
}

/** Saved thinking option for the active provider, clamped to its dial. */
export function activeThinkingId(settings: AppSettings): string {
	const support = activeThinkingSupport(settings);
	return resolveThinkingId(support, settings.thinking[settings.activeProviderId]);
}

export interface ProviderSettings {
	baseUrl: string;
	apiKey: string;
	model: string;
	/** Cached `/models` ids behind the Model picker's datalist. */
	models: string[];
}

export interface AppSettings {
	version: 1;
	activeProviderId: string;
	providers: Record<string, ProviderSettings>;
	/** User-added provider defs (Cline-style); settings live in `providers`. */
	customProviders: ProviderDef[];
	systemPrompt: string;
	/** Native thinking option id per provider (see providers/thinking.ts);
	 * missing entries resolve to that model's default. */
	thinking: Record<string, string>;
	/** Voice readback. Off unless toggled. */
	voice: boolean;
	voiceEngine: VoiceEngine;
	/**
	 * Explicit native voice (registry identifier from the voice picker);
	 * null = auto-pick the best installed voice per language.
	 */
	nativeVoiceId: string | null;
	/**
	 * Default voice locale for Latin-script text (French, German, English…),
	 * which cannot self-identify by script. BCP-47, e.g. "fr-FR". Follows
	 * the reply language when one is chosen.
	 */
	voiceLang: string;
	/** Reply-language code from the empty-state menus; null = default. */
	replyLang: string | null;
	/** Vim motions in the prompt box. On unless toggled. */
	vim: boolean;
	/** Left chat-list sidebar collapsed. */
	sidebarCollapsed: boolean;
	/** Text-size multiplier for messages and the prompt (1 = default). */
	fontScale: number;
	/**
	 * The user explicitly picked the voice locale (voice-language field),
	 * so restarts must keep it. Unset when a reply pill overrides the
	 * voice: the next launch returns to the system default instead.
	 */
	voiceLangPinned: boolean;
	/** Shade the user's own messages like a bubble. Off = plain like replies. */
	ownBubble: boolean;
	/** My message action buttons appear only on hover/focus. Off = always shown. */
	hoverUserActions: boolean;
	/** AI message action buttons appear only on hover/focus. Off = always shown. */
	hoverAssistantActions: boolean;
}

const STORAGE_KEY = "ccez-studio-settings-v1";

export const DEFAULT_SYSTEM_PROMPT = "";

/**
 * Dev-time `.env` prefill (Vite bakes these into dev/preview builds only —
 * the installed app cannot read `.env` and uses Settings → Keychain).
 * Recognized names (VITE_ first, then legacy META_ aliases), never commit:
 *   VITE_MUSE_API_KEY / META_OPENAI_API_KEY_MUSE_SPARK_ONE_POINT_THREE
 *   VITE_MUSE_BASE_URL / META_BASE_URL, VITE_DEEPSEEK_API_KEY, ...
 */
function devEnv(): Record<string, string | undefined> {
	const fromProcess = (
		globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
	).process?.env;
	try {
		const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> })
			.env;
		return { ...(fromProcess ?? {}), ...(viteEnv ?? {}) };
	} catch {
		return { ...(fromProcess ?? {}) };
	}
}

const ENV_ALIASES: Record<string, string[]> = {
	deepseek: ["VITE_DEEPSEEK_API_KEY"],
	muse: ["VITE_MUSE_API_KEY", "META_OPENAI_API_KEY_MUSE_SPARK_ONE_POINT_THREE"]
};

const BASE_URL_ALIASES: Record<string, string[]> = {
	deepseek: ["VITE_DEEPSEEK_BASE_URL"],
	muse: ["VITE_MUSE_BASE_URL", "META_BASE_URL"]
};

function firstSet(env: Record<string, string | undefined>, names: string[]): string {
	for (const name of names) {
		if (env[name]) return env[name];
	}
	return "";
}

/** Pure env → provider defaults (tested with literal objects, never real env). */
export function envProviderDefaults(
	env: Record<string, string | undefined>
): Record<string, ProviderSettings> {
	const providers: Record<string, ProviderSettings> = {};
	for (const id of ["deepseek", "muse"]) {
		const def = getProviderDef(id);
		providers[id] = {
			baseUrl: firstSet(env, BASE_URL_ALIASES[id] ?? []) || def.defaultBaseUrl,
			apiKey: firstSet(env, ENV_ALIASES[id] ?? []),
			model: def.defaultModel,
			models: []
		};
	}
	return providers;
}

/**
 * Fresh-install voice locale from the OS locale (navigator.language tracks
 * the system language/keyboard region). Browsers expose no keyboard-layout
 * locale — key labels only — so this is the closest signal. Stored profiles
 * keep their own value; this only shapes first boot.
 */
export function systemLocale(): string {
	try {
		const tag = typeof navigator !== "undefined" ? navigator.language : "";
		if (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(tag.trim())) return tag.trim();
	} catch {
		// No DOM (SSR/tests without jsdom): fall through to en-US.
	}
	return "en-US";
}

export function defaultSettings(): AppSettings {
	const providers = envProviderDefaults(devEnv());
	return {
		version: 1,
		activeProviderId: "muse",
		providers,
		customProviders: [],
		systemPrompt: DEFAULT_SYSTEM_PROMPT,
		thinking: {},
		voice: false,
		// Native first: this is a Mac-first app, and every runtime without
		// system voices corrects itself back to web on the support probe.
		voiceEngine: "native",
		nativeVoiceId: null,
		voiceLang: systemLocale(),
		replyLang: null,
		vim: true,
		sidebarCollapsed: true,
		fontScale: 1,
		ownBubble: true,
		hoverUserActions: false,
		hoverAssistantActions: false,
		voiceLangPinned: false
	};
}

/** Base prompt + thinking hint (generic providers only) + reply-language suffix. */
export function effectiveSystemPrompt(settings: AppSettings, replyCode?: string | null): string {
	const parts = [settings.systemPrompt.trim()];
	const hint = activeThinkingSupport(settings).promptHint(activeThinkingId(settings));
	if (hint) parts.push(hint);
	const lang = replyLanguageFor(replyCode ?? settings.replyLang);
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
		// Backfill user-added providers on older saves.
		if (!Array.isArray(merged.customProviders)) merged.customProviders = [];
		// An active provider that no longer exists (deleted custom) falls
		// back to Muse rather than throwing in getProviderDef.
		if (!listProviders(merged.customProviders).some((p) => p.id === merged.activeProviderId)) {
			merged.activeProviderId = "muse";
		}
		// Backfill the model cache (provider entries from older saves
		// replace the fresh ones wholesale, so the field is missing).
		for (const id of Object.keys(merged.providers)) {
			const entry = merged.providers[id];
			if (!entry) continue;
			if (!Array.isArray(entry.models)) entry.models = [];
		}
		// Clamp the text-size multiplier (range inputs persist strings).
		if (typeof merged.fontScale !== "number" || !(merged.fontScale >= 0.5 && merged.fontScale <= 2)) {
			merged.fontScale = 1;
		}
		// Retire the old "Be brief, no summaries." default: profiles that
		// never customized it inherit the new (empty) default instead.
		if (merged.systemPrompt === "Be brief, no summaries.") {
			merged.systemPrompt = DEFAULT_SYSTEM_PROMPT;
		}
		// Backfill blank keys from dev-time env so existing profiles pick
		// up `.env` keys without clobbering anything already saved.
		const env = devEnv();
		for (const id of Object.keys(merged.providers)) {
			const entry = merged.providers[id];
			if (!entry) continue;
			if (!entry.apiKey) {
				entry.apiKey = firstSet(env, ENV_ALIASES[id] ?? []);
			}
		}
		// Reply languages are per-chat and per-session (loadChats strips
		// them), so a restart opens with no pill anywhere. The voice the
		// pill overrode comes back with it: a persisted voice matching the
		// dropped pill's voice is the override's fingerprint. A deliberate
		// pick (pinned, or a non-default voice no pill explains) survives.
		const dropped = merged.replyLang ? replyLanguageFor(merged.replyLang) : null;
		merged.replyLang = null;
		if (dropped && merged.voiceLang === dropped.voice) {
			merged.voiceLang = fresh.voiceLang;
		}
		if (!merged.voiceLangPinned) merged.voiceLang = fresh.voiceLang;
		// The single hover-actions toggle split in two: saves predating the
		// split carry the old key (fresh defaults already filled both new
		// ones, so read the parsed save, not the merge).
		const legacy = parsed as Partial<AppSettings> & { hoverActions?: unknown };
		if (typeof parsed.hoverUserActions !== "boolean") {
			merged.hoverUserActions = legacy.hoverActions === true;
		}
		if (typeof parsed.hoverAssistantActions !== "boolean") {
			merged.hoverAssistantActions = legacy.hoverActions === true;
		}
		delete (merged as unknown as Record<string, unknown>).hoverActions;
		// The global reading-aids toggle is gone (per-message pins only):
		// drop the retired key from older saves.
		delete (merged as unknown as Record<string, unknown>).readingAids;
		// The shared low/medium/high dial became per-provider native ids:
		// Muse keeps its id, DeepSeek maps onto off/high/max. Saves that
		// already carry the record keep it; anything else resolves to
		// each model's default at read time.
		const savedThinking = (parsed as { thinking?: unknown }).thinking;
		if (
			typeof savedThinking === "object" &&
			savedThinking !== null &&
			Object.values(savedThinking).every((v) => typeof v === "string")
		) {
			merged.thinking = { ...(savedThinking as Record<string, string>) };
		} else {
			const legacyLevel = (parsed as { thinkingLevel?: unknown }).thinkingLevel;
			merged.thinking =
				legacyLevel === "high"
					? { muse: "high", deepseek: "max" }
					: legacyLevel === "medium"
						? { muse: "medium", deepseek: "high" }
						: legacyLevel === "low"
							? { muse: "low", deepseek: "high" }
							: {};
		}
		delete (merged as unknown as Record<string, unknown>).thinkingLevel;
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
