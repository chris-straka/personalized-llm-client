import { describe, it, expect } from "vitest";
import { trimPasteTail } from "./editor";

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
