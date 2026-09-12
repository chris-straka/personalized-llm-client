import { Marked, type Renderer, type Tokens } from "marked";
import DOMPurify from "dompurify";
import katex from "katex";
import { createHighlighter, type Highlighter } from "shiki";
import { RUBY_SCRIPT_RE } from "./reading";

/**
 * Message rendering: markdown → sanitized HTML with code chrome, collapsed
 * model thoughts, and sources-section stripping. Code highlighting (Shiki)
 * runs as a separate async pass so streaming text renders instantly.
 */

const THINK_OPEN = /<think>/i;
const THINK_FULL = /<think>([\s\S]*?)<\/think>/gi;

/** Split `<think>…</think>` reasoning out of model output. Unclosed tags
 * (mid-stream) treat the rest of the message as thoughts. */
export function extractThoughts(markdown: string): { thoughts: string | null; body: string } {
	const full = [...markdown.matchAll(THINK_FULL)];
	if (full.length > 0) {
		const thoughts = full
			.map((m) => (m[1] ?? "").trim())
			.filter(Boolean)
			.join("\n\n");
		const body = markdown.replace(THINK_FULL, "").trim();
		return { thoughts: thoughts || null, body };
	}
	const open = markdown.search(THINK_OPEN);
	if (open >= 0) {
		const tag = markdown.match(THINK_OPEN)![0];
		const thoughts = markdown.slice(open + tag.length).trim();
		return { thoughts: thoughts || null, body: markdown.slice(0, open).trim() };
	}
	return { thoughts: null, body: markdown };
}

const SOURCES_HEADING = /^#{1,4}\s+sources(\s+(and|&)\s+citations)?\s*$/im;

/** Drop a trailing "Sources" section unless the user asked for sources. */
export function stripSourcesIfUnasked(body: string, sourcesAsked: boolean): string {
	if (sourcesAsked) return body;
	const match = body.search(SOURCES_HEADING);
	if (match < 0) return body;
	return body.slice(0, match).trimEnd();
}

/** True when any user text mentions sources (i.e. the user asked for them). */
export function sourcesAsked(userTexts: string[]): boolean {
	return userTexts.some((t) => /source/i.test(t));
}

/** Rough token estimate for plain text (~4 chars per token). */
export function estimateTextTokens(text: string): number {
	return Math.max(1, Math.ceil(text.length / 4));
}

/** Copy body for a message: thoughts and unasked sources stripped for
 * assistants, raw content otherwise. */
export function plainBody(content: string, role: string, sourcesWanted: boolean): string {
	if (role !== "assistant") return content;
	const { body } = extractThoughts(content);
	return stripSourcesIfUnasked(body, sourcesWanted);
}

export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export interface MathEntry {
	/** Display (`$$…$$`) blocks get the code-style head; inline (`\(…\)`) too. */
	kind: "display" | "inline";
	/** Raw TeX between the delimiters (what Copy writes). */
	tex: string;
	/** Full source slice including delimiters (plain fallback rendering). */
	raw: string;
}

export interface RenderedMessage {
	html: string;
	/** Raw code per fenced block, in document order (for copy + highlight). */
	codes: Array<{ lang: string; code: string }>;
	/** Raw TeX per math block, in document order (for copy). Same shared
	 * index space as `codes` across thoughts and body. */
	maths: MathEntry[];
}

/** Synchronous render: markdown → sanitized HTML with plain (unhighlighted)
 * code blocks. Safe to call on every streamed token. */
export function renderMarkdown(markdownText: string): RenderedMessage {
	const rendered: RenderedMessage = { html: "", codes: [], maths: [] };
	rendered.html = sanitize(renderInto(markdownText, rendered.codes, rendered.maths));
	return rendered;
}

/** Render a full assistant message: thoughts collapsed on top, body below. */
export function renderMessage(markdownText: string, sourcesWanted: boolean): RenderedMessage {
	const { thoughts, body } = extractThoughts(markdownText);
	const clean = stripSourcesIfUnasked(body, sourcesWanted);
	const rendered: RenderedMessage = { html: "", codes: [], maths: [] };
	let html = "";
	if (thoughts) {
		const inner = renderInto(thoughts, rendered.codes, rendered.maths);
		html +=
			`<details class="ccez-thoughts"><summary>thoughts</summary>` +
			`<div class="ccez-thoughts-body">${inner}</div></details>`;
	}
	html += renderInto(clean, rendered.codes, rendered.maths);
	rendered.html = sanitize(html);
	return rendered;
}

