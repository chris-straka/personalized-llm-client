# Android phone bugs (physical S24, filed 2026-09-09)

The emulator-only tap ghost does NOT reproduce on hardware. These two do.

## 1. Composer stays under the keyboard

Tapping the main text box to type: the prompt does not rise above the
keyboard — GBoard covers almost all of it except the top line. Typing
blind.

Suspects: `visualViewport` resize / `keyboardOpen` composer-height
handling in `src/routes/+page.svelte` (the textarea composer has no
`scrollIntoView` support from CodeMirror's side; check whether the
keyboard-resize path keys off `.cm-content` or the editor view and now
misses `.ta-input`).

## 2. Annotation creation box overflows the screen

Tapping annotate: the create-annotation textbox is wider than the
viewport (overflows horizontally).

Suspects: the annotation composer / review dialog width rules in
`src/routes/+page.svelte` (fixed widths or padding tuned for desktop;
check `.review`, annotation popover, and any `min-width`).
