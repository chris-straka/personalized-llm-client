# Ccez Studio — Build Plan

Fresh build from `README.md` only. All existing code is discarded on approval (see
Stage 0). Single build, ordered stages, no version labels.

## Goal

A macOS desktop chatbot (BYOK: DeepSeek v4 Pro + Muse Spark 1.3 Contributor) that
implements every item in `README.md`: a clean ChatGPT-desktop/AI-Studio-inspired
chat experience with highlight-to-comment annotation, language-learner reading aids
(Chinese pinyin, Japanese furigana, Arabic tashkeel), type-then-it-talks voice
readback, vim-flavored prompt editing — and none of the clutter (no chat titles, no
cloud sync, no sharing, no plugins, no agentic/build features).

## Success Criteria

- Every wishlist bullet in `README.md` is shipped, explicitly deferred with a reason,
  or rejected with a reason. Nothing silently dropped. Code blocks fold and whole
  messages fold.
- Only two model providers exist in the codebase: DeepSeek and Muse Spark. No Gemini.
- Each stage ends with passing checks: typecheck, unit tests, and a Playwright
  MCP-driven browser pass over the new behavior.
- Keys live in OS-backed storage, never in the repo.

## Context And Current Facts

- Sole spec is `README.md` plus your hardware: 28" 4K 144 Hz display, M4 mini + M1
  Pro MacBook, Android S24. No Windows machine — only the macOS desktop target is
  built; mobile is a later decision.
- `imgs/` (6 screenshots) is the visual spec for the annotation feature and is kept.
- Keys on hand: DeepSeek v4 Pro and Muse Spark 1.3 Contributor. DeepSeek exposes an
  OpenAI-compatible API (`https://api-docs.deepseek.com/`). Muse Spark 1.x is served
  via Meta's public-preview Meta Model API
  (`https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/`); exact base
  URL and model IDs are confirmed against Meta's developer guide and your key at
  build time (Stage 1 checkpoint).
- No public third-party Galaxy AI SDK was found in this run, so no S24-specific
  integration is planned. A native Kotlin app's proven S24 advantages would be
  on-device Gemini Nano via the AICore system service
  (`https://developer.android.com/ai/gemini-nano`) and standard Android integrations
  (share sheet, widgets, notifications) — recorded as the mobile decision input,
  not built now.

## Constraints And Non-goals

- Desktop macOS only. Cloudflare-domain hosting and a mobile app are later, not
  this build. No Windows or Linux targets.
- The Cmd+T translate-lookup browser is "probably hard, not crucial" per README: it
  gets a cheap lookup helper that feeds annotation, not a mini-browser.
- Audio-file download for voice responses is a stretch goal: readback and skip ship
  first (see Stage 5 for why).
- Nothing is edited or deleted until this plan is approved.

## Key Decisions

**1. Shell: Tauri 2.** Tauri 2 wraps any web frontend in a small, fast, secure
desktop shell, builds macOS/Windows/Linux/Android/iOS targets from one codebase,
and prescribes Swift/Kotlin bridges for deep system integration
(`https://v2.tauri.app/`). It preserves the Playwright MCP testing loop (below),
keeps the Android option open for the S24, and costs nothing cross-platform if only
the macOS target is ever built. Rejected: **SwiftUI** — Apple's native framework
(`https://developer.apple.com/documentation/swiftui/`) gives the most Mac-like feel
and free Apple-only integrations, but it is macOS-only, needs a full Swift rewrite
of a chat UI, and cannot be driven by Playwright, which would make you the test
runner (see next point). Rejected: **Flutter** — builds macOS desktop from one Dart
codebase (`https://docs.flutter.dev/platform-integration/macos/building`), but
forces the whole UI into Dart with non-native Mac feel and Dart replacements for
every JS text library.

**2. Testing stack is the tiebreaker: Vitest + Playwright MCP.** Vitest is the
Vite-native unit runner (`https://vitest.dev/`). Playwright drives all major
browser engines and exposes an MCP server for agent browser control
(`https://playwright.dev/`), which is available in this environment — so the exact
UI code that ships in the Tauri webview gets verified iteratively every stage.
Swift's story is XCTest/XCUITest from Xcode
(`https://developer.apple.com/documentation/xctest`): writable but not drivable
here, so Swift would lose iterative verification.

