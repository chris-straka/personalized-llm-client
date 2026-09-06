/**
 * Pure helpers for the fenced-code input box (```lang + Enter opens an inline
 * code editor with an auto-closed fence). Tested here, used by the editor.
 */

const FENCE_OPEN = /^```(\w[\w+#-]*)\s*$/;

/** True when this line opens a fence that deserves an auto-closed block. */
export function isFenceTrigger(line: string): string | null {
	const match = FENCE_OPEN.exec(line);
	return match ? match[1] : null;
}

export interface FenceBlock {
	/** Offset of the opening ``` line's end (where the body starts). */
	bodyFrom: number;
	/** Offset of the closing ``` line's start. */
	bodyTo: number;
	language: string;
}

/**
 * Find the fence block enclosing `pos`, given document lines and the offset of
 * each line start. Returns null outside a complete ```lang … ``` block.
 */
export function findFenceBlock(
	lines: string[],
	lineStarts: number[],
	pos: number
): FenceBlock | null {
	let openIndex = -1;
	let language = "";
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (openIndex === -1) {
			const lang = isFenceTrigger(line);
			if (lang) {
				openIndex = i;
				language = lang;
			}
		} else if (/^```\s*$/.test(line)) {
			const bodyFrom = lineStarts[openIndex] + lines[openIndex].length + 1;
			const bodyTo = lineStarts[i];
			if (pos >= bodyFrom && pos <= bodyTo + 3) {
				return { bodyFrom, bodyTo, language };
			}
			openIndex = -1;
			language = "";
		}
	}
	return null;
}

/** Split a document into lines plus each line's start offset. */
export function splitLines(doc: string): { lines: string[]; starts: number[] } {
	const lines = doc.split("\n");
	const starts: number[] = [];
	let offset = 0;
	for (const line of lines) {
		starts.push(offset);
		offset += line.length + 1;
	}
	return { lines, starts };
}
