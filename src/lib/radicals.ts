/**
 * Offline Han character decomposition (character components overlay).
 *
 * Fully bundled: no fetch, no worker, no network at runtime. Two layers:
 * a small hand-curated table (57 common kanji/hanzi + immediate
 * components, own copyright) wins on conflict; the generated
 * cjkdecomp-subset module (~72KB, MIT data choice, see its header)
 * covers ~3000 more. Unknown Han characters still fall back to an
 * honest "unavailable" entry instead of guessing.
 *
 * The module is deliberately NOT called "radicals": most splits are
 * immediate components, not Kangxi radicals (214 of those exist; the
 * 57 entries here are common characters, not radicals). The
 * selection-menu companion is "Inspect" (single Han chars only).
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
 * - Choice: keep this curated immediate-component table (own
 *   copyright, this repo) authoritative, plus a vendored resolved-L1
 *   subset of amake/cjk-decomp (MIT data choice, ~72KB,
 *   src/lib/cjkdecomp-subset.generated.ts) as fallback for the other
 *   ~3000 common characters. Truly unknown Han characters still fall
 *   back to an honest "unavailable" entry instead of guessing.
 */
import { CJKDECOMP_SUBSET } from "./cjkdecomp-subset.generated";

/** One character and its immediate components. */
export interface ComponentEntry {
	char: string;
	components: string[];
	/** Optional note (e.g. traditional variant, reading hint). */
	note?: string;
}

/**
 * Curated immediate-component splits (single level), using standard
 * Kangxi-style components (氵 water, 言 speech, 亻 person).
 */
const TABLE: Record<string, { c: string[]; n?: string }> = {
	好: { c: ["女", "子"] },
	明: { c: ["日", "月"] },
	休: { c: ["亻", "木"] },
	体: { c: ["亻", "本"] },
	信: { c: ["亻", "言"] },
	語: { c: ["言", "吾"] },
	話: { c: ["言", "舌"] },
	読: { c: ["言", "売"] },
	認: { c: ["言", "忍"] },
	漢: { c: ["氵", "堇"] },
	海: { c: ["氵", "毎"] },
	酒: { c: ["氵", "酉"] },
	曜: { c: ["日", "翟"] },
	時: { c: ["日", "寺"] },
	駅: { c: ["馬", "尺"] },
	館: { c: ["食", "官"] },
	飲: { c: ["食", "欠"] },
	飯: { c: ["食", "反"] },
	木: { c: ["十", "八"] },
	林: { c: ["木", "木"] },
	森: { c: ["木", "木", "木"] },
	山: { c: ["丨", "凵"] },
	川: { c: ["丿", "丨", "丿"] },
	田: { c: ["口", "十"] },
	力: { c: ["丿", "乙"] },
	心: { c: ["丶", "卧", "丶"] },
	忍: { c: ["刃", "心"] },
	愛: { c: ["爫", "心", "夊"] },
	国: { c: ["囗", "玉"] },
	園: { c: ["囗", "袁"] },
	車: { c: ["十", "日", "十"] },
	電: { c: ["日", "乚", "土"] },
	気: { c: ["气", "メ"] },
	病: { c: ["疒", "丙"] },
	痛: { c: ["疒", "甬"] },
	銀: { c: ["金", "艮"] },
	鉄: { c: ["金", "失"] },
	鳥: { c: ["白", "灬"] },
	魚: { c: ["角", "灬"] },
	花: { c: ["艹", "化"] },
	草: { c: ["艹", "早"] },
	雨: { c: ["一", "冂", "四", "丶"] },
	雪: { c: ["雨", "ヨ"] },
	門: { c: ["丶", "𠁣"] },
	問: { c: ["門", "口"] },
	耳: { c: ["一", "小", "二"] },
	聞: { c: ["門", "耳"] },
	足: { c: ["口", "止", "龰"] },
	道: { c: ["辶", "首"] },
	近: { c: ["辶", "斤"] },
	遠: { c: ["辶", "袁"] },
	食: { c: ["人", "良"] },
	馬: { c: ["一", "灬", "一"] },
	言: { c: ["一", "口", "二", "ハ"] },
	金: { c: ["人", "王", "丷"] },
	水: { c: ["亅", "人", "木"] },
	火: { c: ["人", "丿", "人"] },
};

/** True for a Han (CJK unified / extension A) character. */
export function isHanChar(ch: string): boolean {
	return /^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]$/u.test(ch);
}

/**
 * Immediate components for one character, or null when unknown. The
 * hand TABLE wins on conflict (learner-oriented coarse splits beat the
 * data's finer Mainland-typeface analysis); the vendored cjk-decomp
 * subset covers the other ~3000 common characters.
 */
export function decomposeChar(ch: string): ComponentEntry | null {
	const hit = TABLE[ch];
	if (hit && hit.c.length > 0) {
		return { char: ch, components: [...hit.c], ...(hit.n ? { note: hit.n } : {}) };
	}
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