**3. Frontend: Svelte 5 + TypeScript.** Svelte 5 runes-based components
(`https://svelte.dev/docs/svelte/overview`) keep chat-state code small and fast
(natural 144 Hz scrolling), TypeScript strict throughout. Styling is scoped
component styles plus design tokens; the taste skill is loaded before the first UI
edit so the clean, bevel-heavy look is grounded.

**4. Prompt box: CodeMirror 6 with vim bindings.** CodeMirror 6 ships as modular
npm packages (`https://codemirror.net/docs/ref/`) and Replit's package adds Vim
keybindings for it (`https://github.com/replit/codemirror-vim`). This delivers the
"vim trapped in the prompt box" requirement with a real vim implementation instead
of hand-rolled key handling, plus the hop-out-to-J/K message-scroll mode.

**5. Rendering: marked + DOMPurify + Shiki.** Marked is a fast markdown compiler
(`https://marked.js.org/`); its own docs require pairing it with a sanitizer and
recommend DOMPurify, a DOM-only XSS sanitizer
(`https://github.com/cure53/DOMPurify`). Shiki is a TextMate-grammar highlighter
in the VS Code engine family (`https://shiki.style/`) covering language detection,
syntax color, code folding, and copy buttons.

**6. Reading aids: pinyin-pro + kuroshiro + LLM tashkeel.** `pinyin-pro` converts
Chinese to tone-marked pinyin (`https://github.com/zh-lx/pinyin-pro`); `kuroshiro`
converts Japanese to kana/romaji with furigana modes
(`https://github.com/hexenq/kuroshiro`); both render as HTML ruby above the
characters. No maintained JS library that *adds* Arabic diacritics was found (only
removers), so tashkeel goes through your existing keys with a "vocalize fully,
change nothing else" instruction — same shortcut and hover behavior, zero new
dependencies.

**7. Voice: built-in speech synthesis first.** The Web Speech synthesis interface
(`https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis`) works inside
the Tauri webview: type-then-it-talks, word display as it speaks where the voice
emits boundary events, highlight-to-speak only on demand, skip-midway via utterance
control. It produces speech, not audio files — hence download ships later via a
file-based synthesis path.

**8. Providers: one interface, two adapters, no Gemini.** A single `ChatProvider`
interface (stream text, count tokens, expose thinking-level control where the model
supports it). DeepSeek adapter: OpenAI-compatible chat completions against
`https://api.deepseek.com`. Muse Spark adapter: Meta Model API, endpoint details
confirmed at the Stage 1 checkpoint. Per-key base URL and model IDs live in
settings so a future model bump is a config change, not a code change.

## Recommended Approach

Wipe the tree except `README.md`, `imgs/`, `AI.md`, and this file; scaffold Tauri 2
+ Svelte 5 + TypeScript from scratch with strict types, Vitest, and lint from day
one. Build in the staged order below, loading the taste skill before the first UI
edit. Keys move to OS-backed storage via a Tauri backend command on first run.

## Work Plan

**Stage 0 — Clean slate.** `git init` plus an insurance commit of the current tree
(this workspace is not a git repo yet), then delete everything except `README.md`,
`imgs/`, `AI.md`, `AI2.md`, `TODO.md` (verify `.gitignore` covers `.env` first;
`.env` itself stays local and uncommitted). Scaffold a desktop-only Tauri +
Svelte + TypeScript project, Vitest, strict `tsconfig`, lint/format configs. No
Android target yet — mobile is all-in on Tauri when its milestone comes, never
native Kotlin.

**Stage 1 — Providers + key management.** `ChatProvider` interface; DeepSeek
adapter (streaming, `deepseek-v4-pro` default); Muse Spark adapter with the
endpoint checkpoint (confirm base URL + model IDs against Meta's guide and your
key before writing the adapter); settings UI for two keys and per-key model;
OS-backed key storage; default system prompt "be brief, no summaries"; hard-to-hit
shortcuts for model/key and thinking-level switching (default level: high).

