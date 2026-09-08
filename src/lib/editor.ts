import {
	Compartment,
	EditorState,
	StateEffect,
	StateField,
	Range,
	Prec,
	type Extension
} from "@codemirror/state";
import {
	EditorView,
	keymap,
	placeholder,
	Decoration,
	WidgetType,
	type DecorationSet
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { IMAGE_MARKER } from "./attachments";

export type SubmitKind = "send" | "stage";

/** Composer hint in edit mode. */
export const PROMPT_PLACEHOLDER = "ctrl+g message scroll";
/** Composer hint while scrolled out hopping messages. */
export const SCROLL_PLACEHOLDER = "ctrl+g to hop back in";

export interface PromptEditor {
	readonly view: EditorView;
	getText(): string;
	/** Collapsed-paste spans in document coordinates (for send-time folds). */
	getPastes(): PasteSpan[];
	setText(text: string): void;
	/** Insert text at the cursor (used for pasted-image markers). */
	insertText(text: string): void;
	clear(): void;
	focus(): void;
	/** Drop the caret (scroll mode must show no cursor in the prompt). */
	blur(): void;
	/** Swap the empty-prompt hint (edit vs scroll mode). */
	setPlaceholder(text: string): void;
	/** Re-run layout measurement (stale caches after occlusion/DPR change). */
	remeasure(): void;
	destroy(): void;
}

export interface PromptEditorOptions {
	initialDoc?: string;
	onSubmit: (kind: SubmitKind) => void;
	/** Ctrl+G: leave the editor for J/K message-scroll mode. */
	onHopOut: () => void;
	/** An image was pasted or dropped; the host turns it into an attachment. */
	onImagePaste?: (file: File) => void;
	/** Document text changed (drives the submit button's faded state). */
	onDocChange?: (text: string) => void;
}

/** Pastes longer than this collapse to a `[Pasted content N chars]` marker. */
export const PASTE_THRESHOLD = 100;

export function pastedLabel(chars: number): string {
	return `[Pasted content ${chars} chars]`;
}

/**
 * Long pastes stay in the document but render as one collapsed marker line
 * (click to expand). The full text is always what gets sent.
 */
class PasteMarker extends WidgetType {
	constructor(
		readonly pasteId: number,
		private readonly chars: number
	) {
		super();
	}

	get charCount(): number {
		return this.chars;
	}

	eq(other: PasteMarker): boolean {
		return other.pasteId === this.pasteId && other.chars === this.chars;
	}

	override ignoreEvent(): boolean {
		return false;
	}

	toDOM(): HTMLElement {
		const marker = document.createElement("span");
		marker.className = "cm-paste-marker";
		marker.dataset.pasteExpand = String(this.pasteId);
		marker.textContent = pastedLabel(this.chars);
		return marker;
	}
}

interface PasteCollapse {
	id: number;
	from: number;
	to: number;
	chars: number;
}

const addPaste = StateEffect.define<PasteCollapse>();
const expandPaste = StateEffect.define<number>();

/**
 * The paste-decoration field of the live composer (single instance).
 * Read it with pasteSpans — never touch it directly.
 */
let pasteFieldRef: StateField<DecorationSet> | null = null;

function pastePlaceholders(): Extension {
	const field = StateField.define<DecorationSet>({
		create: () => Decoration.none,
		update: (deco, tr) => {
			let next = deco.map(tr.changes);
			for (const effect of tr.effects) {
				if (effect.is(addPaste)) {
					const { id, from, to, chars } = effect.value;
					const marker = Decoration.replace({ widget: new PasteMarker(id, chars) });
					next = next.update({ add: [marker.range(from, to)] });
				} else if (effect.is(expandPaste)) {
					const ranges: Range<Decoration>[] = [];
					const cursor = next.iter();
					while (cursor.value) {
						const widget = (cursor.value.spec as { widget?: unknown }).widget;
						if (!(widget instanceof PasteMarker && widget.pasteId === effect.value)) {
							ranges.push(cursor.value.range(cursor.from, cursor.to));
						}
						cursor.next();
					}
					next = Decoration.set(ranges);
				}
			}
			return next;
		},
		provide: (f) => EditorView.decorations.from(f)
	});
	const clicks = Prec.high(
		EditorView.domEventHandlers({
			mousedown: (event) => {
				// Same guard as the fence bars: keep CodeMirror selection
				// from swallowing the marker click that follows.
				if ((event.target as HTMLElement).closest("[data-paste-expand]")) {
					event.preventDefault();
					return true;
				}
				return false;
			},
			click: (event, view) => {
				const target = (event.target as HTMLElement).closest("[data-paste-expand]");
				if (!target) return false;
				view.dispatch({ effects: expandPaste.of(Number(target.getAttribute("data-paste-expand"))) });
				return true;
			}
		})
	);
	pasteFieldRef = field;
	return [field, clicks];
}

export interface PasteSpan {
	from: number;
	to: number;
	chars: number;
}

export interface SendFold {
	start: number;
	end: number;
	chars: number;
}

/** Current collapsed-paste spans in document coordinates. Never throws. */
export function pasteSpans(state: EditorState): PasteSpan[] {
	if (!pasteFieldRef) return [];
	let set: DecorationSet;
	try {
		set = state.field(pasteFieldRef);
	} catch {
		return [];
	}
	const out: PasteSpan[] = [];
	const cursor = set.iter();
	while (cursor.value) {
		const widget = (cursor.value.spec as { widget?: unknown }).widget;
		if (widget instanceof PasteMarker) {
			out.push({ from: cursor.from, to: cursor.to, chars: widget.charCount });
		}
		cursor.next();
	}
	return out;
}

/**
 * Map document-coordinate paste spans into send-text coordinates, applying
 * exactly the send transforms (drop IMAGE_MARKER lines like
 * stripImageMarkers, then trim like composerText). A span touched by either
 * transform is dropped — sent unfolded — rather than misplaced. Pure and
 * unit-tested.
 */
export function sendPasteFolds(doc: string, spans: PasteSpan[]): { text: string; folds: SendFold[] } {
	// Drop marker lines, tracking dropped document ranges. Mirrors
	// stripImageMarkers line for line (split/filter/join); a parity test
	// below pins the text output to that function.
	const dropped: Array<{ start: number; end: number }> = [];
	const kept: string[] = [];
	let offset = 0;
	const lines = doc.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const chunk = line + (i < lines.length - 1 ? "\n" : "");
		if (line.trim() === IMAGE_MARKER) dropped.push({ start: offset, end: offset + chunk.length });
		else kept.push(chunk);
		offset += chunk.length;
	}
	const joined = kept.join("");
	// Trim; every surviving position shifts left by the leading run.
	const leading = joined.length - joined.trimStart().length;
	const text = joined.trim();
	const shift = (pos: number): number => {
		let delta = 0;
		for (const range of dropped) {
			if (range.end <= pos) delta += range.end - range.start;
			else break;
		}
		return pos - delta - leading;
	};
	const folds: SendFold[] = [];
	for (const span of spans) {
		if (span.from < 0 || span.to > doc.length || span.from >= span.to) continue;
		if (dropped.some((range) => span.from < range.end && range.start < span.to)) continue;
		const start = shift(span.from);
		const end = shift(span.to);
		if (start < 0 || end > text.length || start >= end) continue;
		folds.push({ start, end, chars: end - start });
	}
	folds.sort((a, b) => a.start - b.start);
	return { text, folds };
}

