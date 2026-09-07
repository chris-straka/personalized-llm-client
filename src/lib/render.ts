import { Marked } from "marked";
import DOMPurify from "dompurify";
import { createHighlighter, type Highlighter } from "shiki";

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
		const thoughts = full.map((m) => m[1].trim()).filter(Boolean).join("\n\n");
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

export interface RenderedMessage {
	html: string;
	/** Raw code per fenced block, in document order (for copy + highlight). */
	codes: Array<{ lang: string; code: string }>;
}

/** Synchronous render: markdown → sanitized HTML with plain (unhighlighted)
 * code blocks. Safe to call on every streamed token. */
export function renderMarkdown(markdownText: string): RenderedMessage {
	const rendered: RenderedMessage = { html: "", codes: [] };
	rendered.html = sanitize(renderInto(markdownText, rendered.codes));
	return rendered;
}

/** Render a full assistant message: thoughts collapsed on top, body below. */
export function renderMessage(markdownText: string, sourcesWanted: boolean): RenderedMessage {
	const { thoughts, body } = extractThoughts(markdownText);
	const clean = stripSourcesIfUnasked(body, sourcesWanted);
	const rendered: RenderedMessage = { html: "", codes: [] };
	let html = "";
	if (thoughts) {
		const inner = renderInto(thoughts, rendered.codes);
		html +=
			`<details class="ccez-thoughts"><summary>thoughts</summary>` +
			`<div class="ccez-thoughts-body">${inner}</div></details>`;
	}
	html += renderInto(clean, rendered.codes);
	rendered.html = sanitize(html);
	return rendered;
}

/**
 * Shared-code-array render so `data-code-index` attributes stay unique even
 * when thoughts and body are rendered separately.
 */
function renderInto(markdownText: string, codes: Array<{ lang: string; code: string }>): string {
	const instance = new Marked({ breaks: true });
	instance.use({
		renderer: {
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
	return instance.parse(markdownText) as string;
}

let purifier: ReturnType<typeof DOMPurify> | null = null;

export function sanitize(dirty: string): string {
	if (typeof window === "undefined") {
		// Non-DOM context (SSR/prerender): escape everything, no markup.
		return `<p>${escapeHtml(dirty)}</p>`;
	}
	purifier ??= DOMPurify(window);
	return purifier.sanitize(dirty, {
		ADD_TAGS: ["details", "summary", "button", "ruby", "rt", "rp"],
		ADD_ATTR: ["open", "class", "style", "data-code-index", "data-code-action", "type"]
	});
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
	const highlighted = await Promise.all(
		rendered.codes.map(async ({ lang, code }) => {
			const language = loaded.has(lang) ? lang : "plaintext";
			try {
				const full = highlighter.codeToHtml(code, {
					lang: language,
					themes: { light: "github-light", dark: "github-dark" }
				});
				const match = full.match(/<pre[^>]*>([\s\S]*)<\/pre>/);
				return match ? match[1].replace(/^<code[^>]*>|<\/code>$/g, "") : null;
			} catch {
				return null;
			}
		})
	);
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
