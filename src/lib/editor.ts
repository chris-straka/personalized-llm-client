import {
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
	Decoration,
	WidgetType,
	type DecorationSet
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { foldEffect, foldState } from "@codemirror/language";
import { vim, getCM, Vim } from "@replit/codemirror-vim";
import { isFenceTrigger } from "./fence";

/**
 * A chat box should greet typing with insert mode (Esc still drops to normal
 * mode, where keystrokes stay trapped). Drives vim's own key dispatcher so no
 * synthetic DOM events are involved; silently keeps normal mode on failure.
 */
function enterInsertMode(view: EditorView): void {
	try {
		const cm = getCM(view);
		if (cm) Vim.handleKey(cm, "i", "mapping");
	} catch {
		// Normal mode remains — vim is still fully available via Esc.
	}
}

export type SubmitKind = "send" | "stage";

export interface PromptEditor {
	readonly view: EditorView;
	getText(): string;
	setText(text: string): void;
	/** Insert text at the cursor (used for pasted-image markers). */
	insertText(text: string): void;
	clear(): void;
	focus(): void;
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

class FenceHeader extends WidgetType {
	constructor(
		private readonly language: string,
		private readonly bodyFrom: number,
		private readonly bodyTo: number
	) {
		super();
	}

	eq(other: FenceHeader): boolean {
		return (
			other.language === this.language &&
			other.bodyFrom === this.bodyFrom &&
			other.bodyTo === this.bodyTo
		);
	}

	override ignoreEvent(): boolean {
		// Widgets ignore all events by default; the bar buttons need clicks.
		return false;
	}

	toDOM(): HTMLElement {
		const bar = document.createElement("div");
		bar.className = "cm-fence-bar";
		const label = document.createElement("span");
		label.className = "cm-fence-lang";
		label.textContent = this.language;
		const collapse = document.createElement("button");
		collapse.type = "button";
		collapse.textContent = "Collapse";
		collapse.dataset.fenceAction = `collapse:${this.bodyFrom}:${this.bodyTo}`;
		const copy = document.createElement("button");
		copy.type = "button";
		copy.textContent = "Copy";
		copy.dataset.fenceAction = `copy:${this.bodyFrom}:${this.bodyTo}`;
		bar.append(label, collapse, copy);
		return bar;
	}
}

/**
 * Block widgets are forbidden in ViewPlugin decorations, so the bars live in
 * a StateField exposed through the decorations facet instead.
 */
function fenceBars(): Extension {
	const field = StateField.define<DecorationSet>({
		create: (state) => buildBars(state),
		update: (deco, tr) => (tr.docChanged ? buildBars(tr.state) : deco.map(tr.changes)),
		provide: (f) => EditorView.decorations.from(f)
	});
	// High precedence: vim's own handlers must not swallow widget clicks.
	const clicks = Prec.high(
		EditorView.domEventHandlers({
			mousedown: (event) => {
				if ((event.target as HTMLElement).closest("[data-fence-action]")) {
					event.preventDefault();
					return true;
				}
				return false;
			},
			click: (event, view) => {
			const target = (event.target as HTMLElement).closest("[data-fence-action]");
			if (!target) return false;
			const [action, from, to] = target.getAttribute("data-fence-action")!.split(":");
			if (action === "collapse") {
				// Park the cursor outside the fold or CodeMirror clears it instantly.
				view.dispatch({
					effects: foldEffect.of({ from: Number(from), to: Number(to) }),
					selection: { anchor: Number(from) - 1 }
				});
			} else {
				const text = view.state.doc.sliceString(Number(from), Number(to));
				void navigator.clipboard?.writeText(text).catch(() => {});
			}
			return true;
			}
		})
	);
	return [field, clicks];
}

function buildBars(state: EditorState): DecorationSet {
	const doc = state.doc;
	const ranges: Range<Decoration>[] = [];
	let openLine: number | null = null;
	let language = "";
	for (let i = 1; i <= doc.lines; i++) {
		const text = doc.line(i).text;
		if (openLine === null) {
			const lang = isFenceTrigger(text);
			if (lang) {
				openLine = i;
				language = lang;
			}
		} else if (/^```\s*$/.test(text)) {
			const bodyFrom = doc.line(openLine).to + 1;
			const bodyTo = doc.line(i).from;
			const deco = Decoration.widget({
				widget: new FenceHeader(language, bodyFrom, bodyTo),
				block: true
			});
			ranges.push(deco.range(doc.line(openLine).to));
			openLine = null;
			language = "";
		}
	}
	return Decoration.set(ranges);
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
				// Same guard as the fence bars: keep vim/CodeMirror selection
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
	return [field, clicks];
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
				const text = clipboard.getData("text/plain");
				if (text.length <= PASTE_THRESHOLD) return false;
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

/** Enter on a ```lang line auto-closes the fence and parks the cursor inside. */
function fenceEnter(view: EditorView): boolean {
	const { state } = view;
	const pos = state.selection.main.head;
	const line = state.doc.lineAt(pos);
	if (pos !== line.to) return false;
	const lang = isFenceTrigger(line.text);
	if (!lang) return false;
	view.dispatch({
		changes: { from: pos, insert: "\n\n```" },
		selection: { anchor: pos + 1 }
	});
	return true;
}

const appTheme = EditorView.theme({
	"&": { fontSize: "0.95rem" },
	".cm-content": { fontFamily: "inherit", padding: "0.6rem 0" },
	".cm-focused": { outline: "none" },
	".cm-fence-bar": {
		display: "flex",
		alignItems: "center",
		gap: "0.4rem",
		padding: "0.25rem 0.5rem",
		fontSize: "0.75rem",
		background: "#f1f1f4",
		borderRadius: "6px",
		margin: "0.25rem 0"
	},
	".cm-fence-lang": { fontWeight: "650", color: "#3a3a3c" },
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
	".cm-fence-bar button": {
		marginLeft: "auto",
		fontSize: "0.75rem",
		border: "1px solid #c7c7cc",
		borderRadius: "6px",
		background: "#fff",
		cursor: "pointer",
		padding: "0.1rem 0.5rem"
	},
	".cm-fence-bar button + button": { marginLeft: "0" },
	// Insert-mode caret (light scheme; dark lives in +page.svelte global
	// CSS because @media inside a CM theme object is unreliable).
	".cm-cursor": { borderLeftColor: "#1c1c1e" },
	// Vim normal-mode block cursor (replit draws .cm-fat-cursor).
	".cm-fat-cursor": { backgroundColor: "#1c1c1e", color: "#fff" }
});

export function createPromptEditor(
	parent: HTMLElement,
	options: PromptEditorOptions
): PromptEditor {
	const submitKeys = keymap.of([
		{
			key: "Enter",
			run: (view) => {
				// AI Studio behavior: Enter is a newline; only ⌘+Enter sends.
				if (fenceEnter(view)) return true;
				return false;
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

	const state = EditorState.create({
		doc: options.initialDoc ?? "",
		extensions: [
			submitKeys,
			EditorView.updateListener.of((update) => {
				if (update.docChanged) options.onDocChange?.(update.state.doc.toString());
			}),
			vim(),
			history(),
			keymap.of([...defaultKeymap, ...historyKeymap]),
			markdown(),
			foldState,
			fenceBars(),
			pastePlaceholders(),
			pasteHandling(options.onImagePaste),
			appTheme,
			EditorView.lineWrapping
		]
	});
	const view = new EditorView({ state, parent });
	enterInsertMode(view);

	return {
		view,
		getText: () => view.state.doc.toString(),
		setText: (text: string) =>
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
		insertText: (text: string) => {
			const { from, to } = view.state.selection.main;
			view.dispatch({
				changes: { from, to, insert: text },
				selection: { anchor: from + text.length }
			});
			view.focus();
		},
		clear() {
			this.setText("");
			enterInsertMode(view);
		},
		focus: () => view.focus(),
		destroy: () => view.destroy()
	};
}
