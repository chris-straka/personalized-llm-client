<script lang="ts">
	import { tick } from "svelte";
	import { detectScript } from "$lib/reading";
	import { pinyinRuby, plainParagraphs } from "$lib/pinyin";
	import { furiganaHtml } from "$lib/furigana";
	import {
		renderMessage,
		renderMarkdown,
		highlightRendered,
		type RenderedMessage
	} from "$lib/render";
	import type { ChatMsg } from "$lib/chat";

	export interface AnnotationMark {
		id: string;
		number: number;
		quote: string;
	}

	interface Props {
		message: ChatMsg;
		/** True while this message's reply is still streaming in. */
		streaming: boolean;
		/** True when the user asked for sources (keeps Sources sections). */
		sourcesWanted: boolean;
		/** Whole-message fold state (owned by the parent). */
		folded: boolean;
		/** Annotation badges to stamp onto this message's quoted spans. */
		marks?: AnnotationMark[];
		/** Badge click (opens the review panel at the annotation). */
		onBadgeClick?: (id: string) => void;
		/** Global reading-aids toggle (pinyin / furigana). */
		readingAids?: boolean;
		/** Vocalized Arabic text replacing the message body when present. */
		textOverride?: string | null;
	}

	let {
		message,
		streaming,
		sourcesWanted,
		folded,
		marks = [],
		onBadgeClick,
		readingAids = false,
		textOverride = null
	}: Props = $props();

	let html = $state("");
	let bodyEl: HTMLElement | undefined = $state();
	let aidLoading = $state(false);
	let aidActive = $state(false);
	let rendered: RenderedMessage | null = null;
	let highlightRun = 0;
	let aidRun = 0;

	$effect(() => {
		const content = textOverride ?? message.content;
		// Read synchronously so the effect re-runs when badges change.
		const items = marks;
		const skipMarks = streaming || folded;
		// Aids render from raw text (markdown set aside); Arabic vocalization
		// arrives via textOverride and takes the normal path.
		const aidScript =
			!textOverride && readingAids && !streaming ? detectScript(message.content) : null;
		// Marks apply after Svelte flushes the new HTML (see applyMarks).
		const stamp = () => void tick().then(() => applyMarks(items, skipMarks));
		if (aidScript === "zh") {
			rendered = null;
			aidLoading = false;
			aidActive = true;
			html = plainParagraphs(pinyinRuby(message.content));
			stamp();
			return;
		}
		if (aidScript === "ja") {
			rendered = null;
			aidLoading = true;
			const run = ++aidRun;
			void furiganaHtml(message.content)
				.then((aided) => {
					if (run !== aidRun) return;
					aidActive = true;
					html = aided;
					stamp();
				})
				.finally(() => {
					if (run === aidRun) aidLoading = false;
				});
			return;
		}
		aidLoading = false;
		aidActive = false;
		aidRun++; // invalidate any in-flight furigana conversion
		const snapshot: RenderedMessage =
			message.role === "assistant"
				? renderMessage(content, sourcesWanted)
				: renderMarkdown(content);
		rendered = snapshot;
		html = snapshot.html;
		if (!streaming && snapshot.codes.length > 0) {
			const run = ++highlightRun;
			void highlightRendered(snapshot).then((enhanced) => {
				if (run !== highlightRun) return;
				html = enhanced;
				stamp();
			});
		} else {
			stamp();
		}
	});

	/**
	 * Wrap the first occurrence of each quoted span in a highlight + numbered
	 * badge. Old marks unwrap first so re-renders never nest. Quotes that no
	 * longer match (edited messages, markdown reshaping) stay listed in the
	 * review panel without a badge — never an error.
	 */
	function applyMarks(items: AnnotationMark[], skip: boolean): void {
		if (!bodyEl) return;
		for (const badge of bodyEl.querySelectorAll("[data-ann-badge]")) badge.remove();
		for (const mark of bodyEl.querySelectorAll("mark.ccez-ann")) {
			mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
		}
		if (skip || items.length === 0) return;
		const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT);
		const nodes: Text[] = [];
		while (walker.nextNode()) nodes.push(walker.currentNode as Text);
		for (const item of items) {
			if (!item.quote) continue;
			const node = nodes.find((n) => n.textContent?.includes(item.quote));
			if (!node?.textContent) continue;
			const at = node.textContent.indexOf(item.quote);
			const range = document.createRange();
			range.setStart(node, at);
			range.setEnd(node, at + item.quote.length);
			const highlight = document.createElement("mark");
			highlight.className = "ccez-ann";
			const badge = document.createElement("button");
			badge.type = "button";
			badge.className = "ccez-ann-badge";
			badge.dataset.annBadge = item.id;
			badge.textContent = String(item.number);
			badge.title = "Open annotation";
			try {
				range.surroundContents(highlight);
			} catch {
				continue;
			}
			highlight.after(badge);
		}
	}

	function onBodyClick(event: MouseEvent): void {
		const badge = (event.target as HTMLElement).closest<HTMLElement>("[data-ann-badge]");
		if (badge) {
			onBadgeClick?.(badge.dataset.annBadge ?? "");
			return;
		}
		const button = (event.target as HTMLElement).closest<HTMLElement>("[data-code-action]");
		if (!button || !rendered) return;
		const block = button.closest<HTMLElement>(".ccez-code");
		const index = Number(block?.dataset.codeIndex ?? -1);
		const entry = rendered.codes[index];
		if (!entry) return;
		if (button.dataset.codeAction === "copy") {
			void navigator.clipboard?.writeText(entry.code).catch(() => {});
		} else {
			const pre = block?.querySelector("pre");
			if (!pre) return;
			const collapsed = pre.style.display !== "none";
			pre.style.display = collapsed ? "none" : "";
			button.textContent = collapsed ? "Unfold" : "Fold";
		}
	}
