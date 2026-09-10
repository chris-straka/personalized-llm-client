import {
	trimPasteTail,
	type PromptEditor,
	type PromptEditorOptions
} from "./editor";

/**
 * Plain-textarea PromptEditor for Android (see `createPromptEditor` in
 * `./editor` for the CodeMirror version used everywhere else).
 *
 * Why this exists: on phone WebViews CodeMirror can cache stale line-box
 * measurements (composer collapses to ~0 height) and the tap-to-reveal row
 * fade never repaints the composer region (stale-tile ghost). A native
 * textarea has no measurement cache and no compositor layer games, so both
 * failure modes disappear. What it deliberately drops: markdown coloring
 * while typing, undo history, and long-paste collapsing (pastes send
 * unfolded). Image attach still works — the paperclip button and drop
 * handling live outside the editor — and pasted images still become
 * attachments via `onImagePaste`.
 */
export function createTextareaEditor(
	parent: HTMLElement,
	options: PromptEditorOptions
): PromptEditor {
	const ta = document.createElement("textarea");
	ta.className = "ta-input";
	ta.rows = 1;
	if (options.initialDoc) ta.value = options.initialDoc;
	parent.prepend(ta);

	// field-sizing: content (see .ta-input CSS) sizes the composer up to
	// its max-height where supported; only measure by hand elsewhere.
	const cssOwnsHeight =
		typeof CSS !== "undefined" && CSS.supports("field-sizing: content");
	const autogrow = (): void => {
		if (cssOwnsHeight) return;
		// Height follows content up to the CSS max-height, then scrolls.
		ta.style.height = "auto";
		ta.style.height = `${ta.scrollHeight}px`;
	};
	const notify = (): void => {
		autogrow();
		options.onDocChange?.(ta.value);
	};

	const onInput = (): void => {
		notify();
	};
	const onKeyDown = (event: KeyboardEvent): void => {
		// IME composition (notably pinyin) confirms with Enter — never
		// hijack that keystroke or typing CJK sends the message halfway.
		if (event.isComposing) return;
		// Enter and Mod-Enter send; Shift-Enter falls through to newline.
		if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
			event.preventDefault();
			options.onSubmit("send");
			return;
		}
		if (event.key === "Enter" && event.altKey) {
			event.preventDefault();
			options.onSubmit("stage");
			return;
		}
		if ((event.ctrlKey || event.metaKey) && (event.key === "g" || event.key === "G")) {
			event.preventDefault();
			ta.blur();
			options.onHopOut();
		}
	};
	const onPaste = (event: ClipboardEvent): void => {
		const clipboard = event.clipboardData;
		if (!clipboard) return;
		const image = [...clipboard.files].find((f) => f.type.startsWith("image/"));
		if (image && options.onImagePaste) {
			event.preventDefault();
			options.onImagePaste(image);
			return;
		}
		const raw = clipboard.getData("text/plain");
		const text = trimPasteTail(raw);
		// Clean short paste: the default handler inserts it exactly.
		if (text === raw) return;
		// Newlines-only: swallow, don't grow an empty line.
		if (!text) {
			event.preventDefault();
			return;
		}
		event.preventDefault();
		const start = ta.selectionStart ?? ta.value.length;
		const end = ta.selectionEnd ?? ta.value.length;
		ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
		const caret = start + text.length;
		ta.setSelectionRange(caret, caret);
		notify();
	};

	ta.addEventListener("input", onInput);
	ta.addEventListener("keydown", onKeyDown);
	ta.addEventListener("paste", onPaste);
	autogrow();

	return {
		getText: () => ta.value,
		// No collapsing here: everything sends unfolded.
		getPastes: () => [],
		setText: (text: string) => {
			ta.value = text;
			notify();
		},
		insertText: (text: string) => {
			const start = ta.selectionStart ?? ta.value.length;
			const end = ta.selectionEnd ?? ta.value.length;
			ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
			const caret = start + text.length;
			ta.setSelectionRange(caret, caret);
			// Insertions (dictation, image markers) take the cursor
			// without yanking the messages list.
			ta.focus({ preventScroll: true });
			notify();
		},
		clear() {
			this.setText("");
		},
		// preventScroll: refocusing must never yank the messages list.
		focus: () => {
			ta.focus({ preventScroll: true });
		},
		blur: () => ta.blur(),
		setPlaceholder: (text: string) => {
			ta.placeholder = text;
		},
		// Nothing cached: there is no stale measurement to settle.
		remeasure: () => {},
		destroy() {
			ta.removeEventListener("input", onInput);
			ta.removeEventListener("keydown", onKeyDown);
			ta.removeEventListener("paste", onPaste);
			ta.remove();
		}
	};
}
