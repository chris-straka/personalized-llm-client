<script lang="ts">
	import { tick, untrack } from "svelte";
	import { createAidLoadingReporter, furiganaRequestKey } from "$lib/aidLoading";
	import { detectScripts, localAidsFor, type LocalAid } from "$lib/reading";
	import { pinyinBlock, plainParagraphs } from "$lib/pinyin";
	import { dualAidHtml, furiganaHtml } from "$lib/furigana";
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
	import { applyMarks, annRefsFor, type AnnotationMark, type AnnotationId } from "$lib/annotations";

	interface Props {
		message: ChatMsg;
		/** True while this message's reply is still streaming in. */
		streaming: boolean;
		/** True when the user asked for sources (keeps Sources sections). */
		sourcesWanted: boolean;
		/** Whole-message fold state (owned by the parent). */
		folded: boolean;
		/**
		 * Folded-preview text override: refs-only messages preview their
		 * quotes (the stored content is just the baked block). Null keeps
		 * the content's first line.
		 */
		foldPreview?: string | null;
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
		 * Per-message aid overrides: pinned or hover-peeked local aids
		 * render them (both at once on mixed messages, each on its own
		 * lines); empty renders the original (aids are per-message only).
		 */
		aidKinds?: LocalAid[] | undefined;
		/**
		 * The chat reply pill's local aid: kanji-only lines (Han, no
		 * kana) belong to it instead of defaulting to pinyin. Null
		 * keeps the script-only default.
		 */
		aidPreferred?: LocalAid | null;
		/** Reports furigana dictionary loads so the button can show it. */
		onAidLoadingChange?: (loading: boolean) => void;
		/**
		 * Furigana conversion failed (worker or dictionary): the caller
		 * releases the pin so the button falls back to the aid name instead
		 * of a "show original" with nothing applied. Carries the short
		 * failure reason for the toast — swallowed errors can't be fixed.
		 */
		onAidError?: (id: ChatMsgId, reason?: string) => void;
		/** Model-aid text replacing the message body when present. */
		textOverride?: string | null;
		/**
		 * Pre-redacted body (sent-message annotation blocks collapsed to
		 * a count pill by the parent): renders instead of the stored
		 * content, paste folds included. Never affects aid mode.
		 */
		contentOverride?: string | null;
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
		foldPreview = null,
		marks = [],
		washId = null,
		onBadgeClick,
		onFoldToggle,
		onBadgeHover,
		textOverride = null,
		contentOverride = null,
		aidPreview = false,
		aidKinds = undefined,
		aidPreferred = null,
		onAidLoadingChange,
		onAidError
	}: Props = $props();

	let html = $state("");
	let bodyEl: HTMLElement | undefined = $state();
	let rendered: RenderedMessage | null = null;
	let highlightRun = 0;
	let aidRun = 0;
	/**
	 * Key of the furigana conversion whose ruby is shown (or loading).
	 * Spurious re-runs (new marks array, new callback identity from the
	 * parent) carry the same key: they re-stamp, never reconvert, so
	 * completion's busy-false can't restart the work it just finished.
	 */
	let furiganaKey: string | null = null;
	/**
	 * Parent busy reports, deduplicated: completion must not bounce the
	 * parent when nothing changed, or its re-render restarts this effect.
	 * Callbacks go through untrack so their per-render identities never
	 * subscribe the effect either.
	 */
	const reportAidLoading = createAidLoadingReporter((loading: boolean) => {
		untrack(() => onAidLoadingChange)?.(loading);
	});
	/**
	 * Aid mode drives the swap animation key: it changes only when aids
	 * turn on/off (never per token while streaming), so each transition
	 * fades exactly once. Local kinds render independently — one, the
	 * other, or both on mixed messages.
	 */
	const aidKindList = $derived(aidKinds ?? []);
	/** Displayed text: contentOverride redacts baked annotation blocks,
	which are metadata, never prose. Paste-fold offsets still apply —
	redaction only ever trims the trailing block, so prefix offsets hold. */
	const displayBase = $derived(contentOverride ?? message.content);
	/** Aid-visible text: the baked block stripped even when unfolded for
	reading (an unfolded refs-only message shows its block, but aids
	still ignore metadata — matching the row's buttons, which key off
	the same redacted text). Model-aid text (e.g. tashkeel) composes
	with local kinds: ruby lands on the shown text, so the base follows
	the override when one is pinned. */
	const aidBase = $derived(
		annRefsFor(textOverride ?? displayBase)?.text ?? (textOverride ?? displayBase)
	);
	/** Scripts with a local aid always reserve ruby's vertical room, so
	hovering or pinning one never shoves the message down — any script
	in the text counts, not just the first, since each kind renders its
	own lines. Keyed off the aid-visible text, so hidden refs can't
	reserve room (or grow history). */
	const aidSpace = $derived(localAidsFor(detectScripts(aidBase)).length > 0);

	$effect(() => {
		// Paste folds splice before render (reading aids keep full text).
		// A redacted body renders with folds like the stored one: fold
		// ranges only ever shrink, and out-of-range folds are ignored.
		const plainBase = displayBase;
		const content = textOverride ?? applyPasteFolds(plainBase, message.pasteFolds);
		// Read synchronously so the effect re-runs when badges change.
		const items = marks;
		const wash = washId;
		const skipMarks = streaming || folded;
		// Aids render from raw text (markdown set aside); model-aid text
		// (e.g. tashkeel) arrives via textOverride and composes with
		// pinned local kinds, each rendering its own lines onto it.
		const localAids = !streaming && aidKindList.length > 0 ? aidKindList : [];
		const furigana = localAids.includes("furigana");
		const pinyin = localAids.includes("pinyin");
		// Marks apply after Svelte flushes the new HTML (see applyMarks).
		const stamp = () => void tick().then(() => bodyEl && applyMarks(bodyEl, items, skipMarks, wash));
		if (pinyin && !furigana) {
			rendered = null;
			furiganaKey = null;
			reportAidLoading(false);
			// Ruby lands on visible runs only; folded-away text stays bare.
			// Aid-visible text only, so a pinned aid can't resurrect the
			// redacted refs block.
			html = foldSegments(aidBase, message.pasteFolds)
				.map((segment) =>
					segment.kind === "text"
						? plainParagraphs(pinyinBlock(segment.text, aidPreferred), segment.text)
						: pasteFoldButton(segment.index, segment.chars)
				)
				.join("");
			stamp();
			return;
		}
		if (furigana) {
			rendered = null;
			// The kinds join the key: furigana-only and dual share text
			// and folds but render differently, so switching between them
			// must reconvert, never replay the other's HTML.
			const key = furiganaRequestKey(`${[...localAids].sort().join("+")}\n${aidBase}`, message.pasteFolds);
			if (key === furiganaKey) {
				// Same conversion already shown or loading: badges may
				// have changed, so re-stamp, but never reconvert and
				// never touch parent busy state.
				stamp();
				return;
			}
			furiganaKey = key;
			reportAidLoading(true);
			const run = ++aidRun;
			const segments = foldSegments(aidBase, message.pasteFolds);
			const convert = (text: string): Promise<string> =>
				pinyin && furigana ? dualAidHtml(text, aidPreferred) : furiganaHtml(text, aidPreferred);
			void Promise.all(
				segments.map((segment) =>
					segment.kind === "text"
						? convert(segment.text)
						: Promise.resolve(pasteFoldButton(segment.index, segment.chars))
				)
			)
				.then(
					(parts) => {
						if (run !== aidRun) return;
						html = parts.join("");
						stamp();
					},
					(error: unknown) => {
						// Conversion failed: unpin via the caller. The
						// two-arg form keeps stamp() errors out of here.
						// Async reads never subscribe the effect, so the
						// callback identity is safe to touch here.
						if (run !== aidRun) return;
						console.warn("[furigana] conversion failed:", error);
						const first =
							error instanceof Error ? error.message.split("\n")[0] : String(error);
						onAidError?.(message.id, (first ?? "").slice(0, 140) || undefined);
					}
				)
				.finally(() => {
					if (run === aidRun) reportAidLoading(false);
				});
			return;
		}
		if (furiganaKey !== null) furiganaKey = null;
		reportAidLoading(false);
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
	/**
	 * Null washes already reported: mouseovers fire for every child
	 * under the cursor, so re-reporting null while pointed at plain
	 * text bounced the parent (and every body) for nothing — hovering
	 * near the pinyin button flickered mounted marks. Non-null ids
	 * always report: suppressing a repeat could strand a wash the
	 * parent cleared another way. Starts sent: the parent opens null.
	 */
	let hoverNullSent = true;
	function onBadgeOver(event: MouseEvent): void {
		const id = badgeIdOf(event.target);
		if (id === null) {
			if (hoverNullSent) return;
			hoverNullSent = true;
		} else hoverNullSent = false;
		onBadgeHover?.(id);
	}

	function onBadgeOut(event: MouseEvent): void {
		const to = (event.relatedTarget as HTMLElement | null)?.closest?.("[data-ann-badge]");
		if (to) return;
		if (hoverNullSent) return;
		hoverNullSent = true;
		onBadgeHover?.(null);
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
			if (!navigator.clipboard) report(false);
			else void navigator.clipboard.writeText(entry.code).then(
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
	<div class="folded-preview">{foldPreview ?? (message.content.split("\n")[0] ?? "").slice(0, 140)}</div>
{:else}
	<!-- Delegated code fold/copy buttons live inside the sanitized HTML. -->
	<!-- The key swaps only for pinned model-aid text: previews and local
	ruby render in place (readings fading in) so hovering never flashes
	the body or moves the row. -->
	{#key textOverride && !aidPreview ? "model" : "plain"}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_mouse_events_have_key_events -->
		<!-- Badge wash is hover-only by decision (see onBadgeOver): Tab reaches markers, never highlights. -->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- html is DOMPurify-sanitized in render.ts -->
		<div class="rendered aid-swap" class:aid-space={aidSpace} bind:this={bodyEl} onclick={onBodyClick} onmouseover={onBadgeOver} onmouseout={onBadgeOut}>{@html html}</div>
	{/key}
{/if}

<style>
	.rendered {
		word-break: break-word;
		font-size: calc(0.92rem * var(--font-scale, 1));
		line-height: 1.5;
		/* The one selectable surface in the article (see article's
		user-select: none): I-beam lives here and only here. */
		user-select: text;
		-webkit-user-select: text;
		cursor: text;
	}
	.folded-preview {
		color: #6e6e73;
		font-size: 0.85rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* Injected paste-fold marker (sanitized HTML): inline bold text in
	badge blue, never a pill — still a button, so it clicks to expand. */
	.rendered :global(button.paste-fold) {
		font: inherit;
		font-weight: 700;
		color: #5a9bf7;
		background: none;
		border: 0;
		padding: 0;
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
	so previewing or pinning it never reflows the message — but only on
	blocks that can actually carry ruby (marked cjk at render, including
	list items now that aids keep list structure). An English paragraph
	in a mixed message keeps its normal leading, so its selection
	highlight hugs the text instead of spanning the ruby void above.
	WebKit sizes in-flow ruby annotations by glyphs (no line-height
	trick contains them), so the reservation itself must cover base
	plus annotation: 2.7 swallows the measured overhang with headroom
	for other stacks. */
	.rendered.aid-space :global(p.cjk),
	.rendered.aid-space :global(li.cjk) {
		line-height: 2.7;
		/* pretty rebalances CJK lines short and uneven across
		paragraphs (kinsoku + ruby spans confuse it): fill the column
		with plain wrapping like before. */
		text-wrap: auto;
	}
	.rendered.aid-space :global(p.cjk) {
		/* Tall lines swallow the base 0.4em gap, so CJK paragraphs get
		a fuller break plus the standard 1em first-line indent (字下げ):
		three paragraphs read as three even before ruby loads. */
		margin: 0.9em 0;
		text-indent: 1em;
	}
	.rendered.aid-space :global(p.cjk:last-child) {
		/* The break belongs between paragraphs, not between the last
		line and the action row (outranks the rule above). */
		margin-bottom: 0;
	}
	/* The native selection callout stays enabled over message text:
	Apple gives apps no way to extend it, so our Annotate button
	floats above the highlight while the system bubble (Copy /
	Translate) keeps its below slot. Selection itself is unaffected:
	handles, drags, and JS ranges all still work. */
	/* Reading base: inline span, breaking between tokens exactly like
	unannotated text in every engine (native ruby reserves the
	annotation's width per base — and WebKit ignores out-of-flow
	positioning on rt entirely — pushing characters down a line).
	Relative only as the positioning context for its reading. */
	.rendered :global(.frb) {
		position: relative;
		/* Atomic: a multi-kanji base must never fragment across a line
		break — an absolutely positioned reading centers against the
		fragmented box and lands shifted right of its kanji. Whole
		tokens wrap to the next line instead. */
		white-space: nowrap;
	}
	/* Readings are overlay, never layout: absolutely positioned above
	the base, centered, painting into the aid-space leading reserved
	on cjk paragraphs — vertical rhythm unchanged, breaking matches
	plain text exactly, and quote extraction strips them as before. */
	.rendered :global(.frt) {
		position: absolute;
		bottom: 100%;
		left: 50%;
		transform: translateX(-50%);
		/* Optical: readings sit right of their kanji, so pull back
		two pixels (absolute, never layout). */
		margin-left: -2px;
		white-space: nowrap;
		font-size: 0.62em;
		line-height: 1.2;
		color: #6e6e73;
		color: var(--muted);
		pointer-events: none;
	}
	/* Entrance fade everywhere except iOS, where it breaks the reveal
	(visible flicker/shift). .app carries data-ios, outside this
	component, hence the leading :global. */
	:global(.app:not([data-ios])) .rendered :global(.frt) {
		animation: frt-in 0.18s ease;
	}
	/* Per-platform nudge: kana bearings differ per OS font (Hiragino
	on iOS needs a stronger pull than desktop). Scoped so each
	platform keeps its own tuned value — Android gets its line here
	once it's eyeballed on-device. */
	:global(.app[data-ios]) .rendered :global(.frt) {
		margin-left: -8px;
	}
	/* Same leftward pull on Android (eyeballed on-device to match
	iOS). data-android is also set on iPhones (any phone), so iOS
	is excluded — it keeps its own line above. */
	:global(.app[data-android]:not([data-ios])) .rendered :global(.frt) {
		margin-left: -8px;
	}
	@keyframes frt-in {
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
		animation: ann-wash-in 0.12s ease;
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
	/* Reading-aid text is overlay, not content: never selectable,
	so it stays out of selections and selection-copies. */
	.rendered :global(.frt) {
		user-select: none;
		-webkit-user-select: none;
	}
	/* Pinyin rides native ruby instead of overlay spans: the engine
	expands each base to fit its own annotation exactly, so space
	appears only where a reading overflows its Hanzi — neighbors never
	collide and fitting readings cost nothing. (Furigana keeps overlay
	spans: kana readings fit their bases, and overlay keeps them out of
	layout and selection entirely.) */
	.rendered :global(ruby) {
		ruby-align: center;
	}
	.rendered :global(rt) {
		font-size: 0.62em;
		/* Zero strut: the annotation's line box contributes nothing, so
		no engine grows the line for it — glyphs paint into the
		aid-space leading reserved above. No entrance fade: it read as
		flicker on reveal. (iOS 26.5 sizes the annotation by glyphs past
		the zero strut and clears the reservation by ~1px anyway — the
		iOS override below fits it back. Pinning then moves nothing.) */
		line-height: 0;
		color: #6e6e73;
		color: var(--muted);
		/* Keeps readings out of drag-select copies on engines that
		honor it (Chromium); the Copy button reads message source, so
		it never sees readings either way. */
		user-select: none;
		-webkit-user-select: none;
	}
	/* Per-platform fit: iOS WebKit sizes in-flow ruby annotations by
	glyphs, and at 0.62em their extents clear the 2.7 aid-space strut
	by ~1px — pinning grows the line and drops the base, the buttons,
	and everything below (measured +1px block / +1px base on iPhone
	WebKit 26.5, zero on desktop). 0.6em fits the tallest stacks
	(nǚ lǜ zhuāng chuāng) with the rightward spread untouched;
	desktop and Android keep 0.62 (Android gets its line here once
	it's eyeballed on-device). */
	:global(.app[data-ios]) .rendered :global(rt) {
		font-size: 0.6em;
	}
	/* Badge anchors ride on the quote's last character (or its wash
	mark): unstyled inline wrappers, so stamping never reflows text. */
	.rendered :global(.ccez-ann-anchor) {
		position: relative;
	}
	/* Numbered badges float above-right of their quote, overlaying ruby
	readings instead of shoving them: zero layout in every mode. */
	.rendered :global(button.ccez-ann-badge) {
		position: absolute;
		bottom: 100%;
		left: 100%;
		transform: translate(-40%, 10%);
		z-index: 2;
		user-select: none;
		-webkit-user-select: none;
		min-width: 1.15rem;
		height: 1.15rem;
		padding: 0 0.25rem;
		border: 0;
		border-radius: 999px;
		background: #5a9bf7;
		color: #fff;
		font-size: 0.7rem;
		font-weight: 700;
		line-height: 1.15rem;
		text-align: center;
		white-space: nowrap;
		cursor: pointer;
	}
	/* Speech-bubble tail: a slash leaning down-left toward the quote
	it annotates — tip at the bottom-left corner, wide top tucked 5px
	under the badge (same color, so the join can never gap — the circle
	curves away at the sides, which is why the tail seats left of
	center instead of off the rim). Clicks land on the button, so the
	open still works. */
	.rendered :global(button.ccez-ann-badge::after) {
		content: "";
		position: absolute;
		top: calc(100% - 5px);
		left: 14%;
		width: 0.5rem;
		height: 0.72rem;
		background: inherit;
		clip-path: polygon(38% 0, 100% 0, 0 100%);
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
	/* Dark theme, gated on the resolved scheme (<html data-theme>)
	instead of the OS query, so the settings switch can pin it.
	Keyframes can't sit behind a selector, so the dark wash variants
	are renamed and picked up by the animation-name overrides below. */
	:global(html[data-theme="dark"]) .rendered :global(mark.ccez-ann) {
		background: #5c4d00;
	}
	@keyframes ann-wash-in-dark {
		from {
			background-color: transparent;
		}
		to {
			background-color: #5c4d00;
		}
	}
	@keyframes ann-wash-out-dark {
		from {
			background-color: #5c4d00;
		}
		to {
			background-color: transparent;
		}
	}
	:global(html[data-theme="dark"]) .rendered :global(mark.ccez-ann.fresh) {
		animation-name: ann-wash-in-dark;
	}
	:global(html[data-theme="dark"]) .rendered :global(mark.ccez-ann.leaving) {
		animation-name: ann-wash-out-dark;
	}
	:global(html[data-theme="dark"]) .folded-preview {
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .rendered :global(pre),
	:global(html[data-theme="dark"]) :global(html[data-theme="dark"]) .rendered :global(:not(pre) > code) {
		background: #1c1c1e;
	}
	:global(html[data-theme="dark"]) .rendered :global(th),
	:global(html[data-theme="dark"]) :global(html[data-theme="dark"]) .rendered :global(td) {
		border-color: #48484a;
	}
	:global(html[data-theme="dark"]) .rendered :global(blockquote) {
		border-color: #48484a;
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .rendered :global(.ccez-code) {
		border-color: #38383a;
	}
	:global(html[data-theme="dark"]) .rendered :global(.ccez-code-head) {
		background: #2c2c2e;
	}
	:global(html[data-theme="dark"]) .rendered :global(.ccez-code-head button) {
		background: #1c1c1e;
		border-color: #48484a;
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .rendered :global(.ccez-code pre) {
		background: #101013;
	}
	:global(html[data-theme="dark"]) .rendered :global(.shiki),
	:global(html[data-theme="dark"]) :global(html[data-theme="dark"]) .rendered :global(.shiki span) {
		color: var(--shiki-dark) !important;
		background-color: var(--shiki-dark-bg) !important;
		font-style: var(--shiki-dark-font-style) !important;
		font-weight: var(--shiki-dark-font-weight) !important;
		text-decoration: var(--shiki-dark-text-decoration) !important;
	}
</style>
