/**
 * Offline Han character decomposition (radicals/components overlay).
 *
 * Fully bundled: no fetch, no worker, no network at runtime. The table
 * is a small hand-curated subset (common kanji/hanzi + their immediate
 * components), so it stays far under budget (~6KB source) and carries
 * no third-party license obligations.
 *
 * Data decision (see track report):
 * - kradfile2 (Jim Breen EDICT project, CC-BY-SA 4.0): full coverage
 *   but share-alike licensing + ~200KB+ unpacked — heavier than the
 *   ~300KB budget allows once unpacked alongside lindera, and every
 *   app update would redistribute a CC-BY-SA file.
 * - cjk-decomp (MIT, IDS-based): full coverage and a permissive
 *   license, but the IDS corpus is ~1MB+ and needs an IDS parser to
 *   render components — overkill for a glance overlay.
 * - No npm package in the tree provides decomposition (deps are
 *   wanakana, pinyin-pro, lindera-wasm, shiki, marked, … — verified
 *   by searching package.json/bun.lock for decomp/krad/radical).
 * - Choice: this curated immediate-component table (MIT, this repo).
 *   Unknown Han characters fall back to an honest "unavailable"
 *   entry instead of guessing.
 */

/** One character and its immediate components. */
export interface RadicalEntry {
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
export function decomposeChar(ch: string): RadicalEntry | null {
	const hit = TABLE[ch];
	if (!hit || hit.c.length === 0) return null;
	return { char: ch, components: [...hit.c], ...(hit.n ? { note: hit.n } : {}) };
}

/**
 * Decompose the Han characters in a text selection, in order, deduped.
 * Non-Han characters are skipped. Unknown Han characters are reported
 * with an empty component list so the overlay can say so honestly.
 */
export function decomposeText(text: string): RadicalEntry[] {
	const seen = new Set<string>();
	const out: RadicalEntry[] = [];
	for (const ch of text) {
		if (!isHanChar(ch) || seen.has(ch)) continue;
		seen.add(ch);
		const hit = decomposeChar(ch);
		out.push(hit ?? { char: ch, components: [] });
	}
	return out;
}

// --- Overlay controller (plain DOM, reuses the .ann-pop card style) ---

const OVERLAY_ID = "radicals-overlay";
const STYLE_ID = "radicals-overlay-style";

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
		".ann-pop.radicals-pop { width: 20rem; }",
		".radicals-pop h2 { margin: 0 0 0.5rem; font-size: 1rem; }",
		".radicals-pop ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.45rem; }",
		".radicals-pop li { display: flex; gap: 0.6rem; align-items: baseline; }",
		".radicals-pop .rad-char { font-size: 1.6rem; line-height: 1.2; }",
		".radicals-pop .rad-parts { font-size: 1.05rem; }",
		".radicals-pop .rad-missing { opacity: 0.65; font-size: 0.9rem; }",
		".radicals-pop .ann-pop-row { margin-top: 0.9rem; }",
		"@media (prefers-reduced-motion: reduce) { .ann-pop.radicals-pop { animation: none; } }"
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
 * Open the radicals overlay at an anchor point (e.g. the selection
 * menu position). Reuses the existing .ann-pop card styling — no new
 * visual language. Returns the overlay element. Reopening replaces
 * the previous overlay. Respects prefers-reduced-motion (no
 * fade/slide animation when reduced motion is requested).
 */
export function openRadicalsOverlay(
	anchor: { x: number; y: number },
	text: string
): HTMLElement {
	closeRadicalsOverlay();
	ensureStyle();
	const entries = decomposeText(text);
	const el = document.createElement("div");
	el.id = OVERLAY_ID;
	el.className = "ann-pop radicals-pop";
	el.setAttribute("role", "dialog");
	el.setAttribute("aria-label", "Character radicals");
	const pos = clampPos(anchor.x, anchor.y, 320);
	el.style.left = `${pos.x}px`;
	el.style.top = `${pos.y}px`;
	if (reducedMotion()) el.style.animation = "none";

	const title = document.createElement("h2");
	title.textContent = "Radicals";
	el.appendChild(title);

	const list = document.createElement("ul");
	if (entries.length === 0) {
		const li = document.createElement("li");
		li.className = "rad-missing";
		li.textContent = "No Han characters in the selection.";
		list.appendChild(li);
	}
	for (const entry of entries) {
		const li = document.createElement("li");
		const char = document.createElement("span");
		char.className = "rad-char";
		char.lang = "ja";
		char.textContent = entry.char;
		li.appendChild(char);
		const parts = document.createElement("span");
		if (entry.components.length > 0) {
			parts.className = "rad-parts";
			parts.textContent = entry.components.join(" + ");
		} else {
			parts.className = "rad-missing";
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
	closeBtn.setAttribute("aria-label", "Close radicals overlay");
	closeBtn.addEventListener("click", () => closeRadicalsOverlay());
	row.appendChild(closeBtn);
	el.appendChild(row);

	el.addEventListener("keydown", (event) => {
		if (event.key === "Escape") {
			event.stopPropagation();
			closeRadicalsOverlay();
		}
	});
	document.body.appendChild(el);
	closeBtn.focus({ preventScroll: true });
	return el;
}

/** Close the radicals overlay if one is open. */
export function closeRadicalsOverlay(): void {
	document.getElementById(OVERLAY_ID)?.remove();
}

/** True while the radicals overlay is open. */
export function isRadicalsOverlayOpen(): boolean {
	return document.getElementById(OVERLAY_ID) !== null;
}
