/**
 * Chrome built-in AI (Translator / LanguageDetector / Summarizer) for
 * free on-device hover-translate, feeding translate.ts.
 *
 * These APIs are origin-trial/experimental and absent outside Chromium —
 * every entry point here probes before use and falls back to the current
 * provider-keyed helper (translateSelection in translate.ts) where
 * unavailable. No paid key is spent when the on-device path serves.
 */

import { translateSelection, type BuiltinFallback } from "./translate";

export type BuiltinAiKind = "translator" | "detector" | "summarizer";

/** Loose shapes for the experimental globals (no TS lib types yet). */
interface TranslatorCandidate {
	availability?(opts: Record<string, string>): Promise<string>;
	create?(opts: Record<string, string>): Promise<{ translate(text: string): Promise<string> }>;
}
interface DetectorCandidate {
	availability?(): Promise<string>;
	create?(): Promise<{ detect(text: string): Promise<Array<{ detectedLanguage: string }>> }>;
}
interface SummarizerCandidate {
	availability?(): Promise<string>;
	create?(): Promise<{ summarize(text: string): Promise<string> }>;
}

function globalOf(name: string): unknown {
	try {
		return (globalThis as Record<string, unknown>)[name];
	} catch {
		return undefined;
	}
}

/**
 * Which built-in AI kinds are callable in this runtime. Pure probe —
 * safe to call anywhere; empty means "use the provider fallback".
 */
export function builtinAiAvailable(): BuiltinAiKind[] {
	const out: BuiltinAiKind[] = [];
	const translator = globalOf("Translator") as TranslatorCandidate | undefined;
	if (translator && typeof translator.create === "function") out.push("translator");
	const detector = globalOf("LanguageDetector") as DetectorCandidate | undefined;
	if (detector && typeof detector.create === "function") out.push("detector");
	const summarizer = globalOf("Summarizer") as SummarizerCandidate | undefined;
	if (summarizer && typeof summarizer.create === "function") out.push("summarizer");
	return out;
}

/** True when the on-device Translator can serve this pair. Never throws. */
export async function builtinTranslatorReady(source: string, target: string): Promise<boolean> {
	try {
		const translator = globalOf("Translator") as TranslatorCandidate | undefined;
		if (!translator) return false;
		if (typeof translator.availability === "function") {
			const level = await translator.availability({ sourceLanguage: source, targetLanguage: target });
			return level === "available" || level === "downloadable" || level === "downloading";
		}
		return typeof translator.create === "function";
	} catch {
		return false;
	}
}

/** On-device translation via window.Translator. Null on any failure. */
export async function builtinTranslate(
	text: string,
	source: string,
	target: string
): Promise<string | null> {
	try {
		const trimmed = text.trim();
		if (!trimmed) return null;
		const translator = globalOf("Translator") as TranslatorCandidate | undefined;
		if (!translator || typeof translator.create !== "function") return null;
		const session = await translator.create({ sourceLanguage: source, targetLanguage: target });
		const out = (await session.translate(trimmed)).trim();
		return out || null;
	} catch {
		return null;
	}
}

/** On-device language detection via window.LanguageDetector. Null on any failure. */
export async function builtinDetectLanguage(text: string): Promise<string | null> {
	try {
		const trimmed = text.trim();
		if (!trimmed) return null;
		const detector = globalOf("LanguageDetector") as DetectorCandidate | undefined;
		if (!detector || typeof detector.create !== "function") return null;
		const session = await detector.create();
		const [top] = await session.detect(trimmed);
		return top?.detectedLanguage ?? null;
	} catch {
		return null;
	}
}

/**
 * Hover-translate entry: try the free on-device Translator first (with
 * auto-detected source where the Detector exists), else run the provided
 * fallback — normally the provider-keyed translateSelection from
 * translate.ts. Returns the source used ("builtin" vs "fallback") so the
 * UI can badge free translations.
 */
export async function hoverTranslate(
	text: string,
	target: string,
	fallback: BuiltinFallback
): Promise<{ text: string; via: "builtin" | "fallback" }> {
	const trimmed = text.trim();
	if (!trimmed) throw new Error("Nothing selected to translate.");
	const detected = await builtinDetectLanguage(trimmed);
	const source = detected ?? "auto";
	const builtin = await builtinTranslate(trimmed, source, target);
	if (builtin) return { text: builtin, via: "builtin" };
	// Auto can be rejected by strict pairs; retry without a source hint
	// is the Translator's job — fall back to the keyed helper instead.
	return { text: await fallback(trimmed, target), via: "fallback" };
}

/** Convenience wiring: hoverTranslate backed by the current provider helper. */
export async function hoverTranslateWithProvider(
	provider: Parameters<typeof translateSelection>[0],
	text: string,
	target: string,
	signal?: AbortSignal
): Promise<{ text: string; via: "builtin" | "fallback" }> {
	return hoverTranslate(text, target, (t, tg) => translateSelection(provider, t, tg, signal));
}
