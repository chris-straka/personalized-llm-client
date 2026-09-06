import { pinyin } from "pinyin-pro";
import { escapeHtml } from "./render";

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

/** Plain-text paragraphs (for aids mode, where markdown is set aside). */
export function plainParagraphs(htmlInner: string): string {
	return htmlInner
		.split("\n")
		.map((line) => (line.trim() ? `<p>${line}</p>` : ""))
		.join("");
}
