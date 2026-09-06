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
