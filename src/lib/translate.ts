import type { ChatProvider } from "./providers/types";

/**
 * Cmd+T translate lookup: a cheap single non-streaming call whose result
 * feeds annotation (quote = selection, comment = translation) — not a
 * mini-browser, just original + translation + an annotate button.
 */

export function buildTranslateMessages(text: string, target: string): Array<{ role: string; content: string }> {
	return [
		{
			role: "system",
			content: `Translate the following text to ${target}. Reply with the translation only, no explanations.`
		},
		{ role: "user", content: text }
	];
}

/** Fallback invoked when on-device translation cannot serve (see builtinAi.hoverTranslate). */
export type BuiltinFallback = (text: string, target: string) => Promise<string>;

export async function translateSelection(
	provider: ChatProvider,
	text: string,
	target: string,
	signal?: AbortSignal
): Promise<string> {
	const trimmed = text.trim();
	if (!trimmed) throw new Error("Nothing selected to translate.");
	const result = await provider.chat(
		buildTranslateMessages(trimmed, target) as Array<{ role: "system" | "user" | "assistant"; content: string }>,
		{ signal }
	);
	const translation = result.content.trim();
	if (!translation) throw new Error("Empty translation result.");
	return translation;
}
