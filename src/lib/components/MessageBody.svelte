<script lang="ts">
	import {
		renderMessage,
		renderMarkdown,
		highlightRendered,
		type RenderedMessage
	} from "$lib/render";
	import type { ChatMsg } from "$lib/chat";

	interface Props {
		message: ChatMsg;
		/** True while this message's reply is still streaming in. */
		streaming: boolean;
		/** True when the user asked for sources (keeps Sources sections). */
		sourcesWanted: boolean;
		/** Whole-message fold state (owned by the parent). */
		folded: boolean;
	}

	let { message, streaming, sourcesWanted, folded }: Props = $props();

	let html = $state("");
	let rendered: RenderedMessage | null = null;
	let highlightRun = 0;

	$effect(() => {
		const content = message.content;
		const snapshot: RenderedMessage =
			message.role === "assistant"
				? renderMessage(content, sourcesWanted)
				: renderMarkdown(content);
		rendered = snapshot;
		html = snapshot.html;
		if (!streaming && snapshot.codes.length > 0) {
			const run = ++highlightRun;
			void highlightRendered(snapshot).then((enhanced) => {
				if (run === highlightRun) html = enhanced;
			});
		}
	});

	function onBodyClick(event: MouseEvent): void {
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
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- html is DOMPurify-sanitized in render.ts -->
	<div class="rendered" onclick={onBodyClick}>{@html html}</div>
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
	/* Shiki emits light colors inline + dark variants as CSS variables. */
	@media (prefers-color-scheme: dark) {
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
