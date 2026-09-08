import { describe, expect, it } from "vitest";
import { plainParagraphs } from "./pinyin";

describe("plainParagraphs", () => {
	it("mirrors the markdown renderer (breaks: true)", () => {
		expect(plainParagraphs("漢字")).toBe('<p class="cjk">漢字</p>');
		// Soft break: one paragraph, not two.
		expect(plainParagraphs("a\nb")).toBe("<p>a<br>b</p>");
		// Blank line: two paragraphs.
		expect(plainParagraphs("a\n\nb")).toBe("<p>a</p><p>b</p>");
	});

	it("marks only paragraphs that can carry ruby", () => {
		expect(plainParagraphs("hello\n\n漢字")).toBe('<p>hello</p><p class="cjk">漢字</p>');
		expect(plainParagraphs("hello")).toBe("<p>hello</p>");
	});

	it("ignores leading, trailing, and whitespace-only lines like markdown", () => {
		expect(plainParagraphs("")).toBe("");
		expect(plainParagraphs("a\n\n")).toBe("<p>a</p>");
		expect(plainParagraphs("\na")).toBe("<p>a</p>");
		expect(plainParagraphs("a\n   \nb")).toBe("<p>a</p><p>b</p>");
	});
});
