import { describe, expect, it } from "vitest";
import { joinExternalDraft } from "./externalText";

describe("joinExternalDraft", () => {
	it("fills an empty draft", () => {
		expect(joinExternalDraft("", "hello")).toBe("hello");
		expect(joinExternalDraft("   ", "hello")).toBe("hello");
	});

	it("blank-line separates from existing text", () => {
		expect(joinExternalDraft("question?", "今日は")).toBe("question?\n\n今日は");
	});

	it("trims trailing whitespace before joining", () => {
		expect(joinExternalDraft("question?  \n", "今日は")).toBe("question?\n\n今日は");
	});

	it("appends a multi-line share after an existing draft", () => {
		// ACTION_SEND shape (excerpt + URL) joins the draft the same
		// way a PROCESS_TEXT share does: one blank line, no gluing.
		expect(joinExternalDraft("what is this?", "Look at this\nhttps://example.com/menu")).toBe(
			"what is this?\n\nLook at this\nhttps://example.com/menu"
		);
	});
});
