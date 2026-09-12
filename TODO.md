# Ccez Studio — TODO (single source of truth)

Merged 2026-09-12 from `PROMPT.md` + `PROMPT2.md` (raw request logs) +
`PLAN.md` (decisions/stages) + `PLAN2.md` (working pile) + `TODO.md`.
Those files are deleted; history lives in git. Done items were dropped —
what's below is all remaining work. Spec is `README.md`; agent handoff
(commands, gates, architecture) is `AGENTS.md`.

Bots: checkboxes are terse on purpose. The full verbatim request behind any
item lives in the deleted logs — recover with:
`git show HEAD~1:PROMPT.md`, `git show HEAD~1:PROMPT2.md`,
`git show HEAD~1:PROMPT3.md`, `git show HEAD~1:PLAN.md`,
`git show HEAD~1:PLAN2.md`, or the pre-merge `TODO.md` at the same ref.
Composer/message items pair with screenshots under `imgs/`. When picking up
an item, expand it with acceptance criteria first; don't guess.

## Goal + constraints

macOS desktop chatbot (BYOK: DeepSeek + Muse Spark): clean chat with
highlight-to-comment annotation, language-learner reading aids,
type-then-it-talks voice, vim-flavored prompt editing. Android rides the
same codebase via the Tauri mobile target.

- Free forever, offline-first, personal modern devices only, no paid accounts.
- Every OS supports every feature (macOS/Windows/Linux; Android where mobile).
- Commit + push when allowed.

## Standing decisions

- OS-native speech/OCR (no paid services). Per-arch DMGs, serialized
  single-writer release chain (verify -> publish -> prune -> rename).
- rAF scroll glide; per-chat draft scoping.
- FTS5 parked (IndexedDB not proven slow). Win/Linux/Android device proof
  needs real hardware — unit tests + honest unverified notes, never pass claims.
- P23 (`+page.svelte` component split) stays its own future task.
- Ghost features: user believes all fixed — verify, then drop this item.
- Cmd+T tension unresolved: S4 shipped it as translate-lookup (NOT a
  mini-browser); later requests ask for a single-tab browser window on Cmd+T
  and renaming research->browser. Decide one direction before building.

## Shipped (condensed — detail in git log)

S0 scaffold -> S1 providers/keys -> S2 core chat/prompt/vim -> S3 messages/code/
paste-collapse/thoughts -> S4 annotation/translate -> S5 reading aids (OFF
default) -> S6 voice (+AVSpeech mac bridge, +Android TTS, +multilingual) ->
S7 desktop polish/updater/icon/keychain -> R2 chrome -> R3 layout (46rem,
sidebars) -> R4 behavior (pins->top-posts, header) -> R5 submit -> R6 composer ->
Batch P (shell detect, traffic geometry, voice bar, readback ranking,
annotation matching, pills, menus) -> Night3 (tray, langid, scroll glide,
textai spec, v0.2.2 CI fixes, release pipeline per-arch DMGs). v0.2.5 tag
cut; release chain outcome still unconfirmed (see Now).

## Now (in progress)

- [x] Annotation draft restore on return is broken — fix first.
  Accept: 1 unsent draft (`.prompt-tools .ann-wrap`, see
  `imgs/annotation_textbox_filled.png`) in chat A survives New chat and is
  back (exactly 1, not duplicated) on return to A; S4 contract holds
  (select → comment → wrapped into next query).
- [x] `e2e/annotation-chat-scope.e2e.ts` failing — fix.
  Accept: `bunx playwright test e2e/annotation-chat-scope.e2e.ts` green —
  B's composer starts at 0 `.ann-wrap`, A restores to 1.
- [ ] Confirm v0.2.5 rename/verify/publish outcome (`gh release view v0.2.5`).
- [ ] Review + resolve the moderate Dependabot alert on the default branch
      (flagged at push time, 2026-09-12).

## Pile: composer

- [x] Idle-hide: main prompt hides on inactivity; image bubble must hide too.
      Click / `i` / Enter / left-click-on-non-button / mobile tap brings it back
      immediately. Mobile default timeout = never (always visible). Only hide
      when the prompt (or its backdrop) actually occludes text; the backdrop
      hiding the text must go away with it.
