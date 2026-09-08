/**
 * Annotation: a quoted selection from a message plus an optional comment,
 * wrapped into the next query. Composer-scoped (like attachments): sending
 * bakes them into the message text, so they are never persisted separately.
 */
import type { ChatMsgId } from "./chat";

/** Opaque annotation identifier (see ChatId/ChatMsgId in chat.ts). */
export type AnnotationId = string & { readonly kind: "annotation" };

export interface Annotation {
	id: AnnotationId;
	/** Message the selection came from (drives badge placement). */
	messageId: ChatMsgId;
	quote: string;
	comment: string;
}

export function newAnnotationId(): AnnotationId {
	return crypto.randomUUID() as AnnotationId;
}

export function addAnnotation(
	list: Annotation[],
	messageId: ChatMsgId,
	quote: string,
	comment = ""
): Annotation[] {
	const trimmed = quote.trim();
	if (!trimmed) return list;
	return [...list, { id: newAnnotationId(), messageId, quote: trimmed, comment }];
}

export function editAnnotationComment(
	list: Annotation[],
	id: string,
	comment: string
): Annotation[] {
	return list.map((a) => (a.id === id ? { ...a, comment } : a));
}

export function deleteAnnotation(list: Annotation[], id: string): Annotation[] {
	return list.filter((a) => a.id !== id);
}

export function clearAnnotations(): Annotation[] {
	return [];
}

/** 1-based badge number of an annotation within the composer list. */
export function annotationNumber(list: Annotation[], id: AnnotationId): number {
	return list.findIndex((a) => a.id === id) + 1;
}

/**
 * Single-character typographic folds so quotes match across markdown
 * reshaping (straight quotes typed by the user vs curly quotes rendered).
 * Same-length replacements keep node offsets aligned.
 */
const TYPO_FOLD: Record<string, string> = {
	"“": '"',
	"”": '"',
	"‘": "'",
	"’": "'",
	"–": "-",
	"—": "-",
	"…": "."
};

function foldChar(ch: string): string {
	return TYPO_FOLD[ch] ?? ch;
}

/** Strip ALL whitespace for matching: selections and DOM text nodes routinely
 * disagree on newlines/indentation (full-paragraph and multi-line quotes). */
function stripForMatch(text: string): { stripped: string; offsets: number[] } {
	let stripped = "";
	const offsets: number[] = [];
	for (let i = 0; i < text.length; i++) {
		const ch = foldChar(text[i] ?? "");
		if (/\s/.test(ch)) continue;
		offsets.push(i);
		stripped += ch;
	}
	return { stripped, offsets };
}

export interface QuoteLocation {
	startNode: number;
	startOffset: number;
	endNode: number;
	/** Exclusive end offset within endNode. */
	endOffset: number;
}

/**
 * Locate a quote across rendered text nodes (pure: takes node texts, no DOM).
 * Whitespace-insensitive on both sides, so quotes spanning element
 * boundaries, block breaks, or reshaped punctuation still match. Returns null
 * when the quote isn't contained in these nodes (e.g. cross-message
 * selections stay review-only).
 */
export function locateQuote(nodeTexts: string[], quote: string): QuoteLocation | null {
	const q = stripForMatch(quote);
	if (!q.stripped) return null;
	let hay = "";
	const map: { node: number; offset: number }[] = [];
	nodeTexts.forEach((text, node) => {
		const s = stripForMatch(text);
		for (let i = 0; i < s.stripped.length; i++) {
			const offset = s.offsets[i];
			const ch = s.stripped[i];
			if (offset === undefined || ch === undefined) continue;
			map.push({ node, offset });
			hay += ch;
		}
	});
	const at = hay.indexOf(q.stripped);
	if (at === -1) return null;
	const first = map[at];
	const last = map[at + q.stripped.length - 1];
	if (!first || !last) return null;
	return {
		startNode: first.node,
		startOffset: first.offset,
		endNode: last.node,
		endOffset: last.offset + 1
	};
}