/**
 * Strip trailing blank lines from pasted text. Block selections routinely
 * drag extra newlines along, and the prompt must not grow empty lines for
 * them. Pure and unit-tested. (Pasted-image markers are decoration-only
 * widgets — they never pad the document, so this isn't that.)
 */
export function trimPasteTail(text: string): string {
	return text.replace(/(\r\n|\r|\n)+$/, "");
}

/** Paste hook: images become attachments, long text collapses to a marker. */
function pasteHandling(onImage: ((file: File) => void) | undefined): Extension {
	return Prec.high(
		EditorView.domEventHandlers({
			paste: (event, view) => {
				const clipboard = event.clipboardData;
				if (!clipboard) return false;
				const image = [...clipboard.files].find((f) => f.type.startsWith("image/"));
				if (image && onImage) {
					event.preventDefault();
					onImage(image);
					return true;
				}
				const raw = clipboard.getData("text/plain");
				const text = trimPasteTail(raw);
				// Nothing but newlines: swallow, don't insert an empty line.
				if (!text) {
					event.preventDefault();
					return true;
				}
				if (text.length <= PASTE_THRESHOLD) {
					// Untrimmed short paste: the default handler is exact.
					// Trimmed: it would reinsert the raw tail, so insert here.
					if (text === raw) return false;
					event.preventDefault();
					const { from, to } = view.state.selection.main;
					view.dispatch({
						changes: { from, to, insert: text },
						selection: { anchor: from + text.length }
					});
					return true;
				}
				event.preventDefault();
				const { from, to } = view.state.selection.main;
				const id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
				view.dispatch({
					changes: { from, to, insert: text },
					effects: addPaste.of({ id, from, to: from + text.length, chars: text.length }),
					selection: { anchor: from + text.length }
				});
				return true;
			}
		})
	);
}

