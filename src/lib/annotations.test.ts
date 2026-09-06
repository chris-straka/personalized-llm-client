import { describe, it, expect } from "vitest";
import {
	addAnnotation,
	editAnnotationComment,
	deleteAnnotation,
	clearAnnotations,
	annotationNumber,
	formatAnnotations,
	withAnnotations
} from "./annotations";
import { buildTranslateMessages, translateSelection } from "./translate";
import type { ChatProvider } from "./providers/types";

describe("annotations", () => {
	it("adds, edits, deletes, and clears", () => {
		let list = addAnnotation([], "m1", "  langue  ", "What does this mean?");
		expect(list).toHaveLength(1);
		expect(list[0].quote).toBe("langue");
		expect(list[0].messageId).toBe("m1");

		// Blank quotes are ignored.
		list = addAnnotation(list, "m1", "   ");
		expect(list).toHaveLength(1);

		list = editAnnotationComment(list, list[0].id, "edited");
		expect(list[0].comment).toBe("edited");

		list = deleteAnnotation(list, list[0].id);
		expect(list).toEqual([]);

		list = addAnnotation(addAnnotation([], "m1", "a"), "m2", "b");
		expect(clearAnnotations()).toEqual([]);
		expect(annotationNumber(list, list[1].id)).toBe(2);
		expect(annotationNumber(list, "missing")).toBe(0);
	});

	it("formats numbered quote/comment pairs for the prompt", () => {
		const list = addAnnotation(addAnnotation([], "m1", "langue", "What does this mean?"), "m1", "alphabet");
		expect(formatAnnotations(list)).toBe(
			'1. "langue" — What does this mean?\n2. "alphabet"'
		);
	});

	it("wraps annotations into the outgoing prompt", () => {
		const list = addAnnotation([], "m1", "langue", "meaning?");
		expect(withAnnotations("explain", list)).toBe(
			'explain\n\nAnnotated selections:\n1. "langue" — meaning?'
		);
		expect(withAnnotations("", list)).toBe('Annotated selections:\n1. "langue" — meaning?');
		expect(withAnnotations("explain", [])).toBe("explain");
	});
});

describe("translate helper", () => {
	it("builds a translation-only prompt", () => {
		const messages = buildTranslateMessages("bonjour", "English");
		expect(messages[0].role).toBe("system");
		expect(messages[0].content).toContain("English");
		expect(messages[1]).toEqual({ role: "user", content: "bonjour" });
	});

	it("returns the trimmed translation, rejects blanks", async () => {
		const provider: ChatProvider = {
			id: "scripted",
			chat: async () => ({ content: "  hello  ", usage: null }),
			stream: async () => ({ content: "", usage: null })
		};
		await expect(translateSelection(provider, "bonjour", "English")).resolves.toBe("hello");
		await expect(translateSelection(provider, "   ", "English")).rejects.toThrow(
			"Nothing selected"
		);
		await expect(
			translateSelection(
				{ ...provider, chat: async () => ({ content: "  ", usage: null }) },
				"bonjour",
				"English"
			)
		).rejects.toThrow("Empty translation");
	});
});
