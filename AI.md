# Ccez Studio — answers to your questions

This file answers everything from your last message. The new plan itself is in `AI2.md`.
`README.md` is now the only spec. All current code is treated as negligible.

## 1. The old code is out

Agreed: the Vite prototype had barely any code and is already out of date, so the new
plan ignores it completely. Nothing in `AI2.md` reuses, ports, or is shaped by it.
Idiomatic code, modern packages, best practices — decided fresh in the plan.

On your approval the whole tree gets wiped except `README.md` and `imgs/` (the
annotation screenshots are still the spec for the highlight feature), then the chosen
stack is scaffolded from scratch.

## 2. Tauri vs Swift, in more detail (your question, answered straight)

No — I am **not** saying Tauri can do everything a Swift app can with zero difference.
The honest version:

- A Tauri app is a web UI inside the operating system's web renderer, plus a Rust
  backend. Out of the box you get windows, file dialogs, notifications, updates, and
  key storage through official plugins. That covers nearly your whole wishlist.
- Anything genuinely macOS-only — menu-bar extras, system Services and Share
  integration, AppleScript control, the highest-quality offline system voices, the
  lowest-latency audio paths, native text-field behaviors (spellcheck, accent menus),
  custom window levels for overlays — a Tauri app can only reach **by writing bridge
  code**: a Rust command that calls into a small Swift helper. Tauri documents this
  Swift/Kotlin escape hatch as the intended path for deep system integration.
- So the real tradeoff is: Swift gives you all of that for free on day one, plus
  faster cold launch and lower memory. Tauri gives you all of it *eventually, with
  extra work per feature* — but you only pay for the bridges you actually need, and
  most of your wishlist never needs one.

Since you have no Windows machine: Tauri still makes sense — you just build only the
macOS target and ignore the rest. Cross-platform costs you nothing if you never ship
it, and the Android path stays open for your S24.

## 3. Testing: this is the deciding factor, and you read it right

- **Tauri:** the app UI is web code, so the exact code that ships can be driven in a
  real browser by the Playwright MCP server — my strongest iterative testing loop.
  Unit tests run in Vitest. This is why I do better frontend work here.
- **SwiftUI:** Playwright cannot touch native views at all. Apple's story is
  XCTest for unit tests and XCUITest UI tests driven from Xcode
  (`https://developer.apple.com/documentation/xctest`). I can *write* those tests,
  but there is no MCP harness for them in this environment, so the loop becomes:
  I write code, you (or Xcode on your Mac) run it, you paste results back. Much slower.
- Verdict: if you want me verifying my own UI work each step, Tauri wins by a lot.
  A Swift app would make you the test runner.

## 4. Gemini is out

Done — no Gemini key, no Gemini models, no search-grounding or URL-context features
anywhere in the plan. Your two keys are DeepSeek v4 Pro and Muse Spark 1.3
Contributor, and the plan builds one provider interface with two adapters:

- DeepSeek documents an OpenAI-compatible API (`https://api-docs.deepseek.com/`),
  so that adapter is straightforward.
- Muse Spark 1.x is served through Meta's public-preview Meta Model API
  (`https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/`). The exact
  base URL and model IDs get confirmed against Meta's developer guide and your key
  at build time — recorded as an explicit checkpoint in the plan, not an assumption.

## 5. Arabic is in — and what "no verified library" meant

Yes, Arabic tashkeel is in the plan. What I meant: I searched for a JavaScript
library that *adds* vowel marks and found only libraries that *remove* them. So
instead of a dependency, the plan uses your existing keys: send the selected text to
DeepSeek or Muse Spark with a "add full tashkeel, change nothing else" instruction
and render the result as the reading aid. No new package, no new bill, same shortcut
and hover behavior as pinyin and furigana.

## 6. The "v1 / v2" thing — dropped

That was my versioning language and it confused things. Gone. The new plan is a
single build in ordered stages, each independently testable. Nothing is labeled v1
or v2.

## 7. Folding: both kinds, confirmed

Code blocks fold *and* whole messages fold — both are explicit line items in the
plan (Stage 3), with the message-folding carrying over to the waypoint navigation
for long chats.

## 8. Native Android Kotlin vs Tauri mobile — your S24 question

- I found **no public third-party Galaxy AI SDK** — Samsung's AI features are not
  something another app can plug into. So there is no S24-magic integration waiting
  for a native app on that front.
- What a native Kotlin app *would* get on your S24: on-device Gemini Nano through
  AICore without a network round-trip (`https://developer.android.com/ai/gemini-nano`),
  plus first-class share-sheet, widgets, and notifications.
- What Tauri mobile would get: the same chat UI shared with desktop, talking to the
  same two keys — much less work, no on-device model, Android integrations only via
  Kotlin plugin bridges.
- Recommendation in the plan: desktop first; when mobile comes up, start with the
  Tauri Android target (cheap, shared code) and go native Kotlin only if on-device
  inference or widgets prove worth a second codebase. No decision needed now.
