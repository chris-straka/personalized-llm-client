// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
	extractThoughts,
	stripSourcesIfUnasked,
	sourcesAsked,
	estimateTextTokens,
	renderMarkdown,
	renderMessage,
	applyPasteFolds,
	foldSegments,
	pasteFoldButton,
	htmlToText,
	highlightRendered
} from "./render";

describe("thoughts", () => {
	it("extracts closed think blocks, joining multiples", () => {
		const { thoughts, body } = extractThoughts("<think>hmm</think>Answer<think>more</think>");
		expect(thoughts).toBe("hmm\n\nmore");
		expect(body).toBe("Answer");
	});

	it("treats an unclosed tag as streaming thoughts", () => {
		const { thoughts, body } = extractThoughts("Answer so far<think>still thinking…");
		expect(thoughts).toBe("still thinking…");
		expect(body).toBe("Answer so far");
	});

	it("returns null thoughts for plain text", () => {
		expect(extractThoughts("just text")).toEqual({ thoughts: null, body: "just text" });
	});
});

describe("sources stripping", () => {
	const body = "Here is the answer.\n\n## Sources\n\n- example.com";
	it("drops a trailing Sources section unless asked", () => {
		expect(stripSourcesIfUnasked(body, false)).toBe("Here is the answer.");
		expect(stripSourcesIfUnasked(body, true)).toBe(body);
	});

	it("leaves mid-text mentions alone", () => {
		const text = "My sources are impeccable.\n\n## Next\n\nmore";
		expect(stripSourcesIfUnasked(text, false)).toBe(text);
	});

	it("detects when the user asked for sources", () => {
		expect(sourcesAsked(["tell me about cats"])).toBe(false);
		expect(sourcesAsked(["with sources please"])).toBe(true);
	});
});

describe("markdown rendering", () => {
	it("renders code blocks with language label, fold and copy buttons", () => {
		const { html, codes } = renderMarkdown("```python\nprint(1)\n```");
		expect(codes).toEqual([{ lang: "python", code: "print(1)" }]);
		expect(html).toContain("ccez-code-lang");
		expect(html).toContain("python");
		expect(html).toContain('data-code-action="fold"');
		expect(html).toContain('data-code-action="copy"');
		expect(html).toContain('data-code-index="0"');
	});

	it("strips scripts and dangerous attributes", () => {
		const { html } = renderMarkdown(
			'hello <script>alert(1)</script><img src="x" onerror="alert(2)">'
		);
		expect(html).not.toContain("<script");
		expect(html).not.toContain("onerror");
		expect(html).toContain("hello");
	});

	it("renders thoughts collapsed above the body", () => {
		const { html, codes } = renderMessage("<think>hmm</think>```js\nx()\n```", false);
		expect(html).toContain('class="ccez-thoughts"');
		expect(html).toContain("hmm");
		expect(html.indexOf("ccez-thoughts")).toBeLessThan(html.indexOf("ccez-code"));
		// Shared code index space: no real code in thoughts here, one block total.
		expect(codes).toHaveLength(1);
	});

	it("keeps code indices unique across thoughts and body", () => {
		const { html, codes } = renderMessage(
			"<think>```py\na\n```</think>```js\nb\n```",
			false
		);
		expect(codes.map((c) => c.lang)).toEqual(["py", "js"]);
		expect(html).toContain('data-code-index="0"');
		expect(html).toContain('data-code-index="1"');
	});

	it("marks only ruby-capable paragraphs for aid room", () => {
		const { html } = renderMarkdown("hello\n\n漢字を読む");
		expect(html).toContain('<p dir="auto">hello</p>');
		expect(html).toContain('<p dir="auto" class="cjk">');
	});

	it("directs every text block by its own content", () => {
		const { html } = renderMarkdown("# Title\n\n- item\n\n> quote\n\nplain");
		for (const tag of ["h1", "li", "blockquote", "p"]) {
			expect(html).toContain(`<${tag} dir="auto"`);
		}
		expect(html).not.toContain("<pre dir=");
	});

	it("converts rendered html back to plain text", () => {
		const { html } = renderMarkdown("# Title\n\nsome **bold** text");
		const text = htmlToText(html);
		expect(text).toContain("Title");
		expect(text).toContain("bold");
		expect(text).not.toContain("**");
		expect(text).not.toContain("<h1>");
	});
});

describe("highlighting", () => {
	it("highlights known languages, leaves unknown ones plain", async () => {
		const rendered = renderMarkdown("```js\nconst x = 1;\n```\n\n```zzz\n???\n```");
		const html = await highlightRendered(rendered);
		// Shiki v4 emits light colors inline plus dark-mode CSS variables.
		expect(html).toContain("--shiki-dark");
		// The unknown-language block keeps its escaped plain text.
		expect(html).toContain("???");
	}, 30000);

	it("is a no-op without code blocks", async () => {
		const rendered = renderMarkdown("plain text");
		await expect(highlightRendered(rendered)).resolves.toBe(rendered.html);
	});
});

describe("token estimates", () => {
	it("estimates ~4 chars per token", () => {
		expect(estimateTextTokens("")).toBe(1);
		expect(estimateTextTokens("abcd")).toBe(1);
		expect(estimateTextTokens("abcde")).toBe(2);
	});
});

describe("applyPasteFolds", () => {
	it("passes content through with no folds", () => {
		expect(applyPasteFolds("hello", undefined)).toBe("hello");
		expect(applyPasteFolds("hello", [])).toBe("hello");
	});

	it("splices closed folds into marker buttons, keeps open ones inline", () => {
		const out = applyPasteFolds("aa BBBB cc DDDD ee", [
			{ start: 3, end: 7, chars: 4 },
			{ start: 11, end: 15, chars: 4, open: true }
		]);
		expect(out).toContain('data-paste-fold="0"');
		expect(out).toContain("[paste 4 chars]");
		expect(out).toContain("DDDD");
		expect(out).not.toContain("BBBB");
		expect(out.startsWith("aa ")).toBe(true);
		expect(out.endsWith(" ee")).toBe(true);
	});

	it("ignores invalid and overlapping folds", () => {
		const out = applyPasteFolds("abcdef", [
			{ start: 1, end: 3, chars: 2 },
			{ start: 2, end: 5, chars: 3 },
			{ start: -2, end: 1, chars: 3 },
			{ start: 4, end: 99, chars: 95 }
		]);
		expect(out).toContain('data-paste-fold="0"');
		expect(out.match(/data-paste-fold/g)).toHaveLength(1);
	});
});

describe("foldSegments", () => {
	it("splits visible runs from closed-fold markers, merging open folds", () => {
		expect(foldSegments("hello", undefined)).toEqual([{ kind: "text", text: "hello" }]);
		expect(
			foldSegments("aa BBBB cc DDDD ee", [
				{ start: 3, end: 7, chars: 4 },
				{ start: 11, end: 15, chars: 4, open: true }
			])
		).toEqual([
			{ kind: "text", text: "aa " },
			{ kind: "marker", index: 0, chars: 4 },
			{ kind: "text", text: " cc DDDD ee" }
		]);
	});

	it("emits the same markers applyPasteFolds splices", () => {
		expect(pasteFoldButton(2, 128)).toBe(
			'<button type="button" class="paste-fold" data-paste-fold="2">[paste 128 chars]</button>'
		);
	});
});
