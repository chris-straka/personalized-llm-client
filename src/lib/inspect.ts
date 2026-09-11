/**
 * Inspect: single-character Han (kanji/hanzi) lookup overlay.
 *
 * Fully offline and size-conscious: a compact hand-curated table
 * (stroke counts + short Unihan-style glosses, ~2KB source) plus the
 * immediate-component splits in radicals.ts. No fetch, no worker,
 * no network at runtime.
 *
 * Follow-up (reported honestly, not shipped): full stroke-ORDER path
 * animation needs per-character vector data (KanjiVG, ~10MB unpacked
 * for full coverage) plus a path player. Until that lands, the overlay
 * shows a schematic stroke-step preview driven by the stroke count —
 * clearly labeled as such — alongside radicals, count, and definition.
 */
import { decomposeChar, isHanChar } from "./radicals";

/** One inspected character: everything the overlay shows. */
export interface InspectData {
	char: string;
	/** Immediate components (empty when the curated table lacks it). */
	components: string[];
	/** Total stroke count, or null when outside the compact table. */
	strokeCount: number | null;
	/** Short Unihan-style gloss, or null when outside the compact table. */
	definition: string | null;
	/**
	 * True when per-stroke vector paths are bundled for this character.
	 * Always false until the KanjiVG follow-up lands; the overlay then
	 * renders the schematic step preview instead of path animation.
	 */
	hasStrokePaths: false;
}

/**
 * Compact offline data: stroke count + short gloss per character.
 * Covers the curated radicals-table subset with well-established
 * (Kangxi/shinjitai) counts; anything else falls back to an honest
 * null so the overlay says so instead of guessing.
 */
const TABLE: Record<string, { s: number; d: string }> = {
	好: { s: 6, d: "good; fond of" },
	明: { s: 8, d: "bright; clear" },
	休: { s: 6, d: "rest" },
	体: { s: 7, d: "body; form" },
	信: { s: 9, d: "trust; believe" },
	語: { s: 14, d: "language; to speak" },
	話: { s: 13, d: "story; to speak" },
	読: { s: 14, d: "to read" },
	認: { s: 14, d: "to recognize" },
	漢: { s: 13, d: "Chinese (Han)" },
	海: { s: 10, d: "sea" },
	酒: { s: 10, d: "sake; alcohol" },
	時: { s: 10, d: "time" },
	駅: { s: 14, d: "station" },
	木: { s: 4, d: "tree; wood" },
	林: { s: 8, d: "forest; grove" },
	森: { s: 12, d: "forest" },
	山: { s: 3, d: "mountain" },
	川: { s: 3, d: "river" },
	田: { s: 5, d: "field" },
	力: { s: 2, d: "strength" },
	心: { s: 4, d: "heart; mind" },
	忍: { s: 7, d: "to endure" },
	愛: { s: 13, d: "love" },
	国: { s: 8, d: "country" },
	車: { s: 7, d: "car; vehicle" },
	電: { s: 13, d: "electricity" },
	気: { s: 6, d: "spirit; air" },
	病: { s: 10, d: "illness" },
	銀: { s: 14, d: "silver; money" },
	鳥: { s: 11, d: "bird" },
	魚: { s: 11, d: "fish" },
	花: { s: 7, d: "flower" },
	雨: { s: 8, d: "rain" },
	雪: { s: 11, d: "snow" },
	門: { s: 8, d: "gate" },
	問: { s: 11, d: "to ask" },
	耳: { s: 6, d: "ear" },
	聞: { s: 14, d: "to hear" },
	足: { s: 7, d: "foot; to be enough" },
	道: { s: 12, d: "road; way" },
	食: { s: 9, d: "food; to eat" },
	馬: { s: 10, d: "horse" },
	言: { s: 7, d: "word; to say" },
	金: { s: 8, d: "gold; money" },
	水: { s: 4, d: "water" },
	火: { s: 4, d: "fire" }
};

/** True when the trimmed text is exactly one Han character. */
export function isSingleHanChar(text: string): boolean {
	const trimmed = text.trim();
	if ([...trimmed].length !== 1) return false;
	return isHanChar(trimmed);
}

/**
 * Whether the Inspect button may appear for a highlight: the feature
 * toggle is on AND the highlight is a single Han character. Multi-char
 * or non-CJK highlights never qualify.
 */
export function shouldShowInspect(quote: string, enabled: boolean): boolean {
	if (!enabled) return false;
	return isSingleHanChar(quote);
}

/** Offline lookup for one character (radicals + count + definition). */
export function getInspectData(char: string): InspectData {
	const trimmed = char.trim();
	const hit = TABLE[trimmed];
	const entry = decomposeChar(trimmed);
	return {
		char: trimmed,
		components: entry?.components ?? [],
		strokeCount: hit?.s ?? null,
		definition: hit?.d ?? null,
		hasStrokePaths: false
	};
}
