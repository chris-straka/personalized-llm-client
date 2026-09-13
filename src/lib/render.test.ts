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
	highlightRendered,
	extractMath,
	mathHtml,
	mathTexPreview,
	foldedCodeLabel,
	mathCopyText,
	foldPreviewText,
	stripLatexFenceDupes
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
	it("renders headless code blocks: copy icon button plus folded label, no fold bar", () => {
		const { html, codes } = renderMarkdown("```python\nprint(1)\n```");
		expect(codes).toEqual([{ lang: "python", code: "print(1)" }]);
		expect(html).not.toContain("ccez-code-head");
		expect(html).not.toContain("ccez-code-lang");
		expect(html).not.toContain("data-code-action");
		expect(html).not.toContain(">Fold<");
		expect(html).not.toContain(">Copy<");
		expect(html).toContain('data-code-index="0"');
		// Copy icon button: accessible name, per-block index, shared glyph.
		expect(html).toContain('class="ccez-code-copy"');
		expect(html).toContain('data-code-copy="0"');
		expect(html).toContain('aria-label="Copy code block"');
		expect(html).toContain("<svg");
		expect(html).toContain("action-glyph");
		// Folded label ships in the markup (stylesheet reveals it on fold).
		expect(html).toContain("ccez-code-foldedlabel");
		expect(html).toContain("python · 1 LOC");
	});

	it("runs only runnable fences: text and unknown labels get copy alone", () => {
		for (const fence of ["text", "", "haskell"]) {
			const { html } = renderMarkdown("```" + fence + "\nhello\n```");
			expect(html).toContain('class="ccez-code-copy"');
			expect(html).not.toContain("ccez-code-run");
		}
		for (const fence of ["python", "js", "bash"]) {
			const { html } = renderMarkdown("```" + fence + "\nhello\n```");
			expect(html).toContain('class="ccez-code-run"');
		}
	});

	it("labels multi-line blocks with their line count", () => {
		const { html } = renderMarkdown("```js\na\nb\nc\n```");
		expect(html).toContain("js · 3 LOC");
	});

	it("renders body-only display math: no fold bar, body kept for fold/copy", () => {
		const { html } = renderMarkdown("Here:\n\n$$x^2$$\n\ndone");
		expect(html).not.toContain("ccez-math-head");
		expect(html).toContain('data-math-index="0"');
		expect(html).toContain("ccez-math-body");
		expect(html).toContain("katex");
	});

	it("strips scripts and dangerous attributes", () => {
		const { html } = renderMarkdown(
			'hello <script>alert(1)</script><img src="x" onerror="alert(2)">'
		);
		expect(html).not.toContain("<script");
		expect(html).not.toContain("onerror");
		expect(html).toContain("hello");
	});

	it("strips thoughts: body only, never displayed", () => {
		const { html, codes } = renderMessage("<think>hmm</think>```js\nx()\n```", false);
		expect(html).not.toContain("ccez-thoughts");
		expect(html).not.toContain("hmm");
		expect(html).toContain("ccez-code");
		expect(codes).toHaveLength(1);
	});

	it("keeps code indices unique across the body", () => {
		const { html, codes } = renderMessage("```py\na\n```\n\n```js\nb\n```", false);
		expect(codes.map((c) => c.lang)).toEqual(["py", "js"]);
		expect(html).toContain('data-code-index="0"');
		expect(html).toContain('data-code-index="1"');
	});

	it("marks only ruby-capable paragraphs for aid room", () => {
		const { html } = renderMarkdown("hello\n\n漢字を読む");
		expect(html).toContain('<p dir="auto">hello</p>');
		expect(html).toContain('<p dir="auto" class="cjk">');
	});

	it("keeps blank-line breaks between CJK paragraphs", () => {
		const { html } = renderMarkdown("秋が近づく。\n\n空が高くなる。\n\n紅葉が色づく。");
		expect(html.match(/<p dir="auto" class="cjk">/g)).toHaveLength(3);
	});

	it("marks CJK list items like the aid path does", () => {
		const { html } = renderMarkdown("3. 漢字を読む\n4. 空が高くなる");
		expect(html).toContain('<li dir="auto" class="cjk">');
		expect(html).not.toMatch(/<li dir="auto">[^<]*[一-鿿]/);
		const plain = renderMarkdown("3. read this\n4. then that");
		expect(plain.html).toContain('<li dir="auto">read this</li>');
		expect(plain.html).not.toContain("cjk");
	});

	it("keeps task checkboxes working with the item mark", () => {
		const { html } = renderMarkdown("- [ ] 漢字を読む\n- [x] done");
		expect(html).toContain('type="checkbox"');
		expect(html).toContain('<li dir="auto" class="cjk">');
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

describe("latex math", () => {
	it("renders display math with copy, $ toggle, folded label, and raw source", () => {
		const { html, maths } = renderMarkdown("Here:\n\n$$x^2 + y^2$$\n\ndone");
		expect(maths).toEqual([{ kind: "display", tex: "x^2 + y^2", raw: "$$x^2 + y^2$$" }]);
		expect(html).toContain('data-math-index="0"');
		expect(html).toContain("ccez-math-body");
		expect(html).toContain("ccez-math-copy");
		expect(html).toContain("ccez-math-tex");
		expect(html).toContain("ccez-math-foldedlabel");
		expect(html).toContain("latex · 1 LOC");
		expect(html).toContain("ccez-math-raw");
		expect(html).toContain("katex");
	});

	it("drops a latex fence duplicating its neighboring display block", () => {
		const src = "```latex\n$$x^2$$\n```\n\n$$x^2$$";
		expect(stripLatexFenceDupes(src)).toBe("$$x^2$$");
		// Reversed order collapses the same way.
		expect(stripLatexFenceDupes("$$x^2$$\n\n```latex\n$$x^2$$\n```")).toBe("$$x^2$$");
		// Different equations stay twice.
		const other = "```latex\n$$x^2$$\n```\n\n$$y^2$$";
		expect(stripLatexFenceDupes(other)).toBe(other);
		// Fence delimiters aside, whitespace aside.
		expect(stripLatexFenceDupes("```latex\nx^2\n```\n\n$$x^2$$")).toBe("$$x^2$$");
	});

	it("renders a lone latex fence as display math, once", () => {
		const { html, maths, codes } = renderMarkdown("Work:\n\n```latex\n$$\\frac{a}{b}$$\n```\ndone");
		expect(codes).toHaveLength(0);
		expect(html).not.toContain("ccez-code");
		expect(maths).toHaveLength(1);
		expect(maths[0]?.kind).toBe("display");
		expect(maths[0]?.tex).toBe("\\frac{a}{b}");
		expect(html).toContain("ccez-math-copy");
		expect(html).toContain("katex");
	});

	it("shows a fenced-plus-display pair exactly once", () => {
		const { html } = renderMessage(
			"Quad:\n\n```latex\n$$x = 1$$\n```\n\n$$x = 1$$",
			false
		);
		expect(html.match(/data-math-index="0"/g)).toHaveLength(1);
		expect(html).not.toContain("ccez-code");
	});

	it("renders inline math bare, with no chrome at all", () => {
		const { html, maths } = renderMarkdown("slope \\(m = \\frac{a}{b}\\) here");
		expect(maths).toHaveLength(1);
		expect(maths[0]?.kind).toBe("inline");
		expect(html).toContain("ccez-math-inline");
		expect(html).not.toContain("ccez-math-head");
		expect(html).not.toContain("data-math-action");
		expect(html).toContain("katex");
	});

	it("keeps the inline wrapper free of block elements (divs would be ejected from the paragraph)", () => {
		const html = mathHtml({ kind: "inline", tex: "m", raw: "\\(m\\)" }, 0);
		const inner = html.slice(html.indexOf(">") + 1, html.lastIndexOf("<"));
		expect(inner).not.toContain("<div");
		expect(html).not.toContain("ccez-math-head");
	});

	it("truncates long TeX previews to one line", () => {
		expect(mathTexPreview("a + b", 48)).toBe("a + b");
		expect(mathTexPreview("x\n^2", 48)).toBe("x ^2");
		const long = mathTexPreview("a".repeat(60), 48);
		expect(long).toHaveLength(49);
		expect(long.endsWith("…")).toBe(true);
	});

	it("prefers the override for folded previews", () => {
		expect(foldPreviewText("anything", "\"quoted\"")).toBe("\"quoted\"");
	});

	it("previews plain text as the first line, as before", () => {
		expect(foldPreviewText("hello world", null)).toBe("hello world");
		expect(foldPreviewText(`${"a".repeat(200)}\nsecond`, null)).toBe("a".repeat(140));
	});

	it("folds display math into parenthesized latex", () => {
		expect(foldPreviewText("$$E = mc^2$$", null)).toBe("\\(E = mc^2\\)");
		expect(foldPreviewText("\\[a + b\\]", null)).toBe("\\(a + b\\)");
		expect(foldPreviewText("$$\nx^2\n$$", null)).toBe("\\(x^2\\)");
	});

	it("folds inline math up to its closing delimiter", () => {
		expect(foldPreviewText("$x^2$ and more", null)).toBe("\\(x^2\\)");
	});

	it("truncates long folded equations with an ellipsis", () => {
		const preview = foldPreviewText(`$$${"a".repeat(200)}$$`, null);
		expect(preview.startsWith("\\(")).toBe(true);
		expect(preview.endsWith("…\\)")).toBe(true);
	});

	it("keeps invalid math as plain text, never fatal", () => {
		const { html, maths } = renderMarkdown("$$\\notacommand{$$");
		expect(maths).toHaveLength(1);
		expect(html).not.toContain("katex");
		expect(html).toContain("notacommand");
		expect(() => mathHtml({ kind: "display", tex: "   ", raw: "$$   $$" }, 0)).not.toThrow();
		expect(mathHtml({ kind: "display", tex: "   ", raw: "$$   $$" }, 0)).toContain("$$");
	});

	it("leaves unclosed delimiters literal (streaming-safe)", () => {
		const { html, maths } = renderMarkdown("halfway $$x^2 and \\(y");
		expect(maths).toEqual([]);
		expect(html).not.toContain("ccez-math");
		expect(html).toContain("x^2");
	});

	it("never renders math inside fenced code or inline code spans", () => {
		const { html, codes, maths } = renderMarkdown(
			"```tex\n$$x^2$$\n```\n\n`\\(y\\)` and `$$z$$`"
		);
		expect(maths).toEqual([]);
		expect(codes).toHaveLength(1);
		expect(html).not.toContain("ccez-math");
		expect(html).toContain("ccez-code");
	});

	it("never renders thoughts math: body indices only", () => {
		const { html, maths } = renderMessage("<think>$$a$$</think>See \\(b\\) and $$c$$", false);
		expect(maths.map((m) => m.tex)).toEqual(["b", "c"]);
		expect(html).toContain('data-math-index="0"');
		expect(html).toContain('data-math-index="1"');
		expect(html).not.toContain('data-math-index="2"');
	});

	it("renders single-dollar inline math bare like paren inline math", () => {
		const { html, maths } = renderMarkdown("slope $m = \\frac{a}{b}$ here");
		expect(maths).toEqual([{ kind: "inline", tex: "m = \\frac{a}{b}", raw: "$m = \\frac{a}{b}$" }]);
		expect(html).toContain("ccez-math-inline");
		expect(html).not.toContain("ccez-math-head");
		expect(html).not.toContain("data-math-action");
		expect(html).toContain("katex");
	});

	it("leaves prices, mid-word joins, and padded dollars literal", () => {
		const { html, maths } = renderMarkdown("costs $5 and $10, plus a$b and $ x$ done");
		expect(maths).toEqual([]);
		expect(html).not.toContain("ccez-math");
		expect(html).toContain("$5");
	});

	it("leaves unclosed single dollars literal and skips escaped closers", () => {
		const { html, maths } = renderMarkdown("halfway $x^2 and done");
		expect(maths).toEqual([]);
		expect(html).not.toContain("ccez-math");
		const escaped = renderMarkdown("price \\$5 and $y$ ok");
		expect(escaped.maths.map((m) => m.tex)).toEqual(["y"]);
	});

	it("never renders single-dollar math inside fenced code or code spans", () => {
		const { html, maths } = renderMarkdown("```\n$x^2$\n```\n\n`$y$` done");
		expect(maths).toEqual([]);
		expect(html).not.toContain("ccez-math");
	});

	it("extracts display math across lines and skips escaped openers", () => {
		const { stripped, maths } = extractMath("a\n$$\nx\n$$\n\\\\(not math\\\\) and \\(real\\)");
		expect(maths.map((m) => m.kind)).toEqual(["display", "inline"]);
		expect(maths[0]?.tex).toBe("\nx\n");
		expect(maths[1]?.tex).toBe("real");
		expect(stripped).toContain("\\\\(not math\\\\)");
	});
});

describe("token estimates", () => {
	it("estimates ~4 chars per token", () => {
		expect(estimateTextTokens("")).toBe(1);
		expect(estimateTextTokens("abcd")).toBe(1);
		expect(estimateTextTokens("abcde")).toBe(2);
	});
});

describe("foldedCodeLabel", () => {
	it("names the language and line count with a middle dot", () => {
		expect(foldedCodeLabel("python", 13)).toBe("python · 13 LOC");
		expect(foldedCodeLabel("text", 1)).toBe("text · 1 LOC");
		expect(foldedCodeLabel("js", 0)).toBe("js · 0 LOC");
	});
});

describe("mathCopyText", () => {
	it("wraps TeX in $$ delimiters, verbatim", () => {
		expect(mathCopyText("x^2 + y^2")).toBe("$$x^2 + y^2$$");
		expect(mathCopyText("\nx\n")).toBe("$$\nx\n$$");
		expect(mathCopyText("")).toBe("$$$$");
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
