/**
 * Annotation: a quoted selection from a message plus an optional comment,
 * wrapped into the next query. Composer-scoped (like attachments): sending
 * bakes them into the message text, so they are never persisted separately.
 */

export interface Annotation {
	id: string;
	/** Message the selection came from (drives badge placement). */
	messageId: string;
	quote: string;
	comment: string;
}

export function newAnnotationId(): string {
	return crypto.randomUUID();
}

export function addAnnotation(
	list: Annotation[],
	messageId: string,
	quote: string,
	comment = ""
): Annotation[] {
	const trimmed = quote.trim();
	if (!trimmed) return list;
	return [...list, { id: newAnnotationId(), messageId, quote: trimmed, comment }];
}

export function editAnnotationComment(
	list: Annotation[],
	id: string,
	comment: string
): Annotation[] {
	return list.map((a) => (a.id === id ? { ...a, comment } : a));
}

export function deleteAnnotation(list: Annotation[], id: string): Annotation[] {
	return list.filter((a) => a.id !== id);
}

export function clearAnnotations(): Annotation[] {
	return [];
}

/** 1-based badge number of an annotation within the composer list. */
export function annotationNumber(list: Annotation[], id: string): number {
	return list.findIndex((a) => a.id === id) + 1;
}

/**
 * Single-character typographic folds so quotes match across markdown
 * reshaping (straight quotes typed by the user vs curly quotes rendered).
 * Same-length replacements keep node offsets aligned.
 */
const TYPO_FOLD: Record<string, string> = {
	"“": '"',
	"”": '"',
	"‘": "'",
	"’": "'",
	"–": "-",
	"—": "-",
	"…": "."
};

function foldChar(ch: string): string {
	return TYPO_FOLD[ch] ?? ch;
}

/** Strip ALL whitespace for matching: selections and DOM text nodes routinely
 * disagree on newlines/indentation (full-paragraph and multi-line quotes). */
function stripForMatch(text: string): { stripped: string; offsets: number[] } {
	let stripped = "";
	const offsets: number[] = [];
	for (let i = 0; i < text.length; i++) {
		const ch = foldChar(text[i]);
		if (/\s/.test(ch)) continue;
		offsets.push(i);
		stripped += ch;
	}
	return { stripped, offsets };
}

export interface QuoteLocation {
	startNode: number;
	startOffset: number;
	endNode: number;
	/** Exclusive end offset within endNode. */
	endOffset: number;
}

/**
 * Locate a quote across rendered text nodes (pure: takes node texts, no DOM).
 * Whitespace-insensitive on both sides, so quotes spanning element
 * boundaries, block breaks, or reshaped punctuation still match. Returns null
 * when the quote isn't contained in these nodes (e.g. cross-message
 * selections stay review-only).
 */
export function locateQuote(nodeTexts: string[], quote: string): QuoteLocation | null {
	const q = stripForMatch(quote);
	if (!q.stripped) return null;
	let hay = "";
	const map: { node: number; offset: number }[] = [];
	nodeTexts.forEach((text, node) => {
		const s = stripForMatch(text);
		for (let i = 0; i < s.stripped.length; i++) {
			map.push({ node, offset: s.offsets[i] });
			hay += s.stripped[i];
		}
	});
	const at = hay.indexOf(q.stripped);
	if (at === -1) return null;
	const first = map[at];
	const last = map[at + q.stripped.length - 1];
	return {
		startNode: first.node,
		startOffset: first.offset,
		endNode: last.node,
		endOffset: last.offset + 1
	};
}

/**
 * Render annotations for the prompt tail, matching the review-panel shape:
 * numbered quote plus comment.
 */
export function formatAnnotations(list: Annotation[]): string {
	return list
		.map((a, i) => {
			const head = `${i + 1}. "${a.quote}"`;
			return a.comment.trim() ? `${head} — ${a.comment.trim()}` : head;
		})
		.join("\n");
}

/** Append the annotation block to outgoing prompt text. */
export function withAnnotations(prompt: string, list: Annotation[]): string {
	if (list.length === 0) return prompt;
	const block = `Annotated selections:\n${formatAnnotations(list)}`;
	return prompt ? `${prompt}\n\n${block}` : block;
}