- [ ] Composer text overlaps counter pill cluster (padding fix).
- [ ] Composer code block: typing triple-backtick changes nothing until
      Shift+Enter commits the block; empty fence assumes text; no nesting;
      3x Shift+Enter exits. Distinct bg, aligned highlight, lang label
      left-aligned with text, closer divider. Its copy button fires a toast.
- [ ] Pasted-text tag: Ctrl+O expands/collapses all text in the tag (Muse
      Code style) — grey shade, not a code block, no own background.
- [ ] Image pill <-> `[Pasted image]` tag two-way removal (removing one removes
      the other).
- [ ] Paste-image flow: say `[Pasted image]`, no leading newline, cursor one
      space after.
- [ ] IMG pill: align with composer, no left/right spill, scroll when many.
- [ ] Clear attachment pills on send.
- [ ] Image.png/paperclip icon sizes track font size.
- [ ] Image cards replace pills: thumbnail preview + footer (tokens,
      icon copy button, OCR, X).
- [ ] Icon-only copy buttons everywhere (reuse message-button copy logo).
- [ ] Sent-message attachment chip above the message, left of annotation marker.
- [ ] ESC with composer focused unfocuses everything.
- [ ] Fenced-code input box revival (shelved): fencelang + Shift+Enter
      auto-close, language bar w/ Collapse/Copy glyphs, per-lang highlight,
      triple-Shift+Enter exits, Enter inside = newline, Cmd+Enter sends. Parked
      WebKit/Tauri bugs must be solved first (empty body row has no caret home;
      block-widget adjacency drops rows).

## Pile: messages + rendering

- [x] `$$` display math not rendering — fix. (Verified Sep 2026 on
  work/stream-rendering: `extractMath` + KaTeX path in `src/lib/render.ts`
  already handles `$$…$$`; `render.test.ts` x32 + all 6 `e2e/latex.e2e.ts`
  pass unmodified. No code change needed.)
- [x] Inline `$math$` rendering (display fences already work).
  (Done Sep 2026 on work/stream-rendering: `extractMath` in
  `src/lib/render.ts` now pairs single `$…$` with price/join guards —
  opener needs non-space after + non-alnum before, closer needs non-space
  before + non-alnum after, spans containing a bare `$` stay literal,
  `$$`/fences/code-spans/escapes untouched; same inline chrome + copy
  path as `\(…\)`, so no `+page.svelte` change needed.)
- [ ] Math chrome: no fold/copy/math labels; bar-click folds; body-click
      copies + toast; chevron + TeX preview.
- [ ] AI code fences: no copy/fold buttons; language logos if cheap.
- [ ] Right-click on latex/code folds must never start TTS.
- [ ] Right-click (even empty space) must never start audio.
- [ ] Copy toasts: latex copy shows toast; wording is "Copied" everywhere
      (not "Copied as plain text").
- [ ] Message with ONLY annotations renders as en-dash + annotation marker
      above, same font size as text, and stays unfolded. Message copy excludes
      annotations; each annotation copies on left-click in either overlay
      (icon-only button, no text).
- [ ] Thinking text uses the current chat font size.
- [ ] Code Run button + model-version bump + Cloudflare-domain hosting (later).
- [ ] Character components overlay for Han text (offline table already in
      `src/lib/radicals.ts`): needs a better name than "Radicals"; returns to the
      selection menu only after LaTeX + code rendering above; no release UI until then.
      Open question: offline dictionary for radical/stroke/Unihan — what source,
      how big? (Inspect currently reports unavailable offline.)

## Pile: annotation

- [x] Marker must not split words in half for text selection.
  (Verified Sep 2026 on work/stream-annotation2: `snapSelectionToWordEdges`
  runs in `onSelectEnd` before the menu reads the quote, CJK exempt;
  unit-locked in `annotations-dom.test.ts`, e2e `mid-word drags snap out
  to whole words` in `annotations-ux.e2e.ts`. No code change needed.)
- [x] Create-annotation textbox centers over the selection when the selection
      is smaller than the box; current position for larger selections. Annotate
      open-button stays at selection end near cursor.
  (Verified Sep 2026 on work/stream-annotation2: `placeAnnPopX` wired in
  the annotate path — centered when highlight < box, cursor placement
  otherwise, clamped on screen; e2e narrow/wide specs in
  `annotations-ux.e2e.ts`. No code change needed.)
