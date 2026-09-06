# Ccez Studio — Plan (merged)

Single source of truth. Merges `AI.md` (decisions), `AI2.md` (build plan), and
`TODO.md` progress. Spec is `README.md` plus the `imgs/` annotation screenshots.
`AI.md` / `AI2.md` / `TODO.md` are superseded; `README.md` and `imgs/` remain.

## Goal

A macOS desktop chatbot (BYOK: DeepSeek v4 Pro + Muse Spark 1.3 Contributor):
clean ChatGPT-desktop/AI-Studio-inspired chat with highlight-to-comment
annotation, language-learner reading aids, type-then-it-talks voice readback,
vim-flavored prompt editing — no clutter (no chat titles, no cloud sync, no
sharing, no plugins, no agentic/build features).

## Success Criteria

- Every `README.md` bullet is shipped, explicitly deferred with a reason, or
  rejected with a reason. Nothing silently dropped. Code blocks fold and whole
  messages fold.
- Only two model providers exist: DeepSeek and Muse Spark. No Gemini.
- Each stage ends green: typecheck, Vitest, production build, plus a Playwright
  browser pass over the new behavior.
- Keys live in OS-backed storage, never in the repo.

## Key Decisions (from AI.md)

1. **Shell: Tauri 2** (`https://v2.tauri.app/`). Web UI + Rust backend; macOS
   target only (no Windows machine). Swift/Kotlin bridges only if a feature
   proves to need one. Rejected **SwiftUI** (macOS-only, no Playwright loop —
   you become the test runner) and **Flutter** (Dart rewrite, non-native feel).
2. **Testing is the tiebreaker: Vitest + Playwright.**
   (`https://vitest.dev/`, `https://playwright.dev/`). Swift's XCTest/XCUITest
   (`https://developer.apple.com/documentation/xctest`) can't be driven here.
3. **Frontend: Svelte 5 + TypeScript strict**
   (`https://svelte.dev/docs/svelte/overview`). Scoped styles + tokens.
4. **Prompt box: CodeMirror 6 + vim** (`https://codemirror.net/docs/ref/`,
   `https://github.com/replit/codemirror-vim`). Vim trapped in the box;
   hop-out to J/K message scroll.
5. **Rendering: marked + DOMPurify + Shiki** (`https://marked.js.org/`,
   `https://github.com/cure53/DOMPurify`, `https://shiki.style/`).
6. **Reading aids: pinyin-pro + kuroshiro + model-assisted aid path**
   (`https://github.com/zh-lx/pinyin-pro`,
   `https://github.com/hexenq/kuroshiro`). Tashkeel was first through the
   generic model-aid path (no maintained JS vocalizer exists — only removers);
   see A6 for the generalized multilingual rule.
7. **Voice: Web Speech first**
   (`https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis`).
   AVSpeech bridge deferred (A4). Download stays a stretch goal (Web Speech
   produces speech, not files).
8. **Providers: one `ChatProvider` interface, two adapters, no Gemini.**
   DeepSeek = OpenAI-compatible (`https://api-docs.deepseek.com/`). Muse Spark
   via Meta Model API
   (`https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/`),
   endpoint confirmed at build time. Per-key base URL + model IDs in settings
   so model bumps are config changes.

## Amendments (agreed, folded in)

