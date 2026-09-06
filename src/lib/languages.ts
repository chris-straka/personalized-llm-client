/**
 * Reply languages (Round 2). Choosing one appends a "Reply in X." suffix to
 * the system prompt and sets the Latin-script voice locale. Groups keep the
 * requested order; national languages render as ISO-code badges, classics
 * as their chosen markers.
 */

export interface ReplyLanguage {
	code: string;
	name: string;
	/** System-prompt suffix. */
	prompt: string;
	/** BCP-47 voice locale. Ancient languages use stated modern approximations. */
	voice: string;
	/** Clean badge content (ISO code or classic marker). */
	badge: string;
}

const LANG = (
	code: string,
	name: string,
	voice: string,
	badge: string,
	prompt?: string
): ReplyLanguage => ({
	code,
	name,
	voice,
	badge,
	prompt: prompt ?? `Reply in ${name}.`
});

export const EUROPEAN_LANGUAGES: ReplyLanguage[] = [
	LANG("fr", "French", "fr-FR", "FR"),
	LANG("de", "German", "de-DE", "DE"),
	LANG("es", "Spanish", "es-ES", "ES"),
	LANG("pt", "Portuguese", "pt-PT", "PT"),
	LANG("ru", "Russian", "ru-RU", "RU"),
	LANG("pl", "Polish", "pl-PL", "PL"),
	LANG("it", "Italian", "it-IT", "IT"),
	LANG("no", "Norwegian", "nb-NO", "NO"),
	LANG("cs", "Czech", "cs-CZ", "CZ"),
	LANG("el", "Greek", "el-GR", "GR"),
	LANG("ro", "Romanian", "ro-RO", "RO"),
	LANG("bg", "Bulgarian", "bg-BG", "BG"),
	LANG("hu", "Hungarian", "hu-HU", "HU")
];

export const ASIAN_LANGUAGES: ReplyLanguage[] = [
	LANG("zh", "Chinese", "zh-CN", "CN"),
	LANG("ja", "Japanese", "ja-JP", "JP"),
	LANG("ko", "Korean", "ko-KR", "KR"),
	LANG("ar", "Modern Standard Arabic", "ar-SA", "SA", "Reply in Modern Standard Arabic."),
	LANG("hi", "Hindi", "hi-IN", "IN"),
	LANG("id", "Indonesian", "id-ID", "ID"),
	LANG("tr", "Turkish", "tr-TR", "TR"),
	LANG("fa", "Persian", "fa-IR", "IR"),
	LANG("th", "Thai", "th-TH", "TH"),
	LANG("vi", "Vietnamese", "vi-VN", "VN"),
	LANG("hy", "Armenian", "hy-AM", "AM")
];

export const CLASSICAL_LANGUAGES: ReplyLanguage[] = [
	LANG("la", "Latin", "it-IT", "🏛", "Reply in Latin."),
	LANG("grc", "Ancient Greek", "el-GR", "🏺", "Reply in Ancient Greek."),
	LANG("sa", "Sanskrit", "hi-IN", "🪷", "Reply in Sanskrit.")
];

export interface LanguageMenu {
	id: "europe" | "asia" | "classics";
	marker: string;
	label: string;
	languages: ReplyLanguage[];
}

export const LANGUAGE_MENUS: LanguageMenu[] = [
	{ id: "europe", marker: "🌍", label: "Europe", languages: EUROPEAN_LANGUAGES },
	{ id: "asia", marker: "🌏", label: "Asia", languages: ASIAN_LANGUAGES },
	{ id: "classics", marker: "🏛", label: "Classics", languages: CLASSICAL_LANGUAGES }
];

const BY_CODE: Record<string, ReplyLanguage> = {};
for (const menu of LANGUAGE_MENUS) {
	for (const lang of menu.languages) BY_CODE[lang.code] = lang;
}

export function replyLanguageFor(code: string | null): ReplyLanguage | null {
	if (!code) return null;
	return BY_CODE[code] ?? null;
}
