import type { ChatProvider } from "./providers/types";

/**
 * Reading aids + speech, generalized across languages (A6).
 *
 * Two separate concerns live here:
 * - Reading aids: only scripts whose orthography hides readings get a ruby
 *   aid (Chinese pinyin, Japanese furigana). Anything the app cannot compute
 *   locally goes through the generic model-aid path (tashkeel is the first
 *   entry, not a special case).
 * - Speech: every word in any language resolves to a voice locale via
 *   Unicode script. Latin script cannot self-identify (French vs German vs
 *   English look alike), so callers pass the user's learning-language
 *   fallback from settings.
 */

/** Scripts with a dedicated ruby reading aid. */
export type AidScript = "zh" | "ja" | "ar";
/** Kept for existing import sites. */
export type DetectedScript = AidScript;

/** Arabic first (its block is distinct), then kana (Japanese always mixes
 * kana with kanji), then Han (Chinese). */
export function detectScript(text: string): DetectedScript | null {
	if (/[\u0600-\u06FF\u0750-\u077F]/.test(text)) return "ar";
	if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return "ja";
	if (/\p{Script=Han}/u.test(text)) return "zh";
	return null;
}

export const SCRIPT_LABEL: Record<DetectedScript, string> = {
	zh: "中文",
	ja: "日本語",
	ar: "العربية"
};

export const AID_LABEL: Record<DetectedScript, string> = {
	zh: "pinyin",
	ja: "furigana",
	ar: "tashkeel"
};

const WORD_BREAK =
	/[\s，。！？、；：「」『』（）［］【】《》〈〉…—–·,.!?;:"'()[\]{}<>・、。؟؛،«»‹›„“”‘’\n\r\t]/;

export function isWordChar(char: string): boolean {
	return char !== "" && !WORD_BREAK.test(char);
}

/** Expand `offset` to the full word (maximal run of word chars). */
export function extractWordAt(text: string, offset: number): string {
	if (offset < 0 || offset >= text.length || !isWordChar(text[offset])) return "";
	let start = offset;
	while (start > 0 && isWordChar(text[start - 1])) start--;
	let end = offset;
	while (end < text.length && isWordChar(text[end])) end++;
	return text.slice(start, end);
}

// --- Speech locale: Unicode script → BCP-47, Latin falls back ---

/** Non-Latin scripts map to a voice locale; order matters (check callers). */
const SCRIPT_LOCALE: Array<{ test: (word: string) => boolean; lang: string }> = [
	{ test: (w) => /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(w), lang: "ar-SA" },
	{ test: (w) => /[\u3040-\u309F\u30A0-\u30FF]/.test(w), lang: "ja-JP" },
	{ test: (w) => /\p{Script=Hangul}/u.test(w), lang: "ko-KR" },
	{ test: (w) => /\p{Script=Han}/u.test(w), lang: "zh-CN" },
	{ test: (w) => /\p{Script=Cyrillic}/u.test(w), lang: "ru-RU" },
	{ test: (w) => /\p{Script=Greek}/u.test(w), lang: "el-GR" },
	{ test: (w) => /\p{Script=Hebrew}/u.test(w), lang: "he-IL" },
	{ test: (w) => /\p{Script=Thai}/u.test(w), lang: "th-TH" },
	{ test: (w) => /\p{Script=Devanagari}/u.test(w), lang: "hi-IN" },
	{ test: (w) => /\p{Script=Armenian}/u.test(w), lang: "hy-AM" },
	{ test: (w) => /\p{Script=Georgian}/u.test(w), lang: "ka-GE" }
];

/**
 * BCP-47 voice locale for a word. Non-Latin scripts resolve by Unicode
 * script; Latin-script words (French, German, English, …) use `fallback`,
 * which callers take from the user's voice-language setting.
 */
export function ttsLangFor(word: string, fallback = "en-US"): string {
	for (const { test, lang } of SCRIPT_LOCALE) {
		if (test(word)) return lang;
	}
	return fallback;
}

export interface SpeakResult {
	spoken: boolean;
	lang: string;
}

/** Read one word aloud. False when speech synthesis is unavailable. */
export function speakWord(word: string, fallback = "en-US"): SpeakResult {
	const lang = ttsLangFor(word, fallback);
	if (typeof speechSynthesis === "undefined") return { spoken: false, lang };
	try {
		speechSynthesis.cancel();
		const utterance = new SpeechSynthesisUtterance(word);
		utterance.lang = lang;
		const voice = speechSynthesis
			.getVoices()
			.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
		if (voice) utterance.voice = voice;
		speechSynthesis.speak(utterance);
		return { spoken: true, lang };
	} catch {
		return { spoken: false, lang };
	}
}

// --- Model-assisted reading aids (tashkeel first, not special) ---

export interface ModelAid {
	id: string;
	label: string;
	button: string;
	title: string;
	instruction: string;
}

export const MODEL_AIDS: Record<string, ModelAid> = {
	tashkeel: {
		id: "tashkeel",
		label: "tashkeel",
		button: "تشكيل",
		title: "Add tashkeel (uses the active model)",
		instruction:
			"Add full Arabic diacritics (tashkeel) to the following text. " +
			"Reply with the vocalized text only, no explanations."
	}
};

/** Aid-script → model-aid id. Local-compute aids (pinyin, furigana) map to null. */
export const MODEL_AID_FOR_SCRIPT: Record<AidScript, string | null> = {
	zh: null,
	ja: null,
	ar: "tashkeel"
};

const aidCache = new Map<string, string>();

export function buildAidMessages(
	aidId: string,
	text: string
): Array<{ role: string; content: string }> {
	const aid = MODEL_AIDS[aidId];
	if (!aid) throw new Error(`Unknown reading aid: ${aidId}.`);
	return [
		{ role: "system", content: aid.instruction },
		{ role: "user", content: text }
	];
}

/** Run a model-assisted reading aid, cached by aid + exact input. */
export async function runModelAid(
	provider: ChatProvider,
	aidId: string,
	text: string,
	signal?: AbortSignal
): Promise<string> {
	const trimmed = text.trim();
	if (!trimmed) throw new Error("Nothing to vocalize.");
	const key = `${aidId}:${trimmed}`;
	const cached = aidCache.get(key);
	if (cached !== undefined) return cached;
	const result = await provider.chat(
		buildAidMessages(aidId, trimmed) as Array<{
			role: "system" | "user" | "assistant";
			content: string;
		}>,
		{ signal }
	);
	const aided = result.content.trim();
	if (!aided) throw new Error("Empty aid result.");
	aidCache.set(key, aided);
	return aided;
}

/** Back-compat wrapper: tashkeel is `MODEL_AIDS.tashkeel`. */
export function buildVocalizeMessages(text: string): Array<{ role: string; content: string }> {
	return buildAidMessages("tashkeel", text);
}

/** Back-compat wrapper: tashkeel is `MODEL_AIDS.tashkeel`. */
export function vocalizeArabic(
	provider: ChatProvider,
	text: string,
	signal?: AbortSignal
): Promise<string> {
	return runModelAid(provider, "tashkeel", text, signal);
}
