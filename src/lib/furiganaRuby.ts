/**
 * Kuroshiro-shaped ruby HTML from analyzed tokens, without kuroshiro.
 *
 * Kuroshiro's furigana mode wraps each kanji run in
 * `<ruby>KANJI<rp>(</rp><rt>reading</rt><rp>)</rp></ruby>` and passes
 * everything else through untouched: okurigana splits off plain on both
 * sides (食(た)べ, お|会(あ)|い), kana/romaji/numbers never take ruby.
 * The output stays raw (unsanitized) exactly like kuroshiro's — the
 * caller sanitizes downstream, unchanged.
 *
 * Pure and unit-tested against kuroshiro's own outputs. The tokenizer
 * behind the tokens (lindera, kuromoji before it) only supplies
 * surface + katakana reading per token.
 */
export interface RubyToken {
	surface: string;
	/** Katakana reading (IPAdic details), or null/"*" when unknown. */
	reading: string | null | undefined;
}

/** CJK unified + extension A + compatibility (kuroshiro's kanji test). */
const KANJI = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
/** Hiragana + katakana (prolonged mark included). */
const KANA = /[\u3040-\u309F\u30A0-\u30FF]/;
/** Kanji iteration mark joins kanji runs (one ruby for 様々). */
const ITERATION_MARK = "\u3005";

function isKanjiChar(ch: string): boolean {
	return KANJI.test(ch) || ch === ITERATION_MARK;
}

function hasKanji(text: string): boolean {
	return [...text].some((ch) => isKanjiChar(ch));
}

/**
 * Ruby HTML for one token stream. `toHiragana` converts the katakana
 * reading (wanakana in production); injected so tests stay dependency-
 * free and the mapping stays visibly somebody else's job.
 */
export function rubyHtmlForTokens(
	tokens: RubyToken[],
	toHiragana: (katakana: string) => string
): string {
	let out = "";
	for (const token of tokens) {
		out += rubyToken(token, toHiragana);
	}
	return out;
}

interface SurfaceRun {
	text: string;
	kanji: boolean;
}

/**
 * One ruby-annotated token. Kana runs anchor the reading: leading and
 * trailing okurigana split off plain (食(た)べ, お|会(あ)|い), and kana
 * *inside* a token pins the split between kanji runs (感(かん)じ取(と) —
 * lindera segments coarser than kuromoji did, so per-token edge
 * stripping alone would ruby the whole 感じ取 as one blur). Each kanji
 * run takes the reading up to the next kana anchor (or the end).
 * Anything the alignment cannot explain passes through untouched — a
 * missing ruby beats a wrong one.
 */
function rubyToken(token: RubyToken, toHiragana: (katakana: string) => string): string {
	const surface = token.surface;
	if (!surface || !hasKanji(surface)) return surface;
	const reading = token.reading;
	if (!reading || reading === "*") return surface;
	const hira = [...toHiragana(reading)];
	// Maximal kanji / non-kanji runs ([感][じ][取][れ]).
	const runs: SurfaceRun[] = [];
	for (const ch of [...surface]) {
		const last = runs[runs.length - 1];
		const kanji = isKanjiChar(ch);
		if (last && last.kanji === kanji) last.text += ch;
		else runs.push({ text: ch, kanji });
	}
	// Only pure-kana runs can anchor: romaji, numbers, and punctuation
	// inside a kanji token have no clean reading alignment.
	if (runs.some((r) => !r.kanji && ![...r.text].every((ch) => KANA.test(ch)))) {
		return surface;
	}
	let pos = 0;
	let out = "";
	for (let i = 0; i < runs.length; i++) {
		const run = runs[i];
		if (!run) return surface;
		if (!run.kanji) {
			const want = [...run.text];
			if (hira.slice(pos, pos + want.length).join("") !== run.text) return surface;
			pos += want.length;
			out += run.text;
			continue;
		}
		const nextKana = runs.slice(i + 1).find((r) => !r.kanji);
		let share: string;
		if (nextKana) {
			// Readings are BMP kana, so the UTF-16 index is a char index.
			const at = hira.slice(pos).join("").indexOf(nextKana.text);
			if (at <= 0) return surface;
			share = hira.slice(pos, pos + at).join("");
			pos += at;
		} else {
			share = hira.slice(pos).join("");
			pos = hira.length;
		}
		if (!share) return surface;
		out += `<ruby>${run.text}<rp>(</rp><rt>${share}</rt><rp>)</rp></ruby>`;
	}
	if (pos !== hira.length) return surface;
	return out;
}
