# Ccez Studio — TODO

Spec: `README.md`. Full plan: `PLAN.md` (`AI.md`/`AI2.md` merged then deleted).

## Amendments (all folded into PLAN.md, kept here for history)

- **A1.** Reading aids (pinyin / furigana / tashkeel) default OFF (Stage 5).
- **A2.** Fenced-code input box in the prompt (Stage 2): typing ```lang + Enter
  opens an inline code editor with auto-closed fence, language label, Collapse +
  Copy. Run button = stretch goal. Spec: the two `imgs/*shiftenter*.png`.
- **A3.** All-in on Tauri, no Kotlin, no middle path. Stage 0 starts with `git
  init` + committing the current tree as insurance (not a git repo yet). No
  Android target yet — mobile is Tauri too, at its own milestone.
- **A4.** Voice engines: Web Speech first, then the small AVSpeech Rust
  bridge (objc2, zero ObjC/Swift — both evaluated and rejected) ships as a
  macOS-only settings toggle, web stays default/fallback.
- **A6.** Web SpeechSynthesis voices verified robotic in-browser (Sep 2026).
  Native AVSpeech bridge (`objc2-avf-audio`, macOS-gated, web stays
  default/fallback) approved as next voice work. Best quality needs Apple's
  premium/Siri voices downloaded in System Settings → Accessibility →
  Read & Speak → System Voice → Manage Voices.
- **A5.** Voice UX: off by default, read/write normally; toggle on → responses are
  read aloud while text still streams in; mic input supported but secondary.

## Coverage checklist (README bullet → stage)

### Things I want

- [x] Thinking-level shortcut, hard to hit, default high → S1
- [x] Model/key shortcut, hard to hit → S1
- [x] Option-click a message deletes it → S3
- [x] Code blocks fold, syntax-colored, language label, copy button → S3
- [x] Whole messages fold → S3
- [x] Paste >100 chars → `[Pasted content X chars]`; image → `[Pasted an image]` → S3
- [x] Image compression before send → S3
- [x] Chinese detect → faint corner hint → shortcut toggles pinyin ruby (OFF default, A1) → S5
- [x] Japanese furigana, same behavior (OFF default, A1) → S5
- [x] Arabic tashkeel via keys, same behavior (OFF default, A1) → S5
- [x] Hover + right-click reads a single word even when aids are off → S5
- [x] Vim trapped in prompt box; hop out to J/K message scroll → S2
- [x] Fenced-code input box: Collapse + Copy (Run later, A2) → S2
- [x] Attachments (images + files) → S3 (with paste-collapse + downscale)
- [x] Prompt box at bottom → S2
- [x] Desktop icon → S7

### From AI Studio

- [x] Accrued token meter → S2
- [x] Option+Enter pins prompt to top → S2
- [x] Cmd+Enter runs prompt + pins → S2
- [x] Branch from here → S2
- [x] Copy as markdown / as text → S3
- [x] Fast delete one/all chats → S2
- [x] Token estimates for files/images → S3 (needs attachments first)
- [x] Rerun prompt → S2
- [x] Error handling with retry → S2
- [x] Waypoint jump navigation in long chats → S2
- [x] Thoughts collapsed to faint expandable text, ctrl+O toggle → S3
- [x] No Sources section / citations unless asked → S3
- [ ] No app-build/agentic features → non-goal

### From ChatGPT desktop app
- [x] Annotation: select → comment → wrapped into next query (edit/delete), per `imgs/` → S4
- [x] Voice: type-then-it-talks, streaming word display, on-demand highlight
  readback, skip midway, clean voice-mode chrome → S6 (download = stretch)
- [x] Cmd+T translate lookup: cheap helper feeding annotation, NOT a mini-browser → S4
- [x] Multiple chats, no titles → S2
- [ ] No cloud sync / sharing / plugins → non-goal

### Later (not this build)
- [ ] Cloudflare-domain hosting, model-version bump, code Run button
- [x] Android phone build (S24): emulator-verified Sep 2026 — `tauri
  android` debug build, PROCESS_TEXT Annotate alias (cold/warm/in-app
  verified on Pixel_8a), touch tuning (edge swipes, selection, keyboard
  reflow). Outstanding on real hardware: signing config, Android
  Keystore (keyring v3 has no Android backend — in-memory mock only,
  nothing persists), system TTS inventory, Samsung S24 pass

## Architecture rules (learned Stage 2)

- Chat state is a plain object in `$state` with function updates (`src/lib/chat.ts`).
  Class instances in `$state` never re-rendered — do not use them for UI state.
- Never mutate a message object in place: Svelte proxy signals capture values on
  first read, so streaming updates must replace (`map` + local accumulator).
- Never run `check`/`lint`/`build` during a browser pass: `svelte-kit sync`
  rewrites watched files and HMR-invalidates the dev session mid-test.

## Stages
- [x] S0 clean slate (+A3): git init + insurance commit, wipe, desktop-only
  Tauri+Svelte+TS scaffold, Vitest, lint/format — all checks green
- [x] S1 providers (DeepSeek + Muse Spark checkpoint), keys, settings page, shortcuts
  — Muse verified live (models + chat + SSE); DeepSeek adapter pending a key.
  Shortcuts move to S2 with the prompt box they operate.
- [x] S2 core chat + prompt box + fenced-code input (A2) — streaming,
  rerun/branch/retry, pins, waypoints, vim + J/K, shortcuts, key eject UI.
  Shortcuts needed capture-phase listener (CodeMirror swallows combos).
- [x] S3 messages/code rendering, paste collapse, thoughts toggle —
  markdown + sanitize + Shiki (dual light/dark), code fold/copy/label,
  message fold, copy MD/text, paste-collapse markers (click to expand),
  attachments with downscale + token estimates, thoughts details + ctrl+O,
  Sources stripped unless asked. Paste-marker clicks needed the same
  mousedown guard as fence bars (vim swallowed every other click).
- [x] S4 annotation + translate helper — select → Annotate menu (Add to
  chat removed), cursor-anchored ChatGPT-style pill (Enter saves, Esc
  cancels, auto-grows, 500ms anti-double-send guard), numbered badges
  on quotes, review panel (edit/save/delete,
  delete-all pill), annotations wrap into next query, drafts survive failed
  sends, Cmd+T lookup feeding annotation, translate-target setting. Badge
  marks needed a synchronous read in the render effect (async-only reads
  never subscribe).
- [x] S5 reading aids (default OFF, A1)
- [x] S6 voice mode (+A4 bridge policy, +A6 multilingual) — header toggle,
  auto-read replies with live voice bar + Skip, per-message Speak,
  highlight-to-speak on demand, guarded mic dictation, voiceLang setting,
  script-wide TTS locales, tashkeel folded into generic model-aid path
- [x] S7 desktop polish, updater, icon, keychain keys (cold-start +
  installer-run stay manual on real hardware)
- [x] R2 post-install polish: overlay titlebar, minimalist header, clean
  pills/badges, reply-language menus + clear, real thinking levels,
  .env prefill, no translate-target, shortcut/vim maps, editor cursor,
  prompt flash fix
- [x] R3 layout (DeepSeek-web rhythm): settings moved to right sidebar
  panel (/settings route deleted), collapsible chat sidebar (persisted),
  centered 46rem column, composer send button, shortcut-map dark contrast
  fixed — pixel-verified light+dark at 1600px after the a11y-snapshot miss
- [x] R4 behavior: cursor root cause fixed, pins → top-posted messages,
  header rework (new chat/chats/voice), animated zero-space sidebars,
  Muse default + empty prompt + .env backfill, Fira Code stack

## Batch P (Sep 2026): polish + voice + annotations + layout

Root causes nailed before implementing: `tauriBackendAvailable()` checks the
Tauri **v1** global (`__TAURI__`); v2 exposes `__TAURI_INTERNALS__` — so every
tauri-gated branch (traffic clearance, Keychain note/secrets, shell UI) was
dead in the real app. Swift probe of `AVSpeechSynthesisVoice.speechVoices()`
(207 voices on this Mac): qualities are 1/2/3 as mapped; Siri personas
(`com.apple.eloquence.*`, 112 of them) report quality **1**, so the tier-2/3
inventory omits them and `pick_voice` ties them with Samantha (registry order
wins → robotic woman). Streaming render already exists (SSE→tokens→replaceReply
in `chat.ts`/`openai-compat.ts`, mock streams too); instant-paste complaints
are tiny mock replies + TTS starting at completion by design.

- [x] P1 shell detect: check `__TAURI_INTERNALS__` (keep `__TAURI__` fallback).
  Fixes traffic clearance, Keychain branch, all tauri-gated UI at once.
  Verify: stub the global in Playwright, assert `data-shell="tauri"`.
- [x] P2 traffic geometry proof (user demand): with stubbed shell, assert the
  header Chats button starts right of the light zone (x≥80) with the sidebar
  open AND closed. Native light pos (20,20) stays user-verified.
- [x] P3 prompt hover: transition the outline on in AND out (border-color
  transition on `.prompt`, respect reduced-motion).
- [x] P4 window focus: refocus takes you back to the prompt (pill box if the
  annotate pill is open, else the editor) — but never steal focus from a field
  that already holds it. Tab then continues from the prompt.
- [x] P5 composer landing: empty→first-message animates down (fade+slide
  keyframe on a wrapper, no editor remount) instead of snapping.
- [x] P6 voice-bar dark theme: dark bg/border/text + visible Skip (button
  exists, just invisible). Dismisses on end (already wired — verify live).
- [x] P7 speaking message icon: pulsing dot on the message being read
  (`speakingId`), cleared on end/error/stop.
- [x] P8 selection speak highlight: `speakingSelection` state tints that
  message's `::selection` amber while talking, restores after. Default
  `::selection` becomes a pretty indigo in both themes.
- [x] P9 pick_voice ties defer to the user's System Voice
  (`voiceWithLanguage`) — quality still wins outright. Swift-replicated
  ranking verified the tie path picks the system default.
- [x] P10 Siri inventory tier: `com.apple.eloquence.*` voices listed as Siri
  (they're quality 1, previously invisible). Note that say-exclusive Siri
  voices (Aman/Aru) can't appear — AVSpeech doesn't expose them.
- [x] P11 open_voice_settings Rust command (`open` CLI, macOS-only) replaces
  the opener-plugin deep-link (scope guessing was the failure); error stays
  persistent (no 5s clear) so it can be copied. Remove the unused capability
  scope entry. No user permission needed — opening Settings needs no consent.
- [x] P12 annotation highlight only while a textbox is open: clear
  `highlightAnnId` on pill save/cancel + review save/cancel.
- [x] P13 badge matching across nodes: whitespace-stripped + typographic-fold
  matcher, multi-node `<mark>` wrap, one badge. Fixes select-all, full-line,
  and reshaped-text misses. Cross-message selections stay review-only.
- [x] P14 composer pills: merge count + × into ONE pill; keep attach/mic
  below the prompt (user unsure — no move).
- [x] P15 system-voices blurb spacing: vertical margins around the note +
  disclosure so tiers don't crowd.
- [x] P16 streaming/voice timing: no change — text already streams for real
  providers (mock replies are 4 words/60ms, hence instant); TTS starts at
  completion because it consumes whole sentences. Progressive TTS is future
  work, not this batch.
- [x] P17 lang menus open UP over the composer (`bottom: 100%`), not down.
- [x] P18 settings × + Settings ⌘ hint vertical centering.
- [x] P19 mic errors mapped to friendly text (service-not-allowed → needs
  Chrome/Safari, etc.); Mic stays (works in real browsers; user rarely uses).
- [x] P20 toasts already top-center — no change, tell user.
- [x] P21 custom-provider form: real `<form>` + `required` (native validation,
  no sticky errors) + URL-format check that clears on input; spacing below
  the Add block.
- [x] P22 rename Browser voices → Web voices everywhere in UI copy.
- [ ] P23 +page.svelte split into components is still its own future task
  (AGENTS.md) — not this batch.

## Things I'm thinking about but are undecided on

- [ ] For new chats, it'd be cool if it would show me one thing that I have previously annotated and the answer that the AI chatbot gave for it, with the option to delete it and remove it from my history by clicking a trash can icon right beside. After the first msg in a new chat, this should disappear. It should not show me things that contain an expletive. It should say the usual "What can I do for you?" and then after a 3s pause it should 
- [ ] (moved to ## Shelved: code editor / code blocks in the prompt)

## Shelved: code editor / code blocks in the prompt

Shelved Sep 2026 to keep focus on language learning. The base auto-close +
language bar were also removed, so ``` in the prompt is plain text again.
Rendered message code blocks (fold, copy, highlight) are a separate shipped
feature and stay.

Revival spec for the prompt composer:

- ```lang + Shift+Enter auto-closes the fence.
- Backticks hidden behind a language bar with Collapse/Copy icon buttons
  (reuse the message-button glyphs, not text buttons).
- Per-language syntax highlighting inside the block.
- Triple-Shift+Enter exits the block; plain Enter inside code is always a
  newline, never an exit and never a send (⌘+Enter sends from anywhere).
- Cursor and typed text must stay visible in the block on all engines.

Parked bugs (WebKit/Tauri): the empty body row renders no div (caret has
nowhere to land, cursor invisible, typing unreliable) and block-widget
adjacency drops rows — the decoration approach needs a rethink before
revival. Bisect notes: only ONE block widget per fence survives; any
replace starting where the body mark ends drops the body row; an empty
line after a bar block renders only when its break carries a decoration
boundary.
