# Voice on Android (filed 2026-09-09)

## Findings (physical S24, SM-S921W, Android 16)

- Inspect console on `http://tauri.localhost/`:
  `typeof speechSynthesis` → **ReferenceError, not defined**.
- WebView UA: `Chrome/151.0.7922.199` — modern, yet `window.speechSynthesis`
  is entirely absent (not just an empty voice list).
- Conclusion: web speech is a dead end in this shell. No permission prompt
  is involved — TTS needs no permission; the engine object itself is gone.

## Fixes already shipped (did not help — engine absent, not slow)

- `voiceschanged` listener + reactive inventory bump
  (`webVoiceVersion` in `src/routes/+page.svelte`): speak gates re-render
  when voices arrive instead of staying disabled forever.
- Speak-failure error now distinguishes "no voices on device" from a
  thrown speak. Phones never auto-read selections (toggle removed).

## Real fix (planned): native TTS bridge

- Read-aloud needs an Android `TextToSpeech` bridge (Tauri plugin, no
  permission required for output).
- Mic dictation additionally needs `RECORD_AUDIO` + a native
  `SpeechRecognizer` bridge — Web SpeechRecognition never exists in
  WebViews, and the app deliberately hides mic buttons in-shell
  (`canMic = micAvailable() && !tauriBackendAvailable()`).
- Until then: the GBoard mic button is the dictation workaround.
