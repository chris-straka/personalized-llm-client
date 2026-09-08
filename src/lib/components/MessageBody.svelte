<script lang="ts">
	import { tick } from "svelte";
	import { detectScript, localAidFor, type LocalAid } from "$lib/reading";
	import { pinyinRuby, plainParagraphs } from "$lib/pinyin";
	import { furiganaHtml } from "$lib/furigana";
	import {
		renderMessage,
		renderMarkdown,
		applyPasteFolds,
		foldSegments,
		pasteFoldButton,
		highlightRendered,
		type RenderedMessage
	} from "$lib/render";
	import type { ChatMsg, ChatMsgId } from "$lib/chat";
	import { applyMarks, type AnnotationMark, type AnnotationId } from "$lib/annotations";

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
		/**
		 * The one annotation (by id) whose quote also gets the yellow wash:
		 * the annotation whose comment box is currently open. Saved
		 * annotations keep their numbered badge but no wash, so finishing
		 * one clears its highlight instead of leaving it painted on.
		 */
		washId?: string | null;
		/** Badge click (opens the edit popover at the badge). */
		onBadgeClick?: (id: AnnotationId, anchor: { x: number; y: number }) => void;
		/** Paste-fold marker click (parent replaces the message). */
		onFoldToggle?: (index: number) => void;
	/** Badge hover (paints the quote wash while pointed at). Null on leave. */
	onBadgeHover?: (id: string | null) => void;
		/**
		 * Per-message aid override: a pinned or hover-peeked aid renders it,
		 * otherwise the original stands (aids are per-message only).
		 */
		aidOverride?: LocalAid | null | undefined;
		/** Reports furigana dictionary loads so the button can show it. */
		onAidLoadingChange?: (loading: boolean) => void;
		/**
		 * Furigana conversion failed (worker or dictionary): the caller
		 * releases the pin so the button falls back to the aid name instead
		 * of a "show original" with nothing applied.
		 */
		onAidError?: (id: ChatMsgId) => void;
		/** Model-aid text replacing the message body when present. */
		textOverride?: string | null;
		/**
		 * True when textOverride is a hover preview rather than a pin:
		 * render it in place with no remount, so peeking can't flash the
		 * body or shift the row out from under a stationary cursor (which
		 * left :hover paint stuck on assistant rows).
		 */
		aidPreview?: boolean;
	}

	let {
		message,
		streaming,
		sourcesWanted,
		folded,
		marks = [],
		washId = null,
		onBadgeClick,
		onFoldToggle,
		onBadgeHover,
		textOverride = null,
		aidPreview = false,
		aidOverride = undefined,
		onAidLoadingChange,
		onAidError
	}: Props = $props();

	let html = $state("");
	let bodyEl: HTMLElement | undefined = $state();
	let rendered: RenderedMessage | null = null;
	let highlightRun = 0;
	let aidRun = 0;
	/**
	 * Aid mode drives the swap animation key: it changes only when the aid
	 * turns on/off (never per token while streaming), so each transition
	 * fades exactly once.
	 */
	const aidMode = $derived<"model" | LocalAid | "none">(
		textOverride
			? "model"
			: !streaming
				? (aidOverride ?? "none")
				: "none"
	);
	/** Scripts with a local aid always reserve ruby's vertical room, so
	hovering or pinning it never shoves the message down. */
	const aidSpace = $derived(localAidFor(detectScript(message.content)) !== null);

	$effect(() => {
		// Paste folds splice before render (reading aids keep full text).
		const content = textOverride ?? applyPasteFolds(message.content, message.pasteFolds);
		// Read synchronously so the effect re-runs when badges change.
		const items = marks;
		const wash = washId;
		const skipMarks = streaming || folded;
		// Aids render from raw text (markdown set aside); model-aid text
		// (e.g. tashkeel) arrives via textOverride and takes the normal path.
		// Arabic has no local aid: its model-aid button lives in the
		// message actions, and the body renders identically either way.
		const localAid = aidMode === "model" || aidMode === "none" ? null : aidMode;
		// Marks apply after Svelte flushes the new HTML (see applyMarks).
		const stamp = () => void tick().then(() => bodyEl && applyMarks(bodyEl, items, skipMarks, wash));
		if (localAid === "pinyin") {
			rendered = null;
			onAidLoadingChange?.(false);
			// Ruby lands on visible runs only; folded-away text stays bare.
			html = foldSegments(message.content, message.pasteFolds)
				.map((segment) =>
					segment.kind === "text"
						? plainParagraphs(pinyinRuby(segment.text))
						: pasteFoldButton(segment.index, segment.chars)
				)
				.join("");
			stamp();
			return;
		}
		if (localAid === "furigana") {
			rendered = null;
			onAidLoadingChange?.(true);
			const run = ++aidRun;
			const segments = foldSegments(message.content, message.pasteFolds);
			void Promise.all(
				segments.map((segment) =>
					segment.kind === "text"
						? furiganaHtml(segment.text)
						: Promise.resolve(pasteFoldButton(segment.index, segment.chars))
				)
			)
				.then(
					(parts) => {
						if (run !== aidRun) return;
						html = parts.join("");
						stamp();
					},
					() => {
						// Conversion failed: unpin via the caller. The
						// two-arg form keeps stamp() errors out of here.
						if (run === aidRun) onAidError?.(message.id);
					}
				)
				.finally(() => {
					if (run === aidRun) onAidLoadingChange?.(false);
				});
			return;
		}
		onAidLoadingChange?.(false);
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

	function badgeIdOf(target: EventTarget | null): string | null {
		const badge = (target as HTMLElement | null)?.closest?.("[data-ann-badge]");
		return badge instanceof HTMLElement ? (badge.dataset.annBadge ?? null) : null;
	}

	/**
	 * Hovering a badge previews its yellow wash. Keyboard focus stays
	 * wash-free on purpose: Tab reaches the markers, never the highlights.
	 */
	function onBadgeOver(event: MouseEvent): void {
		onBadgeHover?.(badgeIdOf(event.target));
	}

	function onBadgeOut(event: MouseEvent): void {
		const to = (event.relatedTarget as HTMLElement | null)?.closest?.("[data-ann-badge]");
		if (!to) onBadgeHover?.(null);
	}

	function onBodyClick(event: MouseEvent): void {
		const badge = (event.target as HTMLElement).closest<HTMLElement>("[data-ann-badge]");
		if (badge) {
			const rect = badge.getBoundingClientRect();
			// Stamped from AnnotationMark ids (applyMarks); dataset erases
			// the brand, so cast it back at this boundary.
			onBadgeClick?.((badge.dataset.annBadge ?? "") as AnnotationId, {
				x: rect.left + rect.width / 2,
				y: rect.bottom
			});
			return;
		}
		const fold = (event.target as HTMLElement).closest<HTMLElement>("[data-paste-fold]");
		if (fold) {
			onFoldToggle?.(Number(fold.dataset.pasteFold ?? -1));
			return;
		}
		const button = (event.target as HTMLElement).closest<HTMLElement>("[data-code-action]");
		if (!button || !rendered) return;
		const block = button.closest<HTMLElement>(".ccez-code");
		const index = Number(block?.dataset.codeIndex ?? -1);
		const entry = rendered.codes[index];
		if (!entry) return;
		if (button.dataset.codeAction === "copy") {
			// No toast down here: the button itself reports the outcome,
			// restoring its label after a beat (harmless on a detached
			// node if the body re-renders meanwhile).
			const label = button.textContent ?? "Copy";
			const restore = () => {
				button.textContent = label;
			};
			const report = (ok: boolean) => {
				button.textContent = ok ? "Copied" : "Copy failed";
				setTimeout(restore, 1500);
			};
			const done = navigator.clipboard?.writeText(entry.code);
			if (!done) report(false);
			else void done.then(
				() => report(true),
				() => report(false)
			);
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
	<div class="folded-preview">{(message.content.split("\n")[0] ?? "").slice(0, 140)}</div>
{:else}
	<!-- Delegated code fold/copy buttons live inside the sanitized HTML. -->
	<!-- The key swaps only for pinned model-aid text: previews and local
	ruby render in place (readings fading in) so hovering never flashes
	the body or moves the row. -->
	{#key textOverride && !aidPreview ? "model" : "plain"}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- html is DOMPurify-sanitized in render.ts -->
		<div class="rendered aid-swap" class:aid-space={aidSpace} bind:this={bodyEl} onclick={onBodyClick} onmouseover={onBadgeOver} onmouseout={onBadgeOut}>{@html html}</div>
	{/key}
{/if}

<style>
	.rendered {
		word-break: break-word;
		font-size: calc(0.92rem * var(--font-scale, 1));
		line-height: 1.5;
	}
	.folded-preview {
		color: #6e6e73;
		font-size: 0.85rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* Injected paste-fold marker (sanitized HTML): same line, pill button. */
	.rendered :global(button.paste-fold) {
		font: inherit;
		color: inherit;
		background: transparent;
		border: 1px solid currentColor;
		border-radius: 999px;
		padding: 0 0.6rem;
		cursor: pointer;
	}
	/* Aid swaps fade the incoming body in, and fresh readings fade in
	where they land: the model key remounts on tashkeel flips, while
	local ruby renders in place so the base text never flashes. */
	@keyframes aid-swap {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.rendered.aid-swap {
		animation: aid-swap 0.18s ease;
	}
	/* Ruby's vertical room is always reserved where a local aid exists,
	so previewing or pinning it never reflows the message. The 2.3
	covers the base line plus the ruby overhang with headroom: 2.25
	left a ~0.5px leak on some font stacks. */
	.rendered.aid-space :global(p) {
		line-height: 2.3;
	}
	.rendered :global(ruby) {
		ruby-align: center;
	}
	.rendered :global(rt) {
		font-size: 0.62em;
		/* Unit line-height: the annotation must fit inside the reserved
		leading or ruby grows the line box and shoves the message down. */
		line-height: 1;
		color: #6e6e73;
		animation: rt-in 0.18s ease;
	}
	@keyframes rt-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
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
	.rendered :global(pre),
	.rendered :global(code) {
		font-family:
			"Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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
		/* 1px of visual bleed each side, paid back with negative margin
		so the wash never reflows the line when it appears. */
		padding: 0 1px;
		margin: 0 -1px;
		color: inherit;
	}
	/* The wash mounts/unmounts imperatively (applyMarks), so a plain
	transition has nothing to run between: fade-in plays on mount for
	newly arrived washes only, and fade-out plays on .leaving marks
	that applyMarks unwraps after WASH_FADE_MS. */
	@keyframes ann-wash-in {
		from {
			background-color: transparent;
		}
		to {
			background-color: #fff3b0;
		}
	}
	.rendered :global(mark.ccez-ann.fresh) {
		animation: ann-wash-in 0.18s ease;
	}
	@keyframes ann-wash-out {
		from {
			background-color: #fff3b0;
		}
		to {
			background-color: transparent;
		}
	}
	.rendered :global(mark.ccez-ann.leaving) {
		animation: ann-wash-out 0.18s ease forwards;
	}
	/* Reading-aid ruby text is overlay, not content: never selectable,
	so it stays out of selections and selection-copies. */
	.rendered :global(ruby rt),
	.rendered :global(ruby rp) {
		user-select: none;
		-webkit-user-select: none;
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
	/* Newly stamped badges fade in; re-stamps skip the class so steady
	marks never flicker on re-render. */
	@keyframes ann-badge-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	.rendered :global(button.ccez-ann-badge.fresh) {
		animation: ann-badge-in 0.2s ease;
	}
	/* Shiki emits light colors inline + dark variants as CSS variables. */
	@media (prefers-color-scheme: dark) {
		.rendered :global(mark.ccez-ann) {
			background: #5c4d00;
		}
		/* Dark variants of the wash fades (media-scoped keyframes win
		while the query matches). */
		@keyframes ann-wash-in {
			from {
				background-color: transparent;
			}
			to {
				background-color: #5c4d00;
			}
		}
		@keyframes ann-wash-out {
			from {
				background-color: #5c4d00;
			}
			to {
				background-color: transparent;
			}
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