/**
 * LaTeX math in MAIN CHAT messages only (never the composer prompt, which
 * stays plain CodeMirror text): display `$$…$$` and inline `\(…\)` / `$…$`
 * render via KaTeX (bundled, offline). Unknown/invalid math keeps its plain
 * source rendering, never fatal. Unclosed delimiters (mid-stream) stay
 * literal. Fenced code blocks and inline code spans never become math.
 */

// Placeholder markers ride through marked inside private-use codepoints so
// ordinary text can never collide with them; the math HTML is spliced back
// after the markdown parse (marked would otherwise mangle the KaTeX tags).
const MATH_OPEN = "\uE000";
const MATH_CLOSE = "\uE001";
const MATH_PLACEHOLDER_RE = /\uE000(\d+)\uE001/g;

function mathPlaceholder(index: number): string {
	return `${MATH_OPEN}${index}${MATH_CLOSE}`;
}

/**
 * Pull math spans out of markdown source, skipping ``` fenced blocks and
 * backtick code spans. Pure and unit-tested. Returns the source with
 * placeholders plus the math entries in document order.
 */
export function extractMath(markdownText: string): { stripped: string; maths: MathEntry[] } {
	const maths: MathEntry[] = [];
	let out = "";
	let i = 0;
	const len = markdownText.length;
	const lineStart = (pos: number): boolean => pos === 0 || markdownText[pos - 1] === "\n";
	while (i < len) {
		// Fenced code block: skip whole lines from opener to closer (or EOF).
		if (lineStart(i) && markdownText.startsWith("```", i)) {
			const openEnd = markdownText.indexOf("\n", i);
			const bodyStart = openEnd === -1 ? len : openEnd + 1;
			let close = bodyStart;
			let closeEnd = -1;
			while (close < len) {
				const nl = markdownText.indexOf("\n", close);
				const lineEnd = nl === -1 ? len : nl;
				const line = markdownText.slice(close, lineEnd);
				if (/^\s*```\s*$/.test(line)) {
					closeEnd = nl === -1 ? len : nl + 1;
					break;
				}
				close = lineEnd + 1;
			}
			const end = closeEnd === -1 ? len : closeEnd;
			out += markdownText.slice(i, end);
			i = end;
			continue;
		}
		const ch = markdownText[i];
		// Backslash escapes: `\\` stays a literal backslash, `\(` never
		// opens math, and `\X` never reaches marked as an opener.
		if (ch === "\\") {
			const next = markdownText[i + 1];
			if (next === "(") {
				const close = markdownText.indexOf("\\)", i + 2);
				if (close !== -1) {
					const tex = markdownText.slice(i + 2, close);
					const raw = markdownText.slice(i, close + 2);
					maths.push({ kind: "inline", tex, raw });
					out += mathPlaceholder(maths.length - 1);
					i = close + 2;
					continue;
				}
			}
			out += markdownText.slice(i, Math.min(i + 2, len));
			i += next === undefined ? 1 : 2;
			continue;
		}
		// Inline code span: skip to the matching run on the same line.
		if (ch === "`") {
			let run = 1;
			while (markdownText[i + run] === "`") run++;
			const nl = markdownText.indexOf("\n", i);
			const lineEnd = nl === -1 ? len : nl;
			const ticks = "`".repeat(run);
			const close = markdownText.indexOf(ticks, i + run);
			if (close !== -1 && close < lineEnd) {
				out += markdownText.slice(i, close + run);
				i = close + run;
				continue;
			}
			out += markdownText.slice(i, i + run);
			i += run;
			continue;
		}
		// Display math: `$$…$$`, possibly across lines.
		if (ch === "$" && markdownText[i + 1] === "$") {
			const close = markdownText.indexOf("$$", i + 2);
			if (close !== -1) {
				const tex = markdownText.slice(i + 2, close);
				const raw = markdownText.slice(i, close + 2);
				maths.push({ kind: "display", tex, raw });
				out += mathPlaceholder(maths.length - 1);
				i = close + 2;
				continue;
			}
			out += "$$";
			i += 2;
			continue;
		}
		// Inline math: `$…$`. Guards against the classic false
		// positives — `$5 and $10` prices, `a$b` mid-word joins, and
		// `$ x$` padded pairs all stay literal. Escaped `\$` never
		// reaches here (consumed as a pair above); a `\$` inside the
		// scan is skipped, never a closer.
		if (ch === "$") {
			const prev = i === 0 ? "" : markdownText[i - 1];
			const next = markdownText[i + 1];
			if (next !== undefined && !/\s/.test(next) && !/[A-Za-z0-9]/.test(prev ?? "")) {
				let j = i + 1;
				let close = -1;
				while (j < len) {
					if (markdownText[j] === "\\") {
						j += 2;
						continue;
					}
					if (markdownText[j] === "$") {
						// `$$` is display territory, never an inline closer.
						if (markdownText[j + 1] === "$") {
							j += 2;
							continue;
						}
						// A closer followed by a letter/digit is a price
						// join (`a$b`), not an ending.
						if (
							!/\s/.test(markdownText[j - 1] ?? " ") &&
							!/[A-Za-z0-9]/.test(markdownText[j + 1] ?? "")
						) {
							close = j;
							break;
						}
					}
					j++;
				}
				if (close !== -1) {
					const tex = markdownText.slice(i + 1, close);
					// A bare `$` inside the span means the pairing crossed
					// prices or joins (`$5 … $10`); real TeX never holds
					// one. Escaped `\$` is fine — KaTeX renders it.
					if (!tex.replace(/\\\$/g, "").includes("$")) {
						const raw = markdownText.slice(i, close + 1);
						maths.push({ kind: "inline", tex, raw });
						out += mathPlaceholder(maths.length - 1);
						i = close + 1;
						continue;
					}
				}
			}
			out += "$";
			i++;
			continue;
		}
		out += ch;
		i++;
	}
	return { stripped: out, maths };
}

/** KaTeX HTML for one math entry, or its escaped plain source on failure. */
export function mathHtml(entry: MathEntry, index: number): string {
	let inner: string;
	try {
		if (!entry.tex.trim()) throw new Error("empty math");
		inner = katex.renderToString(entry.tex, {
			displayMode: entry.kind === "display",
			throwOnError: true,
			output: "html",
			strict: false,
			trust: false
		});
	} catch {
		// Unknown/invalid math keeps plain rendering, never fatal.
		return escapeHtml(entry.raw);
	}
	// Same chrome as ccez-code: language/label head with Fold and Copy
	// buttons per math block (clicks delegate in MessageBody like code).
	// The inline head is a span: a div inside a paragraph would be
	// ejected by the HTML parser, stranding the buttons outside the
	// inline wrapper.
	const head = (tag: "div" | "span"): string =>
		`<${tag} class="ccez-math-head">` +
		`<span class="ccez-math-lang">math</span>` +
		`<button type="button" data-math-action="fold">Fold</button>` +
		`<button type="button" data-math-action="copy">Copy</button>` +
		`</${tag}>`;
	if (entry.kind === "display") {
		return (
			`<div class="ccez-math" data-math-index="${index}">` +
			head("div") +
			`<div class="ccez-math-body">${inner}</div></div>`
		);
	}
	return (
		`<span class="ccez-math-inline" data-math-index="${index}">` +
		head("span") +
		`<span class="ccez-math-body">${inner}</span></span>`
	);
}

/**
 * Shared-code-array render so `data-code-index` attributes stay unique even
 * when thoughts and body are rendered separately.
 */
/**
 * Blocks whose base direction follows their own text: without this an
 * Arabic paragraph inherits the app's LTR, so its first line starts at
 * the left and a top-right drag begins mid-text instead of at the
 * start. Code keeps its own direction (mixed-direction source must not
 * reorder); thoughts chrome is app UI, not message text.
 */
const DIR_AUTO_BLOCKS = /<(p|li|h[1-6]|blockquote|td|th)(?=[\s>])/g;

function renderInto(
	markdownText: string,
	codes: Array<{ lang: string; code: string }>,
	maths: MathEntry[]
): string {
	// Math leaves the source first (code fences/spans excluded there), so
	// marked never sees the delimiters and KaTeX tags never pass through it.
	const base = maths.length;
	const { stripped, maths: found } = extractMath(markdownText);
	for (const entry of found) maths.push(entry);
	const instance = new Marked({ breaks: true });
	instance.use({
		renderer: {
			// Paragraphs that can carry ruby reserve its vertical room
			// (see aid-space): English paragraphs stay tight so their
			// selection highlight hugs the text. Lists get the same mark
			// on the item (body renders exactly like the default — task
			// checkboxes and loose-list wrapping untouched), or toggling
			// furigana jumps line-height normal-to-tall on every item.
			paragraph(this: Renderer, { tokens }: Tokens.Paragraph): string {
				// Block tokens arrive unparsed: inline markup (bold, code
				// spans) still needs the parser before detection.
				const inner = this.parser.parseInline(tokens);
				const bare = inner.replace(/<[^>]*>/g, "");
				const cls = RUBY_SCRIPT_RE.test(bare) ? ` class="cjk"` : "";
				return `<p${cls}>${inner}</p>\n`;
			},
			listitem(this: Renderer, item: Tokens.ListItem): string {
				// marked v18 default is `<li>${parse(tokens)}</li>`: same
				// body, plus the ruby-room mark the aid path already adds.
				const body = this.parser.parse(item.tokens);
				const bare = body.replace(/<[^>]*>/g, "");
				const cls = RUBY_SCRIPT_RE.test(bare) ? ` class="cjk"` : "";
				return `<li${cls}>${body}</li>\n`;
			},
			code({ text, lang }: { text: string; lang?: string }): string {
				const language = (lang ?? "").trim() || "text";
				const index = codes.length;
				codes.push({ lang: language, code: text });
				return (
					`<div class="ccez-code" data-code-index="${index}">` +
					`<div class="ccez-code-head">` +
					`<span class="ccez-code-lang">${escapeHtml(language)}</span>` +
					`<button type="button" data-code-action="fold">Fold</button>` +
					`<button type="button" data-code-action="copy">Copy</button>` +
					`</div><pre><code data-code-index="${index}">${escapeHtml(text)}</code></pre></div>`
				);
			}
		}
	});
	const html = instance.parse(stripped) as string;
	const withMath = html.replace(MATH_PLACEHOLDER_RE, (_match, num: string) => {
		const index = base + Number(num);
		const entry = maths[index];
		// Placeholders are ours alone; a missing entry keeps the raw marker.
		if (!entry) return _match;
		return mathHtml(entry, index);
	});
	return withMath.replace(DIR_AUTO_BLOCKS, "<$1 dir=\"auto\"");
}

let purifier: ReturnType<typeof DOMPurify> | null = null;

export function sanitize(dirty: string): string {
	if (typeof window === "undefined") {
		// Non-DOM context (SSR/prerender): escape everything, no markup.
		return `<p dir="auto">${escapeHtml(dirty)}</p>`;
	}
	purifier ??= DOMPurify(window);
	return purifier.sanitize(dirty, {
		ADD_TAGS: ["details", "summary", "button", "ruby", "rt", "rp"],
		ADD_ATTR: [
			"open",
			"class",
			"style",
			"aria-hidden",
			"data-code-index",
			"data-code-action",
			"data-math-index",
			"data-math-action",
			"data-paste-fold",
			"type",
			"dir"
		]
	});
}

/** One visible run: body text, or a closed-fold marker button. */
export type FoldSegment =
	| { kind: "text"; text: string }
	| { kind: "marker"; index: number; chars: number };

/** Marker button HTML (same label as the composer). Chars/index are numbers — nothing to escape. */
export function pasteFoldButton(index: number, chars: number): string {
	return `<button type="button" class="paste-fold" data-paste-fold="${index}">[paste ${chars} chars]</button>`;
}

/**
 * Split content into visible runs: open folds merge into the surrounding
 * text, closed folds become marker segments. Invalid or overlapping folds
 * are ignored, never fatal. Pure and unit-tested.
 */
export function foldSegments(
	content: string,
	folds: Array<{ start: number; end: number; chars: number; open?: boolean }> | undefined
): FoldSegment[] {
	if (!folds || folds.length === 0) return [{ kind: "text", text: content }];
	const ordered = folds
		.map((fold, index) => ({ ...fold, index }))
		.filter((fold) => fold.start >= 0 && fold.end <= content.length && fold.start < fold.end)
		.sort((a, b) => a.start - b.start || a.end - b.end);
	const segments: FoldSegment[] = [];
	let run = "";
	let cursor = 0;
	const flush = () => {
		if (run) {
			segments.push({ kind: "text", text: run });
			run = "";
		}
	};
	for (const fold of ordered) {
		if (fold.start < cursor) continue; // overlapping: keep the earliest
		run += content.slice(cursor, fold.start);
		if (fold.open) run += content.slice(fold.start, fold.end);
		else {
			flush();
			segments.push({ kind: "marker", index: fold.index, chars: fold.chars });
		}
		cursor = fold.end;
	}
	run += content.slice(cursor);
	flush();
	return segments;
}

/**
 * Splice closed paste folds into display text: each becomes a
 * `<button data-paste-fold>` marker carrying the composer's
 * `[Pasted content N chars]` label; open folds stay inline. Clicks
 * delegate in MessageBody like code-block buttons. Pure and unit-tested.
 */
export function applyPasteFolds(
	content: string,
	folds: Array<{ start: number; end: number; chars: number; open?: boolean }> | undefined
): string {
	return foldSegments(content, folds)
		.map((segment) =>
			segment.kind === "text" ? segment.text : pasteFoldButton(segment.index, segment.chars)
		)
		.join("");
}

/** Plain-text copy of rendered HTML (for "copy as text"). */
export function htmlToText(html: string): string {
	if (typeof window === "undefined" || typeof document === "undefined") {
		return html.replace(/<[^>]*>/g, "");
	}
	const el = document.createElement("div");
	el.innerHTML = html;
	return el.innerText ?? el.textContent ?? "";
}

// --- Shiki highlighting (async enhancement pass) ---

const PRELOAD_LANGS = [
	"javascript",
	"typescript",
	"tsx",
	"python",
	"rust",
	"go",
	"java",
	"c",
	"cpp",
	"csharp",
	"bash",
	"sh",
	"json",
	"yaml",
	"toml",
	"markdown",
	"html",
	"css",
	"sql",
	"diff",
	"text",
	"plaintext"
];

let highlighterPromise: Promise<Highlighter> | null = null;

/** Lazily loaded singleton — Shiki's WASM/TextMate grammars are heavy. */
export function getHighlighter(): Promise<Highlighter> {
	highlighterPromise ??= createHighlighter({
		themes: ["github-light", "github-dark"],
		langs: PRELOAD_LANGS
	});
	return highlighterPromise;
}

/**
 * Replace each `code[data-code-index]` body with Shiki-highlighted HTML
 * (dual light/dark CSS variables; the stylesheet picks by media query).
 * Unknown languages keep their plain rendering.
 */
export async function highlightRendered(rendered: RenderedMessage): Promise<string> {
	if (rendered.codes.length === 0) return rendered.html;
	let highlighter: Highlighter;
	try {
		highlighter = await getHighlighter();
	} catch {
		return rendered.html;
	}
	const loaded = new Set(highlighter.getLoadedLanguages());
	// Synchronous throughout (codeToHtml is not async): no Promise.all.
	const highlighted = rendered.codes.map(({ lang, code }) => {
		const language = loaded.has(lang) ? lang : "plaintext";
		try {
			const full = highlighter.codeToHtml(code, {
				lang: language,
				themes: { light: "github-light", dark: "github-dark" }
			});
			const match = full.match(/<pre[^>]*>([\s\S]*)<\/pre>/);
			return match ? (match[1] ?? "").replace(/^<code[^>]*>|<\/code>$/g, "") : null;
		} catch {
			return null;
		}
	});
	if (typeof document === "undefined") return rendered.html;
	const template = document.createElement("template");
	template.innerHTML = rendered.html;
	template.content.querySelectorAll("code[data-code-index]").forEach((el) => {
		const fragment = highlighted[Number(el.getAttribute("data-code-index"))];
		// The `shiki` class anchors the dark-mode CSS-variable override
		// (the original pre.shiki wrapper is not carried over).
		if (fragment) {
			el.innerHTML = fragment;
			el.classList.add("shiki");
		}
	});
	const wrapper = document.createElement("div");
	wrapper.append(template.content.cloneNode(true));
	return wrapper.innerHTML;
}
