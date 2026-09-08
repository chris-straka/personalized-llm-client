// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { quoteFragmentText } from "./annotations";

function fragment(html: string): DocumentFragment {
	const template = document.createElement("template");
	template.innerHTML = html;
	return template.content;
}

describe("quoteFragmentText", () => {
	it("drops ruby readings and keeps the base text", () => {
		const text = quoteFragmentText(
			fragment("<p>今日<ruby>漢<rt>かん</rt></ruby><ruby>字<rt>じ</rt></ruby>を読む</p>")
		);
		expect(text).toBe("今日漢字を読む");
	});

	it("drops annotation badge numbers", () => {
		const text = quoteFragmentText(
			fragment('<p>Kyoto<button data-ann-badge="a1">1</button> in two sentences</p>')
		);
		expect(text).toBe("Kyoto in two sentences");
	});

	it("trims plain selections untouched", () => {
		expect(quoteFragmentText(fragment("<p>  hello world  </p>"))).toBe("hello world");
	});
});