/** Badge to stamp onto a message's quoted span. */
export interface AnnotationMark {
	id: AnnotationId;
	number: number;
	quote: string;
	/**
	 * Preview (unsaved) annotation: washes like a real mark when it is
	 * the open one, but stamps no badge — badges appear on submit only.
	 */
	preview?: boolean;
}

/**
 * Rendered text nodes eligible for quote location. Badge buttons stamped
 * earlier in the same pass are UI chrome, not message text: their number
 * text must stay out of the haystack, or any later quote spanning that
 * position (overlapping or nested selections) stops matching and its
 * badge never appears.
 */
/**
 * Plain text of a cloned selection fragment minus UI chrome and overlay
 * readings: annotation badge numbers would bake into the quote ("Kyoto1
 * in two sentences") and ruby readings would bake in too ("漢かん字じ"
 * for 漢字). Only the base text is content.
 */
export function quoteFragmentText(frag: DocumentFragment): string {
	frag.querySelectorAll("[data-ann-badge], rt, rp").forEach((el) => el.remove());
	return frag.textContent?.trim() ?? "";
}

export function quoteTextNodes(root: Node): Text[] {
	const nodes: Text[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	while (walker.nextNode()) {
		const node = walker.currentNode;
		if (!(node instanceof Text)) continue;
		const parent = node.parentNode;
		// Badge buttons are UI chrome, and ruby readings are overlay:
		// neither is message text. A reading left in the haystack
		// mis-anchors badges (or wraps the reading itself and corrupts
		// the ruby), so both stay out.
		if (parent instanceof Element && parent.closest("[data-ann-badge], rt, rp")) continue;
		nodes.push(node);
	}
	return nodes;
}

/**
 * Prompt badge count for the annotation tracker: the number, capped at
 * 99+ so the badge never stretches the prompt tools.
 */
export function annotationCountLabel(count: number): string {
	return count > 99 ? "99+" : String(count);
}

/**
 * Numbered badge on the first occurrence of each quoted span, plus the
 * yellow wash on the one annotation whose comment box is open. Badges
 * float above-right of their quote on a positioned anchor (never inline,
 * so stamping moves no text and overlays ruby instead of shoving it).
 * Old marks unwrap first so re-renders never accumulate. Quotes that no
 * longer match (edited messages, cross-message selections) stay
 * listed in the review panel without a badge — never an error.
 */
/** Wash fade-out length in ms — mirrors the ann-wash-out keyframes. */
export const WASH_FADE_MS = 180;

export function applyMarks(
	root: Element,
	items: AnnotationMark[],
	skip: boolean,
	wash: string | null
): void {
	// Ids already on screen: re-stamping them (every render unwraps and
	// re-locates) must not replay the mount fade — only new badges are fresh.
	const settled = new Set(
		[...root.querySelectorAll("[data-ann-badge]")].map((el) =>
			el instanceof HTMLElement ? (el.dataset.annBadge ?? "") : ""
		)
	);
	for (const badge of root.querySelectorAll("[data-ann-badge]")) badge.remove();
	// The wash whose marks are currently mounted ("" when none): a steady
	// wash re-stamps without replaying its fade-in, like settled badges.
	const prevWash = (root as HTMLElement).dataset.washStamped || null;
	// A cleared wash fades out: unwrap now (badges need clean text to
	// anchor beside, never inside, a mark), stamp badges normally, then
	// re-wrap the old range as leaving marks below.
	const fading = !skip && !wash && prevWash ? prevWash : null;
	for (const mark of root.querySelectorAll("mark.ccez-ann")) {
		mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
	}
	// Badge anchors are unstyled inline spans: unwrap them with the
	// marks so re-renders never nest or accumulate them. (Wash marks
	// doubling as anchors are marks, unwrapped above.)
	for (const anchor of root.querySelectorAll("span.ccez-ann-anchor")) {
		anchor.replaceWith(document.createTextNode(anchor.textContent ?? ""));
	}
	// Wrapping splits text nodes and unwrapping never merges them back:
	// without this, every re-stamp fragments the text further and later
	// washes span (and count) fragments instead of quotes.
	root.normalize();
	(root as HTMLElement).dataset.washStamped = wash ?? "";
	if (skip || items.length === 0) return;
	// A newly arrived wash fades in; a steady one re-mounts silently.
	const freshWash = !!wash && wash !== prevWash;
	for (const item of items) {
		// Fresh snapshot per item: the previous wrap splits text nodes,
		// so earlier indices go stale — nested quotes (a sentence and
		// its parts) only locate on the current DOM.
		const nodes = quoteTextNodes(root);
		const texts = nodes.map((n) => n.textContent ?? "");
		const loc = locateQuote(texts, item.quote);
		if (!loc) continue;
		// Preview (unsaved) annotations wash when open but stamp no
		// badge: badges appear on submit only.
		const washed = item.id === wash;
		if (washed) wrapRange(nodes, loc, freshWash ? "fresh" : undefined);
		if (item.preview) continue;
		// Fresh snapshot: the wash wrap above split text nodes, so the
		// badge anchors on the current DOM (same quote, same corner —
		// hovering the wash on and off can never move it).
		const freshNodes = quoteTextNodes(root);
		const freshLoc = locateQuote(
			freshNodes.map((node) => node.textContent ?? ""),
			item.quote
		);
		if (!freshLoc) continue;
		const anchor = anchorSpan(freshNodes, freshLoc);
		if (!anchor) continue;
		const badge = document.createElement("button");
		badge.type = "button";
		badge.className = "ccez-ann-badge";
		if (!settled.has(item.id)) badge.classList.add("fresh");
		badge.dataset.annBadge = item.id;
		badge.textContent = String(item.number);
		badge.title = "Open annotation";
		anchor.append(badge);
	}
	if (fading) {
		// Re-wrap the cleared wash so CSS can ramp it to transparent;
		// unwrap once the fade plays out. Runs in the same task as the
		// unwrap above, so no unwashed frame ever paints. A superseding
		// stamp unwraps these early and the sweep no-ops (replaceWith on
		// a detached node does nothing).
		const gone = items.find((item) => item.id === fading);
		if (gone) {
			const fnodes = quoteTextNodes(root);
			const floc = locateQuote(
				fnodes.map((node) => node.textContent ?? ""),
				gone.quote
			);
			if (floc) {
				wrapRange(fnodes, floc, "leaving");
				const doomed = [...root.querySelectorAll("mark.ccez-ann.leaving")];
				setTimeout(() => {
					for (const mark of doomed) {
						if (mark.classList.contains("leaving")) {
							mark.replaceWith(document.createTextNode(mark.textContent ?? ""));
						}
					}
				}, WASH_FADE_MS);
			}
		}
	}
}

/**
 * Lock a live selection to the message holding its anchor: dragging
 * into another message pulls the focus end back to the anchor message's
 * edge instead of selecting across messages. A focus outside the
 * anchor's prose trims the same way — double-clicking blank space
 * past a line's end otherwise stretches the range into the prompt
 * editor, and the action row caught inside reads back as a phantom
 * quote whose menu lands under the cursor and eats the next click.
 * The walk stays inside the anchor's rendered prose, never the whole
 * article: the action row's text labels (aid names) must not become
 * quote text. Returns true when trimmed. Never throws (selection
 * APIs disagree across engines).
 */
export function lockSelectionToMessage(
	selection: Selection,
	messageOf: (node: Node | null) => Element | null
): boolean {
	try {
		if (selection.isCollapsed || selection.rangeCount === 0) return false;
		const anchorNode = selection.anchorNode;
		const focusNode = selection.focusNode;
		if (!anchorNode || !focusNode) return false;
		const anchorEl = messageOf(anchorNode);
		if (!anchorEl) return false;
		if (messageOf(focusNode) === anchorEl) return false;
		const anchorOffset = selection.anchorOffset;
		// Prose scope, not the article: trimming to the article's end
		// would pin the focus past the action row, baking its button
		// labels into the quote. Outside rendered prose (or tests with
		// bare articles), the article itself stays the scope.
		const prose = (
			anchorNode instanceof Element ? anchorNode : anchorNode.parentElement
		)?.closest(".rendered");
		const walker = document.createTreeWalker(prose ?? anchorEl, NodeFilter.SHOW_TEXT);
		const texts: Text[] = [];
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (node instanceof Text && node.textContent) texts.push(node);
		}
		if (texts.length === 0) return false;
		// Sort by the focus node itself, not its message: a focus
		// outside every message still sits before or after the anchor.
		const order = anchorEl.compareDocumentPosition(focusNode);
		if (order & Node.DOCUMENT_POSITION_FOLLOWING) {
			// Focus ran past the anchor message's end (a later message
			// or the prompt below): pin it to the anchor message's
			// last text.
			const last = texts[texts.length - 1];
			if (!last) return false;
			selection.setBaseAndExtent(anchorNode, anchorOffset, last, last.length);
		} else {
			// Focus ran up past the anchor message's start: pin it to
			// the anchor message's first text.
			const first = texts[0];
			if (!first) return false;
			selection.setBaseAndExtent(anchorNode, anchorOffset, first, 0);
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * Positioned anchor for a badge at its quote's middle: the middle
 * character wrapped in an unstyled span (reused when it already has
 * one, so duplicate quotes keep badge order). Middle placement keeps
 * the badge over what it annotates on long wrapped quotes, where an
 * end anchor can sit lines away from the start. Wash marks never double
 * as anchors — the badge corner stays identical whether the wash is on
 * or off. The badge floats above-right of the anchor in CSS — no text
 * ever moves.
 */
function anchorSpan(nodes: Text[], loc: QuoteLocation): HTMLElement | null {
	// Flat characters of the quote across (possibly several) text nodes.
	const chars: Array<{ node: Text; at: number; ch: string }> = [];
	for (let i = loc.startNode; i <= loc.endNode; i++) {
		const node = nodes[i];
		if (!node) continue;
		const text = node.textContent ?? "";
		const from = i === loc.startNode ? loc.startOffset : 0;
		const to = i === loc.endNode ? Math.min(loc.endOffset, text.length) : text.length;
		for (let at = from; at < to; at++) chars.push({ node, at, ch: text[at] ?? "" });
	}
	if (chars.length === 0) return null;
	// Nearest non-space character to the middle: middle placement keeps
	// the badge over long wrapped quotes, and skipping whitespace never
	// anchors the gap between two words.
	const mid = Math.floor(chars.length / 2);
	let pick: { node: Text; at: number } | null = null;
	for (let d = 0; d < chars.length && !pick; d++) {
		for (const i of [mid + d, mid - d]) {
			const c = chars[i];
			if (c && c.ch.trim() !== "") {
				pick = c;
				break;
			}
		}
	}
	if (!pick) return null;
	const parent = pick.node.parentElement;
	if (parent instanceof Element && parent.classList.contains("ccez-ann-anchor")) {
		return parent;
	}
	try {
		const range = document.createRange();
		range.setStart(pick.node, pick.at);
		range.setEnd(pick.node, pick.at + 1);
		const anchor = document.createElement("span");
		anchor.className = "ccez-ann-anchor";
		range.surroundContents(anchor);
		return anchor;
	} catch {
		return null;
	}
}

/**
 * Wrap every text-node part of a located quote in its own highlight
 * (sub-ranges stay inside single text nodes, so splitting is safe).
 * Returns the last mark for badge placement. Out-of-range offsets
 * (stale indices, partial overlaps) skip instead of throwing.
 */
function wrapRange(nodes: Text[], loc: QuoteLocation, extraClass?: string): HTMLElement | null {
	let last: HTMLElement | null = null;
	for (let i = loc.startNode; i <= loc.endNode; i++) {
		const node = nodes[i];
		if (!node) continue;
		const length = node.textContent?.length ?? 0;
		const from = i === loc.startNode ? loc.startOffset : 0;
		const to = i === loc.endNode ? loc.endOffset : length;
		if (from >= to) continue;
		try {
			const range = document.createRange();
			range.setStart(node, from);
			range.setEnd(node, to);
			const highlight = document.createElement("mark");
			highlight.className = extraClass ? `ccez-ann ${extraClass}` : "ccez-ann";
			range.surroundContents(highlight);
			last = highlight;
		} catch {
			continue;
		}
	}
	return last;
}

/**
 * Render annotations for the prompt tail, matching the review-panel shape:
 * numbered quote plus comment.
 */
export function formatAnnotations(list: Annotation[]): string {
	return list
		.map((a, i) => {
			const head = `${i + 1}. "${a.quote}"`;
			return a.comment.trim() ? `${head} — ${a.comment.trim()}` : head;
		})
		.join("\n");
}

/** Append the annotation block to outgoing prompt text. */
export function withAnnotations(prompt: string, list: Annotation[]): string {
	if (list.length === 0) return prompt;
	const block = `Annotated selections:\n${formatAnnotations(list)}`;
	return prompt ? `${prompt}\n\n${block}` : block;
}

/** One baked annotation reference, as displayed under its message. */
export interface AnnotationRef {
	n: number;
	quote: string;
	comment: string;
}

/**
 * Split a sent message into display text plus its baked annotation
 * block (see withAnnotations). The chat renders the text with a count
 * pill instead of the full block; hovering the pill reveals these refs.
 * Returns null when no clean trailing block is present — the message
 * then renders untouched (including user-typed lookalikes).
 */
export function splitAnnotationBlock(
	content: string
): { text: string; refs: AnnotationRef[] } | null {
	const marker = "\n\nAnnotated selections:\n";
	const head = "Annotated selections:\n";
	const at = content.lastIndexOf(marker);
	let text: string;
	let body: string;
	if (at !== -1) {
		text = content.slice(0, at);
		body = content.slice(at + marker.length);
	} else if (content.startsWith(head)) {
		// Annotations-only message: no prompt text ahead of the block.
		text = "";
		body = content.slice(head.length);
	} else return null;
	const refs: AnnotationRef[] = [];
	const entry = /(\d+)\.\s+"([\s\S]*?)"(?:\s+—\s+([^\n]*))?(?=\n\d+\.\s+"|$)/g;
	let m: RegExpExecArray | null;
	let covered = 0;
	while ((m = entry.exec(body)) !== null) {
		covered = m.index + m[0].length;
		refs.push({
			n: Number(m[1] ?? 0),
			quote: m[2] ?? "",
			comment: (m[3] ?? "").trim()
		});
	}
	if (refs.length === 0) return null;
	// Trailing garbage means this isn't our block (or a comment broke
	// the shape): fall back to full text rather than half a list.
	if (body.slice(covered).trim() !== "") return null;
	return { text, refs };
}

/**
 * Baked annotation refs by exact message content, memoized: sent
 * messages render redacted (count pill instead of the full block), so
 * this runs per render and must never re-parse. Display-only — results
 * are never fed back into reactive effects.
 */
const refsCache = new Map<string, { text: string; refs: AnnotationRef[] } | null>();
export function annRefsFor(content: string): { text: string; refs: AnnotationRef[] } | null {
	if (!content.includes("Annotated selections:")) return null;
	const hit = refsCache.get(content);
	if (hit !== undefined) return hit;
	const split = splitAnnotationBlock(content);
	if (refsCache.size > 200) refsCache.clear();
	refsCache.set(content, split);
	return split;
}
