import { describe, it, expect } from "vitest";
import {
	addAnnotation,
	editAnnotationComment,
	deleteAnnotation,
	clearAnnotations,
	annotationNumber,
	formatAnnotations,
	withAnnotations,
	splitAnnotationBlock,
	locateQuote
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
