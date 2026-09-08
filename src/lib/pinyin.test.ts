import { describe, expect, it } from "vitest";
import { plainParagraphs } from "./pinyin";

describe("plainParagraphs", () => {
	it("mirrors the markdown renderer (breaks: true)", () => {
		expect(plainParagraphs("漢字")).toBe("<p>漢字</p>");
		// Soft break: one paragraph, not two.
		expect(plainParagraphs("a\nb")).toBe("<p>a<br>b</p>");
		// Blank line: two paragraphs.
		expect(plainParagraphs("a\n\nb")).toBe("<p>a</p><p>b</p>");
	});

	it("ignores leading, trailing, and whitespace-only lines like markdown", () => {
		expect(plainParagraphs("")).toBe("");
		expect(plainParagraphs("a\n\n")).toBe("<p>a</p>");
		expect(plainParagraphs("\na")).toBe("<p>a</p>");
		expect(plainParagraphs("a\n   \nb")).toBe("<p>a</p><p>b</p>");
	});
});