**Stage 2 — Core chat.** Bottom prompt box (CodeMirror 6 + vim trapped inside,
shortcut hops out to J/K message scroll, plus the fenced-code input box (typing
```lang + Enter opens an inline code editor with auto-closed fence, Collapse +
Copy; Run is a stretch goal); multi-chat with no titles; streaming
responses; rerun; branch-from-here; option+enter pin-to-top; cmd+enter
run-with-pins; accrued-token meter; per-file/image token estimates; fast delete
one/all chats; error states with retry.

**Stage 3 — Messages + code.** Markdown + sanitize + Shiki rendering; code blocks
fold, label their language, and copy on click; whole messages fold; option-click a
message deletes it; paste over 100 chars collapses to `[Pasted content X chars]`
and images to `[Pasted an image]` (both expandable); attachments with client-side
image downscale before send; model thoughts collapsed to faint expandable text
with ctrl+O toggle; no Sources section and no suggestion citations unless asked.

**Stage 4 — Annotation.** The `imgs/` flow exactly: select text → add comment →
wrapped into the next query → edit/delete annotation. Same affordance inside the
translate-lookup helper (cheap dictionary lookup feeding annotation, not a
browser).

**Stage 5 — Reading aids (default OFF).** Script detection (zh/ja/ar) with a
faint corner hint; one shortcut toggles ruby pinyin / furigana / tashkeel; hover +
right-click reads a single word even when the global toggle is off.

**Stage 6 — Voice mode (default OFF).** Normal reading/writing with voice off;
toggling on makes responses read aloud while their text still streams in.
Highlight-to-speak on demand only, skip-midway, mic input supported but secondary,
clean in-voice-mode chrome with smooth bevels. Engine order: Web Speech first,
then a small AVSpeech Rust/Swift bridge built but shipped OFF with a settings
toggle to switch engines. Audio download stays a stretch goal.

**Stage 7 — Desktop polish.** App icon set, Tauri updater, keychain-backed keys,
cold-start check on M4 mini and M1 Pro, smooth-scroll judgment on the 144 Hz
display.

## Validation Plan

- After every stage: strict typecheck, full Vitest run, production build.
- Playwright MCP pass every stage over the new behavior: send/rerun/branch;
  option-click delete; paste-collapse; annotation round-trip against the `imgs/`
  flow; pinyin/furigana/tashkeel toggle plus hover-read; voice readback plus skip;
  vim-in-box plus J/K scroll. Highest-risk check: the annotation wrap-into-query
  flow — custom logic with no prior tests.
- Manual: 144 Hz scroll feel, cold start on both Macs, installer run once at the
  end.

## Risks / Rollback

- Muse Spark endpoint details are confirmed at the Stage 1 checkpoint; if the
  protocol differs from expectations, only that adapter is reworked.
- `kuroshiro` needs a large morphological dictionary — lazy-load it so startup
  stays fast, with API-side readings as fallback.
- Tashkeel quality depends on the models — judged against your reading bar in the
  Stage 5 browser pass, never blocking earlier stages.
- Rollback: branch before Stage 0; the wipe is a single reviewed commit.

## Open Questions

- None blocking. The Muse Spark endpoint checkpoint and the tashkeel quality bar
  are handled inside Stages 1 and 5 as described.

## Sources

- `https://v2.tauri.app/`
- `https://developer.apple.com/documentation/swiftui/`
- `https://developer.apple.com/documentation/xctest`
- `https://docs.flutter.dev/platform-integration/macos/building`
- `https://api-docs.deepseek.com/`
- `https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/`
- `https://developer.android.com/ai/gemini-nano`
- `https://svelte.dev/docs/svelte/overview`
- `https://codemirror.net/docs/ref/`
- `https://github.com/replit/codemirror-vim`
- `https://marked.js.org/`
- `https://github.com/cure53/DOMPurify`
- `https://shiki.style/`
- `https://github.com/zh-lx/pinyin-pro`
- `https://github.com/hexenq/kuroshiro`
- `https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis`
- `https://vitest.dev/`
- `https://playwright.dev/`
