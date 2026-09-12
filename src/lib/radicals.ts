/**
 * Offline Han character decomposition (character components overlay).
 *
 * Fully bundled: no fetch, no worker, no network at runtime. The table
 * is a small hand-curated subset (common kanji/hanzi + their immediate
 * components), so it stays far under budget (~6KB source) and carries
 * no third-party license obligations.
 *
 * The overlay is deliberately NOT called "Radicals": most splits are
 * immediate components, not Kangxi radicals. The selection-menu
 * button reads "Parts" — one short English word with no
 * Chinese-or-Japanese reading, neutral across the shared Han block.
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
 *   copyright, this repo). Unknown Han characters fall back to an
 *   honest "unavailable" entry instead of guessing. A build-time
 *   extraction (per-character slices of Unihan kDefinition/kMandarin
 *   or cjkvi-ids for covered characters) stays a follow-up.
 */

import {
	HAN_OVERLAY_LANG_TAG,
	hanOverlayLangFor,
	isHanOverlayLangUncertain,
	type HanOverlayLang
} from "./reading";

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

/** Immediate components for one character, or null when unknown. */
export function decomposeChar(ch: string): ComponentEntry | null {
	const hit = TABLE[ch];
	if (!hit || hit.c.length === 0) return null;
	return { char: ch, components: [...hit.c], ...(hit.n ? { note: hit.n } : {}) };
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

// --- Overlay controller (plain DOM, reuses the .ann-pop card style) ---

const OVERLAY_ID = "han-parts-overlay";
const STYLE_ID = "han-parts-overlay-style";

function reducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

function ensureStyle(): void {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = [
		".ann-pop.han-parts-pop { width: 20rem; }",
		".han-parts-pop h2 { margin: 0 0 0.5rem; font-size: 1rem; }",
		".han-parts-pop ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.45rem; }",
		".han-parts-pop li { display: flex; gap: 0.6rem; align-items: baseline; }",
		".han-parts-pop .hp-char { font-size: 1.6rem; line-height: 1.2; }",
		".han-parts-pop .hp-parts { font-size: 1.05rem; }",
		".han-parts-pop .hp-missing { opacity: 0.65; font-size: 0.9rem; }",
		".han-parts-pop .hp-toggle { display: flex; gap: 0.35rem; margin: 0 0 0.6rem; }",
		".han-parts-pop .hp-toggle button { font-size: 0.8rem; padding: 0.15rem 0.5rem; }",
		".han-parts-pop .hp-toggle button[aria-pressed=\"true\"] { font-weight: 700; }",
		".han-parts-pop .ann-pop-row { margin-top: 0.9rem; }",
		"@media (prefers-reduced-motion: reduce) { .ann-pop.han-parts-pop { animation: none; } }"
	].join("\n");
	document.head.appendChild(style);
}

function clampPos(x: number, y: number, width: number): { x: number; y: number } {
	const vw = window.innerWidth || 800;
	const vh = window.innerHeight || 600;
	return {
		x: Math.min(Math.max(8, x), Math.max(8, vw - width - 8)),
		y: Math.min(Math.max(8, y + 2), Math.max(8, vh - 72))
	};
}

/**
 * Whether the Parts button may appear for a highlight: the feature
 * toggle is on AND the highlight holds more than one character with
 * at least one Han character in it. Single Han characters belong to
 * Inspect; single non-Han characters get no Han UI at all.
 */
export function shouldShowHanParts(quote: string, enabled: boolean): boolean {
	if (!enabled) return false;
	const trimmed = quote.trim();
	if ([...trimmed].length <= 1) return false;
	return decomposeText(trimmed).length > 0;
}

/**
 * Open the character components overlay at an anchor point (e.g. the
 * selection menu position). Reuses the existing .ann-pop card
 * styling — no new visual language. Returns the overlay element.
 * Reopening replaces the previous overlay. Respects
 * prefers-reduced-motion (no fade/slide animation when reduced
 * motion is requested).
 *
 * Language: kana present reads as Japanese, else Chinese (same rule
 * as `ttsLangFor`). Han-only text is genuinely ambiguous, so the
 * overlay offers a small JP/中文 toggle to flip a wrong prediction;
 * the toggle sets the `lang` of every shown character.
 */
export function openHanPartsOverlay(
	anchor: { x: number; y: number },
	text: string
): HTMLElement {
	closeHanPartsOverlay();
	ensureStyle();
	const entries = decomposeText(text);
	let lang: HanOverlayLang = hanOverlayLangFor(text);
	const el = document.createElement("div");
	el.id = OVERLAY_ID;
	el.className = "ann-pop han-parts-pop";
	el.setAttribute("role", "dialog");
	el.setAttribute("aria-label", "Character components");
	const pos = clampPos(anchor.x, anchor.y, 320);
	el.style.left = `${pos.x}px`;
	el.style.top = `${pos.y}px`;
	if (reducedMotion()) el.style.animation = "none";

	const title = document.createElement("h2");
	title.textContent = "Character components";
	el.appendChild(title);

	const applyLang = (): void => {
		for (const node of el.querySelectorAll(".hp-char")) {
			(node as HTMLElement).lang = HAN_OVERLAY_LANG_TAG[lang];
		}
		for (const node of el.querySelectorAll(".hp-toggle button")) {
			const btn = node as HTMLButtonElement;
			btn.setAttribute("aria-pressed", String(btn.dataset.lang === lang));
		}
	};

	if (isHanOverlayLangUncertain(text)) {
		const toggle = document.createElement("div");
		toggle.className = "hp-toggle";
		toggle.setAttribute("role", "group");
		toggle.setAttribute("aria-label", "Reading language");
		for (const choice of [
			{ value: "ja", label: "JP", tip: "Show Japanese reading" },
			{ value: "zh", label: "中文", tip: "Show Chinese reading" }
		] as const) {
			const btn = document.createElement("button");
			btn.type = "button";
			btn.dataset.lang = choice.value;
			btn.textContent = choice.label;
			btn.title = choice.tip;
			btn.setAttribute("aria-label", choice.tip);
			btn.setAttribute("aria-pressed", String(choice.value === lang));
			btn.addEventListener("click", () => {
				lang = choice.value;
				applyLang();
			});
			toggle.appendChild(btn);
		}
		el.appendChild(toggle);
	}

	const list = document.createElement("ul");
	if (entries.length === 0) {
		const li = document.createElement("li");
		li.className = "hp-missing";
		li.textContent = "No Han characters in the selection.";
		list.appendChild(li);
	}
	for (const entry of entries) {
		const li = document.createElement("li");
		const char = document.createElement("span");
		char.className = "hp-char";
		char.lang = HAN_OVERLAY_LANG_TAG[lang];
		char.textContent = entry.char;
		li.appendChild(char);
		const parts = document.createElement("span");
		if (entry.components.length > 0) {
			parts.className = "hp-parts";
			parts.textContent = entry.components.join(" + ");
		} else {
			parts.className = "hp-missing";
			parts.textContent = "components unavailable offline";
		}
		li.appendChild(parts);
		list.appendChild(li);
	}
	el.appendChild(list);

	const row = document.createElement("div");
	row.className = "ann-pop-row";
	const spacer = document.createElement("span");
	spacer.className = "ann-pop-spacer";
	row.appendChild(spacer);
	const closeBtn = document.createElement("button");
	closeBtn.type = "button";
	closeBtn.className = "ann-save";
	closeBtn.textContent = "Close";
	closeBtn.setAttribute("aria-label", "Close character components overlay");
	closeBtn.addEventListener("click", () => closeHanPartsOverlay());
	row.appendChild(closeBtn);
	el.appendChild(row);

	el.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			event.stopPropagation();
			closeHanPartsOverlay();
		}
	});
	document.body.appendChild(el);
	closeBtn.focus({ preventScroll: true });
	return el;
}

/** Close the character components overlay if one is open. */
export function closeHanPartsOverlay(): void {
	document.getElementById(OVERLAY_ID)?.remove();
}

/** True while the character components overlay is open. */
export function isHanPartsOverlayOpen(): boolean {
	return document.getElementById(OVERLAY_ID) !== null;
}
