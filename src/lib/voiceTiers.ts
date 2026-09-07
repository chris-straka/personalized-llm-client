import type { NativeVoice } from "./nativeTts";

/**
 * Whether any installed voice is worth picking the System-voices engine
 * for: premium (quality 3) or enhanced (quality 2). Default-tier voices
 * (quality 0/1, including Siri personas) are always reachable through
 * Auto, so they don't count.
 */
export function hasQualityVoices(voices: NativeVoice[]): boolean {
	return voices.some((voice) => voice.quality >= 2);
}

/** Display tier for one installed voice (drives the picker's option labels). */
export function tierLabel(voice: NativeVoice): string {
	if (voice.quality >= 3) return "premium";
	if (voice.quality === 2) return "enhanced";
	if (voice.id.includes(".eloquence.")) return "Siri";
	return "default";
}

export interface VoiceOption {
	id: string;
	name: string;
	lang: string;
	tier: string;
}

function toOption(voice: NativeVoice): VoiceOption {
	return { id: voice.id, name: voice.name, lang: voice.lang, tier: tierLabel(voice) };
}

function byName(a: VoiceOption, b: VoiceOption): number {
	return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/**
 * Installed voices for the settings picker: the current language —
 * exact locale first (en-US), then the same primary language (en-GB's
 * Jamie is an English voice for en-US purposes) — premium and enhanced
 * only, sorted by name within each group. Default-tier voices (compact,
 * novelty, Siri personas) are always reachable through Auto, so listing
 * them only adds noise — and unrelated languages resolve through
 * auto-pick at speak time. Pure and unit-tested.
 */
export function voicesForLang(voices: NativeVoice[], lang: string): VoiceOption[] {
	const exactTag = lang.trim().toLowerCase();
	const primary = exactTag.split(/[-_]/)[0] ?? "";
	const exact: VoiceOption[] = [];
	const related: VoiceOption[] = [];
	for (const voice of voices) {
		if (voice.quality < 2) continue;
		const tag = voice.lang.toLowerCase();
		if (tag === exactTag) exact.push(toOption(voice));
		else if (tag.split(/[-_]/)[0] === primary) related.push(toOption(voice));
	}
	exact.sort(byName);
	related.sort(byName);
	return [...exact, ...related];
}
