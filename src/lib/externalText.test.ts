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
});
