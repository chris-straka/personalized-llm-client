import { describe, it, expect } from "vitest";
import {
	addAnnotation,
	duplicateAnnotationId,
	editAnnotationComment,
	deleteAnnotation,
	clearAnnotations,
	annotationNumber,
	formatAnnotations,
	withAnnotations,
	splitAnnotationBlock,
	locateQuote,
	occurrenceAtPosition
} from "./annotations";
import { buildTranslateMessages, translateSelection } from "./translate";
import type { ChatProvider } from "./providers/types";
import type { ChatMsgId } from "./chat";
import type { AnnotationId } from "./annotations";

describe("annotations", () => {
	it("adds, edits, deletes, and clears", () => {
		let list = addAnnotation([], "m1" as ChatMsgId, "  langue  ", "What does this mean?");
		expect(list).toHaveLength(1);
		expect(list[0]?.quote).toBe("langue");
		expect(list[0]?.messageId).toBe("m1");

		// Blank quotes are ignored.
		list = addAnnotation(list, "m1" as ChatMsgId, "   ");
		expect(list).toHaveLength(1);

		list = editAnnotationComment(list, list[0]!.id, "edited");
		expect(list[0]?.comment).toBe("edited");

		list = deleteAnnotation(list, list[0]!.id);
		expect(list).toEqual([]);

		list = addAnnotation(addAnnotation([], "m1" as ChatMsgId, "a"), "m2" as ChatMsgId, "b");
		expect(clearAnnotations()).toEqual([]);
		expect(annotationNumber(list, list[1]!.id)).toBe(2);
		expect(annotationNumber(list, "missing" as AnnotationId)).toBe(0);
	});

	it("formats numbered quote/comment pairs for the prompt", () => {
		const list = addAnnotation(
			addAnnotation([], "m1" as ChatMsgId, "langue", "What does this mean?"),
			"m1" as ChatMsgId,
			"alphabet"
		);
		expect(formatAnnotations(list)).toBe(
			'1. "langue" — What does this mean?\n2. "alphabet"'
		);
	});

	it("wraps annotations into the outgoing prompt", () => {
		const list = addAnnotation([], "m1" as ChatMsgId, "langue", "meaning?");
		expect(withAnnotations("explain", list)).toBe(
			'explain\n\nAnnotated selections:\n1. "langue" — meaning?'
		);
		expect(withAnnotations("", list)).toBe('Annotated selections:\n1. "langue" — meaning?');
		expect(withAnnotations("explain", [])).toBe("explain");
	});

	it("round-trips baked blocks back into text plus refs", () => {
		const list = addAnnotation([], "m1" as ChatMsgId, "langue", "meaning?");
		const withTwo: typeof list = [
			...list,
			{
				id: "a2" as AnnotationId,
				messageId: "m1" as ChatMsgId,
				quote: "alphabet",
				comment: ""
			}
		];
		const split = splitAnnotationBlock(withAnnotations("explain", withTwo));
		expect(split?.text).toBe("explain");
		expect(split?.refs).toEqual([
			{ n: 1, quote: "langue", comment: "meaning?" },
			{ n: 2, quote: "alphabet", comment: "" }
		]);
	});

	it("leaves normal messages and lookalikes untouched", () => {
		expect(splitAnnotationBlock("just a prompt")).toBeNull();
		expect(splitAnnotationBlock("explain\n\nAnnotated selections:\n")).toBeNull();
		expect(splitAnnotationBlock("I typed\n\nAnnotated selections:\nnot a list")).toBeNull();
	});

	it("parses an annotations-only message to empty text plus refs", () => {
		const list = addAnnotation([], "m1" as ChatMsgId, "風に舞う", "What does this mean?");
		const split = splitAnnotationBlock(withAnnotations("", list));
		expect(split?.text).toBe("");
		expect(split?.refs).toEqual([{ n: 1, quote: "風に舞う", comment: "What does this mean?" }]);
	});
});