- **A1.** Reading aids default OFF; shortcut or hover+right-click only.
- **A2.** Fenced-code input box: ` ```lang ` + Enter opens an inline code
  editor (auto-closed fence, label, Collapse + Copy). Run = stretch goal.
- **A3.** All-in on Tauri. No Kotlin. Desktop-only scaffold; mobile is Tauri
  later at its own milestone.
- **A4.** Voice engines: Web Speech first; AVSpeech Rust/Swift bridge deferred
  with a reason (Web Speech covers learner readback; bridge cost unjustified
  until a voice proves missing/unacceptable).
- **A5.** Voice UX: off by default; toggle on → replies read aloud while text
  still streams; mic input secondary; highlight-to-speak on demand only.
- **A6. Multilingual aids + audio (Sep 2026).** No per-language exceptions in
  code. Reading aids are a registry: local-compute aids (pinyin, furigana)
  plus model-assisted aids (tashkeel first; future: Latin macrons, transliteration
  for Greek/Sanskrit/Thai, etc.). TTS resolves a voice locale per word from
  Unicode script (~12 major scripts) with a user-set Latin-script default
  (French/German now; Latin can't reliably self-identify). Ancient languages
  get best-effort modern voices (e.g. Italian for Latin, modern Greek for
  Ancient Greek) — quality limits stated, not hidden.
- **A7. Dependency policy (Sep 2026).** `bun outdated` shows everything
  current; TypeScript 6.0.3 is the latest stable 6.x, only 7.0.2 (native port)
  is newer and is deferred until svelte-check / typescript-eslint support it.
  No upgrade needed. Known legacy smells, kept while they work: kuroshiro
  (unmaintained — lazy-loaded, API fallback), pako + path-browserify shims
  (replacement candidate: fflate), 17 MB kuromoji dict (git-lfs/download TBD).
- **A8. Round 2 chrome rules.** Overlay native titlebar; no product-name
  text in the UI; no emoji as interface icons (text pills + status dots +
  ISO-code badges, except the three user-requested menu markers 🌍🌏🏛 and
  the three classics markers). Latin-script voice locale follows the reply
  language; ancient languages use stated modern approximations.

## Architecture Rules (learned mid-build)

- Chat state is a plain object in `$state` with function updates
  (`src/lib/chat.ts`). Class instances in `$state` never re-render.
- Never mutate a message in place: streaming updates replace (`map` + local
  accumulator).
- Never run `check`/`lint`/`build` during a browser pass: `svelte-kit sync`
  rewrites watched files and HMR-invalidates the dev session mid-test.

## Round 2 — post-install polish (Sep 2026, from running the .app in dark mode)

All S0–S7 shipped. These items came from using the installed app:

- **R2.1 Chrome.** Native overlay titlebar (no title text, floating traffic
  lights, window title "Ccez"); in-app header restyled minimalist and airy
  with traffic-light clearance in the shell; no emoji icons (taste rule) —
  Voice/Mic are text pills with status dots; language options are ISO-code
  badges, not emoji flags.
- **R2.2 Reply-language menus.** Empty-state menus 🌍 Europe / 🌏 Asia /
  🏛 Classics (Latin 🏛, Ancient Greek 🏺, Sanskrit 🪷), order as specified.
  Choosing sets the reply language (system-prompt suffix) and the voice
  locale; Clear restores the default brief prompt.
- **R2.3 Thinking levels that do something.** low/medium/high append a
  deliberation hint to the system prompt (previously display-only). Default
  stays high; 3-way cycling on the shortcut.
- **R2.4 Keys from `.env` in dev.** `VITE_DEEPSEEK_API_KEY`,
  `VITE_MUSE_API_KEY` (+ `_BASE_URL` overrides) prefill blank settings at
  dev/preview time. The installed app cannot read `.env` (baked at build) —
  it uses Settings → Keychain, which already hides the field and shows
  masked `••••last4` while a key is loaded.
- **R2.5 Translate target removed.** Cmd+T lookup targets English; the
  setting is gone (you specify other targets in the chat itself).
- **R2.6 Shortcut maps.** Settings gains full keyboard-shortcut and vim
  exit-mode maps (single-sourced from the audit: everything in README is
  implemented, including option+enter pin and Ctrl+G hop-out).
- **R2.7 Editor legibility.** Caret + vim block-cursor colors for dark mode;
  stable prompt-box min-height kills the navigation resize flash.

## Round 3 — layout (DeepSeek-web rhythm, pixel-verified)

- Settings is a right-sidebar panel; the `/settings` route is deleted.
- Chat sidebar collapses to an icon rail (persisted in settings).
- Centered 46rem reading column on wide screens; composer send button.
- Shortcut-map dark contrast fixed. Lesson: a11y snapshots carry no color —
  visual work is verified with pixel screenshots (light + dark, 1600px).

## Round 4 — behavior corrections (from using :5200)

- Cursor root cause: `@media` inside a CodeMirror theme object is unreliable
  AND CodeMirror injects cursor styles at runtime after ours — caret/block
  colors now live in global CSS with `!important`. Verified in the cascade.
- Pins removed as a separate concept: ⌥+Enter posts the draft as a user
  message at the top of the log (no reply); history carries it everywhere.
  Enter/⌘+Enter both send. Old saves migrate (pins stripped on load).
- Header: New chat (Ctrl+Alt+N) right, Chats toggle (⌘B) left, voice pill
  floats top-right inside the prompt. Sidebars animate width (no unmount),
  collapsed takes zero space; hover titles carry shortcuts.
- Defaults: Muse active, empty system prompt, header reads "Muse Spark 1.3".
  `.env` prefill reads VITE_ names plus the existing META_ aliases; blank
  saved keys backfill on load without clobbering. (Vite only exposes VITE_
  to the browser, so two VITE_ mirror lines were appended to the
  gitignored `.env` — originals untouched.)
- Fira Code-first mono stack for prompt, rendered code, shortcut keys.
- Tests are hermetic: pure `envProviderDefaults` replaces env stubbing so
  the developer's real `.env` can never leak into assertions again.

## Round 5 — AI Studio submit semantics

- Enter is a newline (fence auto-close preserved); only ⌘+Enter (or ↑)
  sends, and submit clears the prompt.
- ⌥+Enter stages the draft as the most recent message with no reply; the
  next submit carries staged + new text in order (foo, then bar).
- Pins array removed; old saves migrate.

## Stages — S0–S7 done; Rounds 2–5 done

- [x] **S0 clean slate** (+A3): git init + insurance commit, wipe,
  desktop-only Tauri+Svelte+TS scaffold, Vitest, lint/format.
- [x] **S1 providers + keys**: `ChatProvider`, DeepSeek adapter, Muse Spark
  adapter (verified live: models + chat + SSE; DeepSeek pending a key),
  settings page, OS-backed storage plan, brief system prompt, thinking-level
  default high. Shortcuts moved to S2 with the prompt box.
- [x] **S2 core chat**: bottom prompt (CodeMirror + vim, J/K scroll),
  fenced-code input (A2), multi-chat without titles, streaming, rerun from any
  message (truncate; branch keeps history), pins (opt+enter / cmd+enter),
  waypoints, accrued-token meter, fast delete one/all, retry, key eject UI.
- [x] **S3 messages + code**: markdown + sanitize + Shiki (dual light/dark),
  code fold/copy/label, message fold, copy MD/text, paste-collapse markers,
  attachments (downscale + token estimates), thoughts details + ctrl+O,
  Sources stripped unless asked.
- [x] **S4 annotation + translate helper**: select → Add to chat / More
  details menu, numbered badges, review panel (edit/save/delete/delete-all),
  wrap into next query, drafts survive failed sends, Cmd+T lookup feeding
  annotation, translate-target setting.
- [x] **S5 reading aids** (OFF default, A1): script detection + faint corner
  hint, Alt+R toggle, pinyin / furigana / tashkeel ruby, hover + right-click
  single-word TTS even when aids are off.
- [ ] **S6 voice mode** (OFF default, A4/A5/A6) — IN PROGRESS.
- [x] **S7 desktop polish**: custom icon set (chat-bubble master +
  `tauri icon`), keychain-backed keys (Rust commands + `secrets.ts`,
  Keychain in shell / localStorage fallback in browsers), updater wiring
  (`tauri-plugin-updater` + Settings check with graceful errors), 1280×860
  window with minimums, matching favicon. Updater activation needs release
  signing keys + a hosted feed (endpoint + pubkey are placeholders) — the
  check button reports this instead of failing silently. Still manual on
  real hardware: cold start on both Macs, 144 Hz scroll judgment,
  installer run.

### S6 scope

- Generalize `src/lib/reading.ts`: aid registry (tashkeel = one model-aid
  entry, not bespoke code); `ttsLangFor` covers all major scripts with a
  Latin-script fallback from settings (French/German now, CJK later).
- `src/lib/voice.ts`: sentence-chunked speech queue, skip-midway, word events
  for live display, markdown-stripping for speech, guarded mic dictation
  (secondary).
- UI: voice-mode chrome (indicator + bevels), auto-read replies while text
  streams, highlight-to-speak on demand only, mic button (hidden when
  unsupported), `voiceLang` default-locale setting.
- Stretch (not this stage): audio-file download, AVSpeech bridge.

## Validation (per stage)

Strict typecheck, full Vitest run, production build, Playwright pass:
send/rerun/branch; option-click delete; paste-collapse; annotation round-trip
vs `imgs/`; aid toggle + hover-read; voice readback + skip; vim-in-box + J/K.
Highest-risk check was annotation wrap-into-query (passed). Manual at end:
144 Hz scroll, cold start on both Macs, installer run once.

## Risks / Rollback

- Tashkeel quality depends on the models — judged against a reading bar, never
  blocking earlier stages.
- kuroshiro needs a large dict — lazy-loaded, API-side fallback.
- Ancient-language voices are best-effort; stated in A6.
- Rollback: branch before risky work; each stage is a reviewed commit.

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