- [x] Hovering a previous message's annotation count scales with font size.
  (Done Sep 2026 on work/stream-annotation2: `.ann-refs-pill` reads
  `var(--font-scale, 1)` like badges; locked in `annotations-ux.test.ts`.)
- [x] Empty annotations get "?" inserted so the AI knows I'm confused.
  (Verified Sep 2026 on work/stream-annotation2: `formatAnnotations` files
  empty comments as `— ?`; unit-locked in `annotations.test.ts`. No code
  change needed.)
- [x] Click-hold off-chat then drag into chat must not highlight above the
      current line; dragging off-screen must not highlight everything above.
  (Verified Sep 2026 on work/stream-annotation2: `armMessageDrag` arms on
  off-chat press, `trimMessageDrag` clamps on every selectionchange via
  `clampDragAnchorToFocusLine`/`lineStartOffset` (unit-locked); wiring
  locked in `annotations-ux.test.ts`. No code change needed.)
- [ ] Overlay edit: save button hover-in must animate like hover-out; Enter
      saves (no newline); textarea styling pass (near-black — confirm or fix).
- [ ] Annotation pencil hover: glow color, not disappear.
- [ ] Math annotation: normalize selection to whole equation; clear stale wash.
- [ ] Undecided: new chats show one past annotation + AI answer (no expletives,
      trash-can delete, disappears after first message, "What can I do for you?"
  - 3s pause). Decide/build or drop.

## Pile: reading aids + voice

- [x] Pinyin/furigana: script-segment detection (no pinyin on Japanese words).
      Line gating (kana lines never reach the engine) plus an engine-level
      kana bail in `pinyinRuby`, same kana class as the classifier.
      Accept: `pinyinBlock`/`pinyinRuby` unit tests + ruby-wrap
      "pinyin stays off Japanese lines" e2e green.
- [x] Pinyin hover flicker: reserve annotation space up front (visibility, not
      layout). Fixed by construction: `aid-space` leading reserves ruby's room
      whenever a local aid is offered (MessageBody), readings are absolute
      overlay (`.frt`) + native ruby, hover previews only cached kinds
      (`isFuriganaCached` gate, never fetch on hover).
      Accept: furigana-hover e2e (hover fetches nothing, boxes stable) +
      furigana pin bbox e2e green.
- [x] Furigana offset further left on macOS desktop. `data-mac` (already on
      `.app`) scopes `.frt` to the iOS pull (-8px): Range-ink measurement on
      macOS showed readings ~5px right of their kanji at -2px, ~0.6px at -8px.
      Accept: ruby-wrap wrap test measures ink (<2px) on mac, boxes (<4px)
      elsewhere — 6/6 green.