const appTheme = EditorView.theme({
	"&": { fontSize: "0.95rem" },
	".cm-content": { fontFamily: "inherit", padding: "0.6rem 0" },
	// The prompt grows with the draft, then stops at ~8 lines and scrolls
	// inside instead of eating the messages list. overflow-y must ride
	// along: capped without it, long drafts clip with no way to reach
	// the hidden lines.
	".cm-scroller": { maxHeight: "12rem", overflowY: "auto" },
	".cm-focused": { outline: "none" },
	".cm-paste-marker": {
		display: "inline-block",
		fontSize: "0.78rem",
		color: "#3a3a3c",
		background: "#eef4ff",
		border: "1px solid #c7c7cc",
		borderRadius: "6px",
		padding: "0.1rem 0.5rem",
		cursor: "pointer"
	},
	// Insert-mode caret (light scheme; dark lives in +page.svelte global
	// CSS because @media inside a CM theme object is unreliable).
	".cm-cursor": { borderLeftColor: "#1c1c1e" }
});

export function createPromptEditor(
	parent: HTMLElement,
	options: PromptEditorOptions
): PromptEditor {
	const submitKeys = keymap.of([
		{
			key: "Enter",
			run: () => {
				options.onSubmit("send");
				return true;
			}
		},
		{
			key: "Shift-Enter",
			run: () => false // fall through to newline
		},
		{
			key: "Mod-Enter",
			run: () => {
				options.onSubmit("send");
				return true;
			}
		},
		{
			key: "Alt-Enter",
			run: () => {
				options.onSubmit("stage");
				return true;
			}
		},
		{
			key: "Ctrl-g",
			run: (view) => {
				view.contentDOM.blur();
				options.onHopOut();
				return true;
			}
		}
	]);

	const placeholderCompartment = new Compartment();
	const state = EditorState.create({
		doc: options.initialDoc ?? "",
		extensions: [
			placeholderCompartment.of(placeholder(PROMPT_PLACEHOLDER)),
			submitKeys,
			EditorView.updateListener.of((update) => {
				if (update.docChanged) options.onDocChange?.(update.state.doc.toString());
			}),
			history(),
			keymap.of([...defaultKeymap, ...historyKeymap]),
			markdown(),
			pastePlaceholders(),
			pasteHandling(options.onImagePaste),
			appTheme,
			EditorView.lineWrapping
		]
	});
	const view = new EditorView({ state, parent });
	// The prompt's buttons are absolutely positioned, so the editor node can
	// lead in DOM order: Tab reaches the prompt before Voice/Send.
	parent.prepend(view.dom);

	return {
		view,
		getText: () => view.state.doc.toString(),
		getPastes: () => pasteSpans(view.state),
		setText: (text: string) =>
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
		insertText: (text: string) => {
			const { from, to } = view.state.selection.main;
			view.dispatch({
				changes: { from, to, insert: text },
				selection: { anchor: from + text.length }
			});
			// Insertions (dictation, image markers) take the cursor
			// without yanking the messages list.
			view.contentDOM.focus({ preventScroll: true });
		},
		clear() {
			this.setText("");
		},
		// preventScroll: refocusing (notably on window focus) must
		// never yank the messages list — view.focus() scrolls.
		focus: () => {
			view.contentDOM.focus({ preventScroll: true });
		},
		blur: () => view.contentDOM.blur(),
		setPlaceholder: (text: string) => {
			view.dispatch({
				effects: placeholderCompartment.reconfigure(placeholder(text))
			});
		},
		remeasure: () => {
			view.requestMeasure();
		},
		destroy() {
			view.destroy();
		}
	};
}
