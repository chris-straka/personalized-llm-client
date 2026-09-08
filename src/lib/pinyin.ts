import { pinyin } from "pinyin-pro";
import { escapeHtml } from "./render";
import { RUBY_SCRIPT_RE } from "./reading";

/**
 * Pinyin ruby for Chinese text: per-character readings (pinyin-pro resolves
 * polyphones from surrounding context) wrapped as <ruby> annotations.
 * Han characters keep their tone-marked reading; everything else passes
 * through escaped and unannotated.
 */
export function pinyinRuby(text: string): string {
	const syllables = pinyin(text, { toneType: "symbol", type: "array" });
	const chars = [...text];
	return chars
		.map((char, i) => {
			const reading = syllables[i];
			if (/\p{Script=Han}/u.test(char) && reading && reading !== char) {
				return `<ruby>${escapeHtml(char)}<rt>${escapeHtml(reading)}</rt></ruby>`;
			}
			return escapeHtml(char);
		})
		.join("");
}

/**
 * Plain-text paragraphs (for aids mode, where markdown is set aside).
 * Mirrors the markdown renderer (`breaks: true`): blank lines separate
 * paragraphs, single newlines are soft breaks (`<br>`) inside one
 * paragraph. Per-line `<p>`s would add a paragraph margin per line and
 * grow the message when an aid pins — the exact shift this avoids.
 * Callers pass converter output whose only `\n` are line separators
 * (converter tags never span lines), so splitting here is safe.
 */
export function plainParagraphs(htmlInner: string): string {
	const blocks: string[][] = [];
	let current: string[] = [];
	for (const line of htmlInner.split("\n")) {
		if (!line.trim()) {
			if (current.length) {
				blocks.push(current);
				current = [];
			}
		} else {
			current.push(line);
		}
	}
	if (current.length) blocks.push(current);
	// Same ruby-room mark as the markdown renderer: paragraphs that can
	// carry ruby reserve it, English ones stay tight (see aid-space).
	return blocks
		.map((lines) => {
			const inner = lines.join("<br>");
			const cls = RUBY_SCRIPT_RE.test(inner.replace(/<[^>]*>/g, "")) ? ` class="cjk"` : "";
			return `<p${cls}>${inner}</p>`;
		})
		.join("");
}