- [ ] Message-button icons scale with the text-size setting (pill buttons
      already do; logos/icons don't).
- [ ] Per-segment TTS voices for mixed-language messages (same-voice fallback
      today).
- [ ] Single-kanji inspect: hovering/selecting exactly one CJK char shows an
      Inspect button -> modal with mdbg-like info (stroke order, radical, unihan;
      skip Cantonese).
- [ ] Voice readback: per-chat setting, not global.
- [ ] Thinking-level change mid-thinking applies to next request (confirm/ensure).
- [ ] Mic button on macOS: user doesn't care — NO ACTION.

## Pile: scroll + navigation + chrome

- [ ] j/k hold: smooth scrolling must start immediately, no initial tiny jump
      (d/u same; d/u scroll faster).
- [ ] `gg` with nothing selected -> top; `G` (shift+g) with nothing selected
      -> bottom.
- [ ] `z` scrolls to top of hovered message; `Z` to bottom.
- [ ] Shift+Cmd+Plus/Minus adjusts chat width.
- [ ] Chat width configurable past 80rem.
- [ ] Own messages stop drifting right past AI width.
- [ ] Fresh-install defaults: own-message background OFF; message buttons
      hover-only for both me and AI.
- [ ] Option for message buttons scaling with font size (verify current state;
      create-annotation box scaling with font size also unverified — check both).
- [ ] Sliders: dragging up resets to default — decide keep/fix. Only the
      inner buttons (100%, 36 rem, 6s) reset — label clicks must not. Inactivity
      slider tops at 10s; max reads "never" (never hides).
- [ ] Sidebar: animated slide + opaque background (no see-through).
- [ ] Header: remove top-right buttons; rebrand Ccez Studio -> Ccez LLM
      (UI strings only).
- [ ] Language buttons: nudge down + fade until hover (mac); submenu
      languages alphabetical; submenus not jammed against the prompt.
- [ ] Fullscreen ESC: tap blurs/dismisses only; 2s hold exits.
- [ ] Remove screenshot-to-chat (Shot); keep paste + OCR.
- [ ] Export: icon-only button per sidebar chat row, left of delete; drop
      header button.
- [ ] Idle-hide: skip when chat empty or content shorter than viewport.
- [ ] Settings checkbox gap inconsistency (find + fix).
- [ ] Remove CJK font + lesson-audio settings sections (lesson-audio froze app).
- [ ] Keychain re-prompt: stable self-signed identity for dev rebuilds.
  (Decision Sep 2026, stream-platform: ad-hoc dev binaries change
  identity every rebuild, so the Keychain ACL re-prompts. Fix is a
  persistent local self-signed "Ccez Dev" code-signing cert (Keychain
  Access -> Certificate Assistant) + `codesign -s` on the dev binary;
  never commit the identity. Still needs a real Mac rebuild cycle to
  confirm no re-prompt — unverified.)
- [x] Updater in dev: explain unavailable instead of fetch error.
  (Done Sep 2026 on work/stream-platform: `updateRouteFor` gains an
  isDev leg returning a `dev` route; the settings updater path shows a
  plain explanation in dev shells. `updates.test.ts` x5 pass.)

## Pile: search + sideview

- [ ] Search palette: DOM focus follows highlight; ESC moves input->list;
      j/k navigate results.
- [ ] Cmd+P: native focus order must match highlighted message; Tab/Shift-Tab
      must match arrow-key target; ESC then j/k/arrows scroll results.
- [ ] Sideview -> plain Browser: rename research->browser; shortcut-only
      (drop toggle button); no Google Translate framing anywhere near it; better
      error handling; edge-drag resize with memorized size; Cmd+T from the prompt
      unfocuses into the browser search bar; single tab preferred (if tabs, then
      Shift+Cmd+[ / ] switches; note Shift+Cmd+H/L taken).

## Pile: sending + OCR

- [ ] Per-chat concurrent sending (global sending lock -> per-chat) so one
      thinking chat doesn't block asking in another.
- [ ] OCR: investigate Chinese-paragraph miss; errors surface as red toasts.

## Pile: platform + release (needs hardware)

- [ ] Win/Linux/Android device proof for every shipped feature.
  (Status Sep 2026, stream-platform: unit-tested contracts only —
  `platform.ts` x31, `updates.ts` x5, `langId.ts` x4 + `langid.rs` x3,
  `secrets_android` fail-closed/prefs-key, android e2e specs pin the
  web-reachable end states with device-only halves marked inside.
  No hardware in this harness: no pass claims, ever.)
- [ ] Samsung S24 pass (Annotate overflow ordering, tap-to-reveal ghost).
  (Blocked Sep 2026: no S24 hardware. `android-share`/`android-touch`
  e2e run under an SM-S921B UA + 412x915 viewport but cover the
  browser-reachable halves only.)
- [ ] System TTS ear-check on real hardware.
  (Blocked Sep 2026: voice quality needs ears on device. Native
  inventories ship per platform — `tts.rs` + `tts_android.rs` +
  `tts_linux.rs` + `tts_windows.rs` — but ranking was never heard.)
- [ ] Android: signing config / Play-vs-self-sign decision; share intent
      (ACTION_SEND text -> chat draft); Keystore fallback for API keys (keyring
      v3 = in-memory mock on Android, nothing persists). Verify current status.
  (Status Sep 2026, stream-platform: DECIDED self-sign — `release.yml`
  header records it (upload-keystore via CI secrets, APK from the
  Releases page, no Play, no Apple Developer account). Share intent
  SHIPS (manifest SEND filter + `MainActivity.handleSend` ->
  `annotate-external` prefill; PROCESS_TEXT alias alongside). Keystore
  fallback SHIPS (`Secrets.kt` AES/GCM envelope + `secrets_android.rs`,
  fail-closed without init, unit-tested). Device verify blocked.)
- [ ] On-device Gemma via MediaPipe LLM Inference (sanctioned Kotlin
      exception); provider gating contract already ships + unit-tested.
  (Report-only Sep 2026, stream-platform — NOT built per DO LAST:
  `visibleProviderIds` in `platform.ts` lists `local-gemma` only on
  offline Android and hides it elsewhere; `platform.test.ts` pins all
  six gating cases. Nothing registers `local: true` yet — no bridge.)

## Pile: input + sidebar + shortcuts + extras (from PROMPT3)

- [ ] Remove the Mac menu-bar logo entirely (doesn't look good, not wanted).
- [ ] Submit button: drop pinned language buttons from the top bar; replace
      the submit arrow with the emoji, centered vertically + horizontally.
- [ ] Own-message background breaks at large font sizes — fix.
- [ ] Shortcuts modal: first entry is "Shortcuts show/hide" ("Toggle shortcuts
      menu"); fold new keyboard/right-click tricks in pithy, no paren spam.
- [ ] Middle-click opens the shortcuts modal.
- [ ] Settings checkboxes: text highlightable without toggling; click still
      toggles.
- [ ] Cmd+F finds text in the current chat, cycling hits like a browser.
- [ ] Clicking a chat in the sidebar closes the sidebar. Cmd+Shift+H opens it;
      j/k then starts from the current chat, not the top.
- [ ] Double-tap on non-button chat-sidebar areas closes it. Double-tap on the
      settings-sidebar top expands the window like the main top bar.
- [ ] Main chat top shows traffic lights and nothing else; prompt/backdrop must
      never cut off top messages (only window bounds clip text).
- [ ] Settings menu shows the build version (or "dev" in dev).
  (Status Sep 2026, stream-platform: release builds already stamp
  `v{version} · build {stamp}` in SettingsPanel; dev hides the stamp
  deliberately ("dev · live reads as noise" — prior decision). Confirm
  that stands or restyle; no code changed.)
- [x] Annotations are leaking across chats — each chat (incl. its prompt) owns
      its annotations. (Related: annotation-scope e2e under Now.)
      Accept: deleting a background chat leaves the active composer's drafts +
      attachments untouched; deleting the active chat lands on its neighbor
      with that neighbor's drafts restored and the deleted id pruned from
      `ccez-studio-annotations-v1`.
- [ ] LaTeX annotation behavior: selecting equations double-highlights and
      stale highlights persist. Decide the interaction (partial-equation highlight
      would help) or constrain it deliberately.
- [ ] Selection: never highlight bullet points (Ctrl+A includes them today;
      mid-text leftward drags eat text but leave bullets). Lean on native web
      selection behavior where possible.
- [x] langid dead code (MIN_WORDS/MIN_SCORE/STOP_WORDS/is_cjk/
      is_latin_word_char/identify_lang_offline): remove or wire up — decide, don't
      carry warnings.
  (Decided Sep 2026 on work/stream-platform: WIRED UP, kept —
  `tts_identify_lang` calls it off-Apple, every helper is used; the
  blanket `allow(dead_code)` narrowed to an Apple-only `cfg_attr` so
  the module still compiles (and tests) on the dev host.)
- [ ] Android: voices button needs top/bottom spacing; system-voices auto
      element missing at startup; "build release" should read "Version";
      one-finger double-tap opens the sidebar when the chat is empty.
  (Blocked Sep 2026, stream-platform: all four need a real Android
  device to see/verify — untouched. Voice/chrome areas belong to
  sibling streams; coordinate before changing.)
- [ ] Offline AI fallback — DO LAST: when offline, Gemma becomes its own
      settings option replacing the DeepSeek/Muse bubbles; auto-switch back on
      reconnect. Android via MediaPipe; Mac via the user's existing Ollama (audit
      installs, pick the right model for an M4 mini, remove cruft, wire in).

## Non-goals

- No app-build/agentic features. No cloud sync / sharing / plugins.

## Verify (per AGENTS.md)

`bun run check` + `bun run test` + `cargo check/test` + focused e2e per area;
full suite before push. Device-only paths: unit tests + honest unverified
notes, never pass claims.
