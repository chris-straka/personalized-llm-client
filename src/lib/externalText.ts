/**
 * Shared-in text (Android OS selection menu) joining the composer
 * draft: blank-line separated, never glued onto a partial line, and
 * trailing whitespace on the old draft never leaves a gap.
 */
export function joinExternalDraft(draft: string, text: string): string {
	const clean = draft.replace(/\s+$/, "");
	if (!clean) return text;
	return `${clean}\n\n${text}`;
}
