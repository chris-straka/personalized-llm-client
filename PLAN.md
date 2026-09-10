# Ccez Studio — Plan (merged)

Single source of truth for decisions and stages. Spec is `README.md`
plus the `imgs/` annotation screenshots. `AI.md` / `AI2.md` are
superseded and gone. For day-to-day agent handoff (commands, build
gates, architecture rules) see `AGENTS.md`; for the working checklist
see `TODO.md`. This file keeps the decisions and the stage history
those two don't.

## Goal

A macOS desktop chatbot (BYOK: DeepSeek v4 Pro + Muse Spark 1.3 Contributor):
clean ChatGPT-desktop/AI-Studio-inspired chat with highlight-to-comment
annotation, language-learner reading aids, type-then-it-talks voice readback,
vim-flavored prompt editing — no clutter (no chat titles, no cloud sync, no
sharing, no plugins, no agentic/build features). Android rides along on
the same codebase via the Tauri mobile target (see milestone below).

## Key Decisions (from AI.md)

1. **Shell: Tauri 2** (`https://v2.tauri.app/`). Web UI + Rust backend;
   Swift/Kotlin bridges only if a feature proves to need one (two did:
   AVSpeech on macOS, TextToSpeech + PROCESS_TEXT on Android). Rejected
   **SwiftUI** (macOS-only, no Playwright loop) and **Flutter** (Dart
   rewrite, non-native feel).
2. **Testing is the tiebreaker: Vitest + Playwright.**
   (`https://vitest.dev/`, `https://playwright.dev/`).
3. **Frontend: Svelte 5 + TypeScript strict**
   (`https://svelte.dev/docs/svelte/overview`). Scoped styles + tokens.
4. **Prompt box: CodeMirror 6 + vim** (`https://codemirror.net/docs/ref/`,
   `https://github.com/replit/codemirror-vim`). Vim trapped in the box;
   hop-out to J/K message scroll.
5. **Rendering: marked + DOMPurify + Shiki** (`https://marked.js.org/`,
   `https://github.com/cure53/DOMPurify`, `https://shiki.style/`).
6. **Reading aids: pinyin-pro + lindera-wasm + model-assisted aid path**
   (`https://github.com/zh-lx/pinyin-pro`). Tashkeel was first through
   the generic model-aid path (no maintained JS vocalizer exists);
   see A6 for the generalized multilingual rule.
7. **Voice: Web Speech first**
   (`https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis`),
   native bridges where a voice proves missing (macOS AVSpeech, Android
   TextToSpeech). Download stays a stretch goal.
8. **Providers: one `ChatProvider` interface, two adapters, no Gemini.**
   DeepSeek = OpenAI-compatible (`https://api-docs.deepseek.com/`).
   Per-key base URL + model IDs in settings so model bumps are config
   changes.

## Amendments (agreed, folded in)

- **A1.** Reading aids default OFF; shortcut or hover+right-click only.
- **A2.** Fenced-code input box (shelved Sep 2026 to keep focus on
  language learning — revival spec lives in `TODO.md`).
- **A3.** All-in on Tauri. No Kotlin — later relaxed once, for the
  Android TextToSpeech bridge (no Kotlin-free inventory path exists).
- **A4.** Voice engines: Web Speech first; AVSpeech Rust bridge
  (objc2, zero ObjC/Swift) ships as a macOS-only settings toggle.
- **A6. Multilingual aids + audio (Sep 2026).** No per-language
  exceptions in code. Registry: local-compute aids (pinyin, furigana)
  plus model-assisted aids (tashkeel first). TTS resolves a voice
  locale per word from Unicode script with a user-set Latin-script
  default. Ancient languages get best-effort modern voices — quality
  limits stated, not hidden.
- **A7. Dependency policy (Sep 2026).** Defer TypeScript 7 until
  svelte-check / typescript-eslint support it. Legacy smells removed:
  kuroshiro/kuromoji, pako + path-browserify shims, 17 MB dict.