</script>

{#if folded}
	<div class="folded-preview">{message.content.split("\n")[0].slice(0, 140)}</div>
{:else}
	<!-- Delegated code fold/copy buttons live inside the sanitized HTML. -->
	{#if aidLoading}
		<p class="aid-loading">loading dictionary…</p>
	{/if}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- html is DOMPurify-sanitized in render.ts -->
	<div class="rendered" class:aid={aidActive} bind:this={bodyEl} onclick={onBodyClick}>{@html html}</div>
{/if}

<style>
	.rendered {
		word-break: break-word;
		font-size: 0.92rem;
		line-height: 1.5;
	}
	.folded-preview {
		color: #6e6e73;
		font-size: 0.85rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.aid-loading {
		font-size: 0.78rem;
		color: #98989f;
		margin: 0 0 0.3em;
	}
	.rendered :global(ruby) {
		ruby-align: center;
	}
	.rendered :global(rt) {
		font-size: 0.62em;
		color: #6e6e73;
	}
	.rendered.aid :global(p) {
		line-height: 2.1;
	}
	.rendered :global(p) {
		margin: 0.4em 0;
	}
	.rendered :global(p:first-child) {
		margin-top: 0;
	}
	.rendered :global(p:last-child) {
		margin-bottom: 0;
	}
	.rendered :global(pre) {
		background: #f1f1f4;
		border-radius: 8px;
		padding: 0.6rem 0.8rem;
		overflow-x: auto;
		font-size: 0.82rem;
		line-height: 1.45;
	}
	.rendered :global(:not(pre) > code) {
		background: #f1f1f4;
		border-radius: 5px;
		padding: 0.05rem 0.3rem;
		font-size: 0.85em;
	}
	.rendered :global(table) {
		border-collapse: collapse;
		font-size: 0.85rem;
	}
	.rendered :global(th),
	.rendered :global(td) {
		border: 1px solid #c7c7cc;
		padding: 0.25rem 0.6rem;
	}
	.rendered :global(blockquote) {
		margin: 0.4em 0;
		padding-left: 0.7rem;
		border-left: 3px solid #c7c7cc;
		color: #6e6e73;
	}
	.rendered :global(.ccez-code) {
		margin: 0.5em 0;
		border: 1px solid #e5e5ea;
		border-radius: 8px;
		overflow: hidden;
	}
	.rendered :global(.ccez-code-head) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.25rem 0.6rem;
		background: #f1f1f4;
		font-size: 0.75rem;
	}
	.rendered :global(.ccez-code-lang) {
		font-weight: 650;
	}
	.rendered :global(.ccez-code-head button) {
		border: 1px solid #c7c7cc;
		border-radius: 6px;
		background: #fff;
		cursor: pointer;
		font-size: 0.75rem;
		padding: 0.05rem 0.5rem;
	}
	.rendered :global(.ccez-code-head button:first-of-type) {
		margin-left: auto;
	}
	.rendered :global(.ccez-code pre) {
		margin: 0;
		border-radius: 0;
		background: #fff;
	}
	.rendered :global(.ccez-thoughts) {
		font-size: 0.8rem;
		color: #98989f;
		margin-bottom: 0.4em;
	}
	.rendered :global(.ccez-thoughts summary) {
		cursor: pointer;
		display: inline-block;
	}
	.rendered :global(mark.ccez-ann) {
		background: #fff3b0;
		border-radius: 3px;
		padding: 0 1px;
		color: inherit;
	}
	.rendered :global(button.ccez-ann-badge) {
		display: inline-block;
		min-width: 1.15rem;
		height: 1.15rem;
		margin-left: 0.15rem;
		padding: 0 0.25rem;
		border: 0;
		border-radius: 999px;
		background: #0a84ff;
		color: #fff;
		font-size: 0.7rem;
		font-weight: 700;
		line-height: 1.15rem;
		text-align: center;
		vertical-align: super;
		cursor: pointer;
	}
	/* Shiki emits light colors inline + dark variants as CSS variables. */
	@media (prefers-color-scheme: dark) {
		.rendered :global(mark.ccez-ann) {
			background: #5c4d00;
		}
		.folded-preview {
			color: #98989f;
		}
		.rendered :global(pre),
		.rendered :global(:not(pre) > code) {
			background: #1c1c1e;
		}
		.rendered :global(th),
		.rendered :global(td) {
			border-color: #48484a;
		}
		.rendered :global(blockquote) {
			border-color: #48484a;
			color: #98989f;
		}
		.rendered :global(.ccez-code) {
			border-color: #38383a;
		}
		.rendered :global(.ccez-code-head) {
			background: #2c2c2e;
		}
		.rendered :global(.ccez-code-head button) {
			background: #1c1c1e;
			border-color: #48484a;
			color: #f2f2f7;
		}
		.rendered :global(.ccez-code pre) {
			background: #101013;
		}
		.rendered :global(.shiki),
		.rendered :global(.shiki span) {
			color: var(--shiki-dark) !important;
			background-color: var(--shiki-dark-bg) !important;
			font-style: var(--shiki-dark-font-style) !important;
			font-weight: var(--shiki-dark-font-weight) !important;
			text-decoration: var(--shiki-dark-text-decoration) !important;
		}
	}
</style>
