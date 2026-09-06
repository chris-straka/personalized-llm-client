# Ccez Studio — TODO

Spec: `README.md`. Full plan: `AI2.md`. Q&A: `AI.md`.
Amendments A1–A4 below are agreed but not yet folded into `AI2.md` — they go in
with the approval to start.

## Amendments to AI2.md (pending approval)

- **A1.** Reading aids (pinyin / furigana / tashkeel) default OFF (Stage 5).
- **A2.** Fenced-code input box in the prompt (Stage 2): typing ```lang + Enter
  opens an inline code editor with auto-closed fence, language label, Collapse +
  Copy. Run button = stretch goal. Spec: the two `imgs/*shiftenter*.png`.
- **A3.** All-in on Tauri, no Kotlin, no middle path. Stage 0 starts with `git
  init` + committing the current tree as insurance (not a git repo yet). No
  Android target yet — mobile is Tauri too, at its own milestone.
- **A4.** Voice engines: Web Speech first, then the small AVSpeech Rust/Swift
  bridge is built but shipped OFF with a settings toggle to switch engines.
- **A5.** Voice UX: off by default, read/write normally; toggle on → responses are
  read aloud while text still streams in; mic input supported but secondary.

## Coverage checklist (README bullet → stage)

### Things I want
- [ ] System prompt defaults to "be brief, no summaries" → S1
- [ ] Thinking-level shortcut, hard to hit, default high → S1
- [ ] Model/key shortcut, hard to hit → S1
- [ ] Option-click a message deletes it → S3
- [ ] Code blocks fold, syntax-colored, language label, copy button → S3
- [ ] Whole messages fold → S3
- [ ] Paste >100 chars → `[Pasted content X chars]`; image → `[Pasted an image]` → S3
- [ ] Image compression before send → S3
- [ ] Chinese detect → faint corner hint → shortcut toggles pinyin ruby (OFF default, A1) → S5
- [ ] Japanese furigana, same behavior (OFF default, A1) → S5
- [ ] Arabic tashkeel via keys, same behavior (OFF default, A1) → S5
- [ ] Hover + right-click reads a single word even when aids are off → S5
- [ ] Vim trapped in prompt box; hop out to J/K message scroll → S2
- [ ] Fenced-code input box: Collapse + Copy (Run later, A2) → S2
- [ ] Attachments (images + files) → S3 (with paste-collapse + downscale)
- [ ] Prompt box at bottom → S2
- [ ] Desktop icon → S7

### From AI Studio
- [ ] URL Context + search grounding defaults — DROPPED with Gemini (no equivalent
  on DeepSeek/Muse keys; revisit only if a key gains web tools)
- [ ] Accrued token meter → S2
- [ ] Option+Enter pins prompt to top → S2
- [ ] Cmd+Enter runs prompt + pins → S2
- [ ] Branch from here → S2
- [ ] Copy as markdown / as text → S3
- [ ] Fast delete one/all chats → S2
- [ ] Token estimates for files/images → S3 (needs attachments first)
- [ ] Rerun prompt → S2
- [ ] Error handling with retry → S2
- [ ] Waypoint jump navigation in long chats → S2
- [ ] Thoughts collapsed to faint expandable text, ctrl+O toggle → S3
- [ ] No Sources section / citations unless asked → S3
- [ ] No app-build/agentic features → non-goal

### From ChatGPT desktop app
- [ ] Annotation: select → comment → wrapped into next query (edit/delete), per `imgs/` → S4
- [ ] Voice: type-then-it-talks, streaming word display, on-demand highlight
  readback, skip midway, clean voice-mode chrome → S6 (download = stretch)
- [ ] Cmd+T translate lookup: cheap helper feeding annotation, NOT a mini-browser → S4
- [ ] Multiple chats, no titles → S2
- [ ] No cloud sync / sharing / plugins → non-goal

### Later (not this build)
- [ ] Cloudflare-domain hosting, mobile UI, model-version bump, code Run button

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
- [ ] S3 messages/code rendering, paste collapse, thoughts toggle
- [ ] S4 annotation + translate helper
- [ ] S5 reading aids (default OFF, A1)
- [ ] S6 voice mode (+A4 bridge policy)
- [ ] S7 desktop polish, updater, icon, cold-start checks