describe("duplicateAnnotationId", () => {
	it("finds the same span and ignores neighbors", () => {
		const msg = "m1" as ChatMsgId;
		const list = addAnnotation(addAnnotation([], msg, "Kyoto", "old capital"), msg, "Osaka");
		const kyoto = list[0];
		if (!kyoto) throw new Error("no annotation");
		// Same message, quote, and repeat: a twin.
		expect(duplicateAnnotationId(list, msg, "  Kyoto ", 0)).toBe(kyoto.id);
		// A different repeat of the same text is its own span.
		expect(duplicateAnnotationId(list, msg, "Kyoto", 2)).toBeNull();
		// Same quote in another message is unrelated.
		expect(duplicateAnnotationId(list, "m2" as ChatMsgId, "Kyoto", 0)).toBeNull();
		// Blank quotes never match.
		expect(duplicateAnnotationId(list, msg, "   ", 0)).toBeNull();
	});
});

describe("locateQuote", () => {
	it("finds single-node quotes with offsets", () => {
		expect(locateQuote(["hello world"], "world")).toEqual({
			startNode: 0,
			startOffset: 6,
			endNode: 0,
			endOffset: 11
		});
	});

	it("spans element boundaries (inline markup splits nodes)", () => {
		expect(locateQuote(["hello ", "world"], "hello world")).toEqual({
			startNode: 0,
			startOffset: 0,
			endNode: 1,
			endOffset: 5
		});
	});

	it("ignores whitespace differences (multi-line selections)", () => {
		expect(locateQuote(["first half", "second half"], "first half\n\nsecond half")).toEqual({
			startNode: 0,
			startOffset: 0,
			endNode: 1,
			endOffset: 11
		});
	});

	it("folds typographic punctuation (rendered curly quotes)", () => {
		expect(locateQuote(["say “hi” now"], 'say "hi" now')).toEqual({
			startNode: 0,
			startOffset: 0,
			endNode: 0,
			endOffset: 12
		});
	});

	it("returns null for empty quotes and cross-message text", () => {
		expect(locateQuote(["hello"], "")).toBeNull();
		expect(locateQuote(["hello"], "bye")).toBeNull();
		expect(locateQuote(["first message"], "first message second message")).toBeNull();
	});

	it("picks the requested repeat of a repeated quote", () => {
		expect(locateQuote(["ccc"], "c", 0)).toEqual({
			startNode: 0,
			startOffset: 0,
			endNode: 0,
			endOffset: 1
		});
		expect(locateQuote(["ccc"], "c", 2)).toEqual({
			startNode: 0,
			startOffset: 2,
			endNode: 0,
			endOffset: 3
		});
		// Multi-char repeats across nodes: the second "bc".
		expect(locateQuote(["ab", "cbc"], "bc", 1)).toEqual({
			startNode: 1,
			startOffset: 1,
			endNode: 1,
			endOffset: 3
		});
	});

	it("falls back to the first match past the end", () => {
		expect(locateQuote(["ccc"], "c", 9)).toEqual({
			startNode: 0,
			startOffset: 0,
			endNode: 0,
			endOffset: 1
		});
	});
});

describe("occurrenceAtPosition", () => {
	it("finds the repeat holding a node offset", () => {
		expect(occurrenceAtPosition(["ccc"], "c", 0, 0)).toBe(0);
		expect(occurrenceAtPosition(["ccc"], "c", 0, 1)).toBe(1);
		expect(occurrenceAtPosition(["ccc"], "c", 0, 2)).toBe(2);
		expect(occurrenceAtPosition(["ccc"], "c", 0, 3)).toBe(0);
	});

	it("maps multi-node positions through whitespace", () => {
		// "a b c", selecting "b c" from raw offset 2.
		expect(occurrenceAtPosition(["a b ", "c"], "b c", 0, 2)).toBe(0);
		// Second "bc" in "abcbc", range starting at raw offset 3.
		expect(occurrenceAtPosition(["abcbc"], "bc", 0, 3)).toBe(1);
	});

	it("returns 0 for empty quotes, misses, and unknown nodes", () => {
		expect(occurrenceAtPosition(["abc"], "", 0, 1)).toBe(0);
		expect(occurrenceAtPosition(["abc"], "z", 0, 1)).toBe(0);
		expect(occurrenceAtPosition(["abc"], "b", 4, 0)).toBe(0);
	});
});

describe("translate helper", () => {
	it("builds a translation-only prompt", () => {
		const messages = buildTranslateMessages("bonjour", "English");
		expect(messages[0]?.role).toBe("system");
		expect(messages[0]?.content).toContain("English");
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
