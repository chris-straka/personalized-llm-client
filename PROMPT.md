I heard this from another API

"""
◆ Best-client leverage for this project, keeping your thin-backend + 3-runtime rules:

WebAPIs first — zero Rust, biggest win:

1. Local full-text search across chats/annotations. You have no search now, every best client does. IndexedDB + OPFS + Intl.Segmenter for CJK word boundaries, done in a Worker. No backend needed, degrades to in-memory in jsdom.
2. Android keyboard + share: VisualViewport + VirtualKeyboard API for the reflow pain you already list, plus Async Clipboard (paste images directly) and Web Share Target so text/images can be shared into a chat.
3. Stream-completion UX: Notifications + Badging when a long reply finishes in background, View Transitions for chat switching, Popover API + CSS Anchor Positioning to replace the custom annotate pill/menus in src/lib/annotations.ts.

Small: MediaRecorder waveform + VAD to auto-stop dictation, File System Access for export chat as .md.

Rust bindings — only where web can't reach:

1. Android Keystore real backend in src-tauri/src/secrets_android.rs — TODO says keys don't persist there at all. That is the #1 gap.
2. Android TTS inventory in src-tauri/src/tts_android.rs to match the macOS speechVoices() inventory in src-tauri/src/tts.rs.
3. Learner killer: Vision OCR via objc2 (no Swift sidecar, same rule as TTS) — photo of Chinese/Japanese menu -> selectable text -> your existing pinyin/furigana pipeline. No API downloads voices, same constraint applies, but OCR is on-device.
"""

And this for more detail

"""
◆ That item bundled three separate mobile behaviors:

1. Keyboard reflow: on Android when the keyboard opens, the composer can get covered or the layout jumps. VisualViewport + navigator.virtualKeyboard let the app know the keyboard height and pin the prompt box just above it. You handle reflow manually today; this makes it exact instead of guessed. No new UI, it just stops covering the input.

2. Async Clipboard paste: navigator.clipboard.read() lets a Paste button insert images/files directly, where Ctrl+V does not exist on touch. Same result as your attachments in src/lib/attachments.ts, just a touch-friendly path to it.

3. Share into the app: a Web Share Target entry in the manifest means Android's system Share sheet lists Ccez Studio. Tapping it from Chrome/Photos drops that text/image into a new chat composer. Today you can only get content in by opening the app first.

None of that exists in src/ yet — I checked. Want me to implement one of the three?
"""

"""
[ITEMS 1–4 OF THIS LIST ARE MISSING — present in neither the chat message nor this file; the list as received starts at 5. Re-paste from the other API to recover them.]

5. Desktop summon kit: global shortcut, tray, single-instance + ccez:// deep link, sleep-prevention during speech/stream, dock progress.
6. Attachment text extraction in Rust (PDF/docx) + image downscale; offline language-ID for non-Apple platforms (tts_identify_lang returns None off macOS/iOS).
"""

"""
WebAPIs

• Custom Highlight API for annotation badges — paints multi-node highlights without the <mark> DOM wrapping that caused your P13 badge pain.
• Chrome built-in AI (Translator / LanguageDetector / Summarizer) — free on-device hover-translate feeding src/lib/translate.ts without spending the user's key. Falls back to your current helper where unavailable.
• Screen Wake Lock during read-aloud so the screen stays on for study sessions.
• getDisplayMedia screenshot-to-chat — capture an article frame straight into attachments for annotation and reading aids.
• Drag-and-drop onto the composer (DataTransfer) + File Handling launchQueue so .md files open into a chat. Your intake today is paste/attach only.
• Native Sanitizer API as eventual DOMPurify replacement in src/lib/render.ts, and native MathML for the planned LaTeX stage — offline, zero dependency.
• EditContext for CJK composition in the composer (the half-sent CJK problem in src/lib/textarea-editor.ts), plus AudioContext waveform on the voice bar and navigator.vibrate ticks on send/annotate for touch.

Rust / on-device

• Save speech to audio file (AVSpeech file-write / Android synthesizeToFile) — export lesson audio for spaced-repetition decks. Reuses your TTS bridges, new command.
• Offline dictionary + stroke order: bundle CC-CEDICT/JMdict + KanjiVG behind src/lib/radicals.ts. Pure data lookup, no model, no signing pain.
• Native share-out and print-to-PDF of a chat as a study sheet. Distinct from sharing into the app.
• Audio focus handling: pause/duck speech on calls and headset buttons.
• CJK font-coverage inventory with a download nudge — same pattern as your voice-tier inventory, but for missing glyphs.

Strongest learner combo: built-in-AI translate + dictionary/stroke-order + lesson-audio export.
"""

And this for optional things but they all look good I think?

I think hooking up a search to the ctrl+p shortcut would be good, and then for mobile if swiping left to right would open the chats sidebar and have a search text box you, where you can click at that search textbox to have the chats sidebar go away and the keyboard to step in to search for something. I also want the windows TTS and the Linux TTS. And the latex thing you mentioned earlier for math (between the $$ $$ and $$). I don't think I need latex rendering in the main text prompt itself, or markdown rendering in the main text prompt itself, just the main chat. I want similar fold and copy buttons for latex. I want linux TTS and dictate and I want Windows TTS and dictate. Also linux secrets (I'm assuming mac keychain and iOS is already covered). I think web secrets is done too with webcrypto right? This is everything else I can think of ever implementing in this app right now. I want you to spawn as many agents as you need to get all of this done as effectively and efficiently as possible. I'm thinking of letting this run all night, I'm about to go to sleep, so if you have any questions about all this, ask it now. ALthough it's fine if we build the wrong then and then we fix it tomorrow, but I think you know what I want anyway. Everything else that is in our TODO for later, let's do it all tonight. The "Chinese/Japanese" radical thing that we mentioned in the plan should only appear as a button next to the annotate button (on both mobile and desktop, meaning mobile should have annotate and "inspect" in the main text prompt whenever I hover kanji/hanzi. This new "Inspect" button should ONLY show up when I highlight Chinese or Japanese and ONLY when it's a single character in the highlight. When I click it, it should open an overlay similar to the keyboard shortcut overlay showing me the radicals and stuff. And it should show me an animation of the stroke order, the number of strokes, and the unihan definition. And this new inspect button should be locked behind a checkbox on the settings page with the other checkboxes. If it's off, then the button to Inspect should not appear anywhere at all. I think I want to produce the mac universal AND just the ARM in my assets for each release. I don't want the bloat of both versions in a single binary when I only use one. So I think that means two dmgs? Or is the point of a dmg to pick only one of the 15mb versions and then it only eats up 15mb on my computer's storage? Don't forget about tests. If you don't ask me any questions after I send this, I'll take that to mean you're good and I can go to bed, turn off my monitor and you can work on this all night. You can put the computer in sleep when you're done.
