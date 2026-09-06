import type { ChatProvider } from "./providers/types";

/**
 * Reading aids: script detection, single-word speech, and model-assisted
 * Arabic vocalization (tashkeel). Pinyin/furigana live in their own modules
 * so the heavy Japanese dictionary stays lazily loaded.
 */

export type DetectedScript = "zh" | "ja" | "ar";

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
	/[\s，。！？、；：「」『』（）［］【】《》〈〉…—·,.!?;:"'()[\]{}<>・、。؟؛،\n\r\t]/;

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

/** BCP-47 voice locale for a word, falling back to English. */
export function ttsLangFor(word: string): string {
	switch (detectScript(word)) {
		case "zh":
			return "zh-CN";
		case "ja":
			return "ja-JP";
		case "ar":
			return "ar-SA";
		default:
			return "en-US";
	}
}

export interface SpeakResult {
	spoken: boolean;
	lang: string;
}

/** Read one word aloud. False when speech synthesis is unavailable. */
export function speakWord(word: string): SpeakResult {
	const lang = ttsLangFor(word);
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

// --- Arabic vocalization (tashkeel) via the active model ---

const vocalizeCache = new Map<string, string>();

export function buildVocalizeMessages(text: string): Array<{ role: string; content: string }> {
	return [
		{
			role: "system",
			content:
				"Add full Arabic diacritics (tashkeel) to the following text. " +
				"Reply with the vocalized text only, no explanations."
		},
		{ role: "user", content: text }
	];
}

/** Vocalize Arabic text, cached by exact input so toggling is free. */
export async function vocalizeArabic(
	provider: ChatProvider,
	text: string,
	signal?: AbortSignal
): Promise<string> {
	const trimmed = text.trim();
	if (!trimmed) throw new Error("Nothing to vocalize.");
	const cached = vocalizeCache.get(trimmed);
	if (cached !== undefined) return cached;
	const result = await provider.chat(
		buildVocalizeMessages(trimmed) as Array<{
			role: "system" | "user" | "assistant";
			content: string;
		}>,
		{ signal }
	);
	const vocalized = result.content.trim();
	if (!vocalized) throw new Error("Empty vocalization result.");
	vocalizeCache.set(trimmed, vocalized);
	return vocalized;
}
