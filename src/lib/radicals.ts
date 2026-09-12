/**
 * Offline Han character decomposition (Inspect's component splits).
 *
 * Fully bundled: no fetch, no worker, no network at runtime. Splits
 * come solely from the generated cjkdecomp-subset module (~72KB, MIT
 * data choice, see its header): ~3000 Joyo + top-Hanzi chars in
 * Mainland-Chinese typeface. Unknown Han characters fall back to an
 * honest "unavailable" entry instead of guessing.
 *
 * The module is deliberately NOT called "radicals": splits are
 * immediate components, not Kangxi radicals (214 of those exist).
 * The selection-menu companion is "Inspect" (single Han chars only).
 *
 * Offline-dictionary decision (measured Sep 2026, see track report):
 * - Unihan.zip (unicode.org, UCD path): 8,518,517 bytes zipped —
 *   full definitions/strokes but ~30x the ~300KB budget.
 * - CC-CEDICT (mdbg.net export zip): 3,974,014 bytes zipped —
 *   Chinese-only glosses, still ~13x over budget unpacked.
 * - KANJIDIC2 (edrdg.org xml.gz): 1,488,576 bytes compressed —
 *   Japanese-only, XML needs a parser, unpacked multi-MB.
 * - cjkvi-ids ids.txt (GitHub, CHISE-derived): 2,161,631 bytes
 *   plain text (~88k entries) — the right shape (component splits)
 *   but GPLv2 copyleft plus an IDS-operator parser (⿰⿱…)
 *   to render — overkill for a glance overlay.
 * - No npm package in the tree provides decomposition (deps are
 *   wanakana, pinyin-pro, lindera-wasm, shiki, marked, … — verified
 *   by searching package.json/bun.lock for decomp/krad/radical).
 * - Choice (revised: the 57 hand entries are deleted): splits come
 *   solely from a vendored resolved-L1 subset of amake/cjk-decomp
 *   (MIT data choice, ~72KB, src/lib/cjkdecomp-subset.generated.ts).
 *   Truly unknown Han characters fall back to an honest "unavailable"
 *   entry instead of guessing.
 */
import { CJKDECOMP_SUBSET } from "./cjkdecomp-subset.generated";

/** One character and its immediate components. */
export interface ComponentEntry {
	char: string;
	components: string[];
	/** Optional note (e.g. traditional variant, reading hint). */
	note?: string;
}

/** True for a Han (CJK unified / extension A) character. */
export function isHanChar(ch: string): boolean {
	return /^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]$/u.test(ch);
}

/**
 * Immediate components for one character, or null when unknown.
 * Splits come solely from the vendored cjk-decomp subset (~3000 Joyo +
 * top-Hanzi chars, Mainland-Chinese typeface); characters outside it
 * return null so the UI says "unavailable" instead of guessing.
 */
export function decomposeChar(ch: string): ComponentEntry | null {
	const data = CJKDECOMP_SUBSET[ch];
	if (data && data.length > 0) return { char: ch, components: [...data] };
	return null;
}

/**
 * Decompose the Han characters in a text selection, in order, deduped.
 * Non-Han characters are skipped. Unknown Han characters are reported
 * with an empty component list so the overlay can say so honestly.
 */
export function decomposeText(text: string): ComponentEntry[] {
	const seen = new Set<string>();
	const out: ComponentEntry[] = [];
	for (const ch of text) {
		if (!isHanChar(ch) || seen.has(ch)) continue;
		seen.add(ch);
		const hit = decomposeChar(ch);
		out.push(hit ?? { char: ch, components: [] });
	}
	return out;
}