- **A8. Round 2 chrome rules.** Overlay native titlebar; no product-name
  text in the UI; no emoji as interface icons (except user-requested
  menu markers); Latin-script voice locale follows the reply language.
- **A5.** Voice UX: off by default; toggle on → replies read aloud while
  text still streams; mic input secondary.

## Stages — S0–S7 done; Rounds 2–6, Batch P done

S0 scaffold, S1 providers + keys, S2 core chat, S3 messages + code,
S4 annotation + translate helper, S5 reading aids (OFF default),
S6 voice mode (web + AVSpeech bridge + Android TextToSpeech bridge),
S7 desktop polish (icon, updater, keychain-backed keys). Then R2
post-install chrome, R3 layout (46rem column, sidebars), R4 behavior
(pins → top-posted messages, header rework), R5 submit semantics, R6
composer button, and Batch P (shell detect, traffic geometry, voice
bar, readback ranking, annotation matching, pills, menus). Detail on
what each shipped lives in `TODO.md`.

## Validation (per stage)

Strict typecheck, full Vitest run, production build, Playwright pass:
send/rerun/branch; option-click delete; paste-collapse; annotation
round-trip vs `imgs/`; aid toggle + hover-read; voice readback + skip;
vim-in-box + J/K. Highest-risk check was annotation wrap-into-query
(passed). Manual at end: 144 Hz scroll, cold start on both Macs,
installer run once.

## Risks / Rollback

- Tashkeel quality depends on the models — judged against a reading
  bar, never blocking earlier stages.
- Furigana needs its dict on disk — ships in-app, offline-first.
- Ancient-language voices are best-effort (see A6).
- Rollback: branch before risky work; each stage is a reviewed commit.

## Android milestone — Galaxy S24

Same Svelte codebase via the Tauri mobile target. Shipped and
emulator-verified Sep 2026 (Pixel_8a, debug build): `tauri android`
init, PROCESS_TEXT Annotate alias (singleTask forward + cold-start
parking; cold, warm, and in-app shares verified on device), Android
TextToSpeech bridge (speak/stop/voices over JNI), touch tuning (edge
swipes, selection, keyboard reflow). Release pipeline ships the
signed APK from a `v*` tag (`.github/workflows/release.yml`).

Still outstanding:

- Signing config, Play/self-sign decision (CI secrets are set; the
  first tag push exercises the pipeline).
- Share intent (`ACTION_SEND` text) → overlay/import into a chat draft
  (PROCESS_TEXT selection-menu shares already ship).
- Keychain → Android Keystore for API keys: keyring v3 has no Android
  backend and falls back to an in-memory mock (verified Sep 2026) —
  add a mobile-store fallback.
- System TTS ear-check on real hardware (code is done, including
  voice inventory; `tts_identify_lang` stays macOS/iOS-only, Android
  falls back to script detection).
- Samsung S24 hardware pass (Annotate overflow ordering, tap-to-reveal
  ghost in `issue.md`).
- On-device Gemma for offline use: MediaPipe LLM Inference (the one
  sanctioned Kotlin exception; no API exists in AI Edge Gallery, but
  the same `.task` files work). Provider gating contract already ships
  and is unit-tested (`visibleProviderIds` in `platform.ts`).

## Sources

- `https://v2.tauri.app/`
- `https://api-docs.deepseek.com/`
- `https://developer.android.com/ai/gemini-nano`
- `https://svelte.dev/docs/svelte/overview`
- `https://codemirror.net/docs/ref/`
- `https://github.com/replit/codemirror-vim`
- `https://marked.js.org/`
- `https://github.com/cure53/DOMPurify`
- `https://shiki.style/`
- `https://github.com/zh-lx/pinyin-pro`
- `https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis`
- `https://vitest.dev/`
- `https://playwright.dev/`
