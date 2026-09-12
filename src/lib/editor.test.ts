import { describe, it, expect } from "vitest";
import { trimPasteTail, sendPasteFolds, pasteToggleAction } from "./editor";
import { stripImageMarkers, IMAGE_MARKER } from "./attachments";

describe("trimPasteTail", () => {
	it("strips trailing newlines but keeps content and interior breaks", () => {
		expect(trimPasteTail("hello world\n\n\n")).toBe("hello world");
		expect(trimPasteTail("one\ntwo\n")).toBe("one\ntwo");
		expect(trimPasteTail("one\r\ntwo\r\n\r\n")).toBe("one\r\ntwo");
	});

	it("leaves clean text alone", () => {
		expect(trimPasteTail("hello world")).toBe("hello world");
		expect(trimPasteTail("one\ntwo")).toBe("one\ntwo");
		expect(trimPasteTail("")).toBe("");
	});

	it("collapses newline-only pastes to empty (the caller swallows those)", () => {
		expect(trimPasteTail("\n\n\n")).toBe("");
	});

	it("keeps leading newlines and trailing spaces on the last line", () => {
		expect(trimPasteTail("\nhello")).toBe("\nhello");
		expect(trimPasteTail("hello   \n\n")).toBe("hello   ");
	});
});

describe("sendPasteFolds", () => {
	it("matches composerText output exactly when nothing is pasted", () => {
		const docs = [
			"hello world",
			"  padded  ",
			"\n\nhello\n\n",
			`before\n${IMAGE_MARKER}\nafter`,
			`${IMAGE_MARKER}\nonly text`,
			`text\n${IMAGE_MARKER}\n`,
			""
		];
		for (const doc of docs) {
			const { text, folds } = sendPasteFolds(doc, []);
			expect(text).toBe(stripImageMarkers(doc).trim());
			expect(folds).toEqual([]);
		}
	});

	it("maps a basic span into send coordinates", () => {
		const doc = "hello PASTED world";
		const { text, folds } = sendPasteFolds(doc, [{ from: 6, to: 12, chars: 6 }]);
		expect(text).toBe(doc);
		expect(folds).toEqual([{ start: 6, end: 12, chars: 6 }]);
	});

	it("shifts spans past marker lines and trim", () => {
		const doc = `\n\n${IMAGE_MARKER}\nhello PASTED`;
		const { text, folds } = sendPasteFolds(doc, [{ from: 23, to: 29, chars: 6 }]);
		expect(text).toBe("hello PASTED");
		expect(folds).toEqual([{ start: 6, end: 12, chars: 6 }]);
	});

	it("drops spans touched by stripping instead of misplacing them", () => {
		const doc = `aaa\n${IMAGE_MARKER}\nbbb`;
		expect(sendPasteFolds(doc, [{ from: 2, to: 24, chars: 22 }]).folds).toEqual([]);
	});

	it("drops invalid spans and sorts the rest", () => {
		const doc = "aa bb cc";
		const { folds } = sendPasteFolds(doc, [
			{ from: 6, to: 8, chars: 2 },
			{ from: 0, to: 2, chars: 2 },
			{ from: -1, to: 2, chars: 3 },
			{ from: 5, to: 5, chars: 0 },
			{ from: 0, to: 99, chars: 99 }
		]);
		expect(folds).toEqual([
			{ start: 0, end: 2, chars: 2 },
			{ start: 6, end: 8, chars: 2 }
		]);
	});
});

describe("pasteToggleAction", () => {
	it("expands while any tag is still collapsed", () => {
		expect(pasteToggleAction(2, 1)).toBe("expand");
		expect(pasteToggleAction(1, 0)).toBe("expand");
	});

	it("collapses back once everything is expanded", () => {
		expect(pasteToggleAction(0, 3)).toBe("collapse");
	});

	it("claims nothing with no tags, so Ctrl+O keeps its thoughts toggle", () => {
		expect(pasteToggleAction(0, 0)).toBe("none");
	});
});
