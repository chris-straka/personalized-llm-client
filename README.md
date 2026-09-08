# Ccez Studio

My own version of a macOS desktop chatbot app tailored to how I want things to work. 

This repo is from a previous attempt I made back when AI wasn't that good.

The only thing that I know/remember from this repo is this README.md and the new imgs folder with the imgs I added.

I primarily borrow inspiration from the chatGPT desktop app and the google AI studio web UI.

Less clutter, better defaults, no agentic stuff.

BYOK - I have two keys that I want to use (Deepseek v4 pro and meta's muse spark 1.3 contributor).

I mostly intend to use this for language learning and general questions

I have a ~big 28" 4k screen 144hz. I own an Android phone (S24), a mac m4 mini and an m1 pro macbook.

## Wishlist audit (Sep 2026)

The original list below is now sorted by what shipped. Key bindings live in
the app under Settings → Keyboard shortcuts.

### Done

- Thinking level on keys: Ctrl+⌥+↑/↓ cycles low / medium / high (default high).
- Model / key on keys: Ctrl+⌥+←/→.
- Option-click a message folds it (F over a message does the same, as does its Fold button).
- ⌘D over a message deletes it (Delete button does the same).
- Pastes over 100 chars collapse to `[Pasted content X chars]` (images similar).
- Attached images are downscaled client-side before sending.
- Chinese pinyin, Japanese furigana, Arabic tashkeel: auto-detected, ⇧⌘A
  toggles them, hover peeks, right-click speaks the word. Off by default.
- Vim stays trapped in the prompt; Ctrl+G or Space hops out to J/K scrolling.
- Attachments (images and text files), each with a token estimate.
- Prompt box at the bottom; accrued-token marker in the header.
- ⌥+Enter stages a message, ⌘+Enter sends (plus pins).
- Branch from here, copy as text, rerun a prompt, clickable waypoints.
- Delete one chat (⌘⇧Delete) or every chat (⌥⌘⇧Delete).
- Errors surface as a toast, never a blank stall.
- Annotations: highlight text, comment, it folds into the next query.
  Hovering a marker shows its highlight.
- Voice readback: text streams as it speaks with word tracking, voices match
  the reply language, skip lands between sentences, selections read on demand,
  audio downloads on the Mac app.
- Multiple chats in the sidebar (⌘B, then J/K); labels are timestamps only.
- Settings page for keys, per-key models, and defaults.
- Tests, lint, and browser-driven UI checks from day one.

Non-goals, all holding: no giant Thinking bubble (faint expandable thoughts,
Ctrl+O), no Sources section, no search citations, no agentic or app-build
features, no conversation titles, no cloud sync, no sharing, no plugins.

### To do

- Copy as markdown (copy-as-text exists).
- Run button on fenced-code blocks (nice to have, not required).

Later, maybe: the ⌘T browser popup with annotate (⌘T currently translates a
selection into the annotation flow instead), hosting on my Cloudflare domain,
a mobile app (annotations especially), and model-version updates.

### Dropped

- System prompt defaulting to "be brief, no summaries" — retired. The default
  prompt is empty now; put your own brevity line in Settings if you miss it.

## Other

If you have any good ideas for anything else I might like, please give them to me
