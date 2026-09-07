//! Native macOS text-to-speech via `AVSpeechSynthesizer`.
//!
//! Pure-Rust bindings through `objc2` — no Objective-C is written anywhere
//! in this project. Apple's premium/Siri-quality voices live behind this API;
//! the browser's `speechSynthesis` only sees the compact voice set, which is
//! why web speech sounds robotic in comparison.
//!
//! Design: a worker thread queues requests, but the synthesizer itself is
//! owned by the main thread. `AVSpeechSynthesizer` delivers delegate
//! callbacks (word boundaries, finish/cancel) on the main runloop — a
//! worker-owned synthesizer plays audio fine but its callbacks never fire,
//! so the UI stuck "speaking" after the audio ended. Tauri commands only
//! enqueue requests; progress returns to the frontend as `tts-word` /
//! `tts-done` window events tagged with a per-utterance id, so a stale
//! cancel can never reset the voice UI of newer speech.
//!
//! Compiled only on macOS. Every other platform gets stubs that report
//! "unsupported", and the frontend hides the engine toggle unless
//! `tts_supported` is true.

use tauri::AppHandle;

#[cfg(target_os = "macos")]
mod imp {
    use std::cell::RefCell;
    use std::sync::{
        OnceLock,
        atomic::{AtomicU64, Ordering},
        mpsc::{Receiver, Sender, channel},
    };
    use std::time::Duration;

    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, ProtocolObject};
    use objc2::{ClassType, MainThreadMarker, define_class, msg_send};
    use objc2_natural_language::NLLanguageRecognizer;
    use objc2_avf_audio::{
        AVSpeechBoundary, AVSpeechSynthesizer, AVSpeechSynthesizerDelegate, AVSpeechSynthesisVoice,
        AVSpeechUtterance,
    };
    use objc2_foundation::{
        NSDictionary, NSRange, NSUserDefaults, NSObject, NSObjectProtocol, NSString,
    };
    use tauri::{AppHandle, Emitter};

    /// Payload for `tts-word`: which utterance and which UTF-16 range of its
    /// text is being spoken (same units as `NSString` offsets).
    #[derive(Clone, serde::Serialize)]
    struct WordEvent {
        id: u64,
        location: u64,
        length: u64,
    }

    /// Payload for `tts-done`. `finished=false` means the utterance was
    /// stopped midway (Skip) rather than spoken to the end.
    #[derive(Clone, serde::Serialize)]
    struct DoneEvent {
        id: u64,
        finished: bool,
    }

    /// One installed system voice, as seen by `AVSpeechSynthesisVoice`.
    /// `quality`: 1 = default, 2 = enhanced, 3 = premium.
    #[derive(Clone, serde::Serialize)]
    pub struct NativeVoice {
        id: String,
        name: String,
        lang: String,
        quality: i64,
    }

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static ENGINE: OnceLock<Engine> = OnceLock::new();
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);

    // SAFETY: stateless delegate — no ivars, no shared mutation. Emission
    // goes through the thread-safe `AppHandle`.
    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "CcezTtsDelegate"]
        struct TtsDelegate;

        unsafe impl NSObjectProtocol for TtsDelegate {}

        unsafe impl AVSpeechSynthesizerDelegate for TtsDelegate {
            #[unsafe(method(speechSynthesizer:willSpeakRangeOfSpeechString:utterance:))]
            unsafe fn speech_synthesizer_will_speak_range(
                &self,
                _synthesizer: &AVSpeechSynthesizer,
                character_range: NSRange,
                _utterance: &AVSpeechUtterance,
            ) {
                // The utterance id rides a side channel: the worker stamps
                // CURRENT_ID before speaking, and speech is strictly serial
                // (each speak stops the previous utterance first).
                if let Some(app) = APP.get() {
                    let _ = app.emit(
                        "tts-word",
                        WordEvent {
                            id: CURRENT_ID.load(Ordering::SeqCst),
                            location: character_range.location as u64,
                            length: character_range.length as u64,
                        },
                    );
                }
            }

            #[unsafe(method(speechSynthesizer:didFinishSpeechUtterance:))]
            unsafe fn speech_synthesizer_did_finish(
                &self,
                _synthesizer: &AVSpeechSynthesizer,
                _utterance: &AVSpeechUtterance,
            ) {
                let id = CURRENT_ID.load(Ordering::SeqCst);
                eprintln!("[tts] done id={id} finished=true");
                if let Some(app) = APP.get() {
                    let _ = app.emit("tts-done", DoneEvent { id, finished: true });
                }
            }

            #[unsafe(method(speechSynthesizer:didCancelSpeechUtterance:))]
            unsafe fn speech_synthesizer_did_cancel(
                &self,
                _synthesizer: &AVSpeechSynthesizer,
                _utterance: &AVSpeechUtterance,
            ) {
                let id = CURRENT_ID.load(Ordering::SeqCst);
                eprintln!("[tts] done id={id} finished=false");
                if let Some(app) = APP.get() {
                    let _ = app.emit("tts-done", DoneEvent { id, finished: false });
                }
            }
        }
    );

    static CURRENT_ID: AtomicU64 = AtomicU64::new(0);

    enum Cmd {
        Speak {
            id: u64,
            text: String,
            lang: String,
            voice: Option<String>,
        },
        Stop,
        Voices(Sender<Vec<NativeVoice>>),
    }

    struct Engine {
        tx: Sender<Cmd>,
    }

    fn engine(app: &AppHandle) -> &'static Engine {
        ENGINE.get_or_init(|| {
            let _ = APP.set(app.clone());
            let (tx, rx) = channel::<Cmd>();
            std::thread::Builder::new()
                .name("ccez-tts".into())
                .spawn(move || worker(rx))
                .expect("TTS worker thread");
            Engine { tx }
        })
    }

    /// Best installed voice for a BCP-47 tag: exact locale wins, otherwise
    /// the primary-language prefix. Higher quality wins outright
    /// (premium > enhanced > default); exact-score ties defer to the Siri
    /// family (`com.apple.eloquence.*`) over legacy compact/novelty voices —
    /// without this, a tie falls to registry order (usually Samantha).
    ///
    /// Deliberately NOT `voiceWithLanguage` for the tie-break: that API
    /// returns the compact default (Samantha for en-US — verified Sep 2026
    /// against 207 installed voices on the dev Mac), i.e. the robotic voice
    /// this bridge exists to avoid. The eloquence personas are the
    /// downloadable Siri voices and the best `AVSpeech` exposes for English
    /// (no premium/enhanced English voice exists in the registry).
    fn pick_voice(lang: &str) -> Option<Retained<AVSpeechSynthesisVoice>> {
        unsafe {
            let voices = AVSpeechSynthesisVoice::speechVoices();
            let target = NSString::from_str(&lang.to_lowercase());
            let primary = lang.split(['-', '_']).next().unwrap_or(lang).to_lowercase();
            let exact_primary = NSString::from_str(&primary);
            let prefix = NSString::from_str(&format!("{primary}-"));
            let prefix_under = NSString::from_str(&format!("{primary}_"));
            let mut best_score = i64::MIN;
            let mut tied: Vec<Retained<AVSpeechSynthesisVoice>> = Vec::new();
            for voice in voices.iter() {
                let vlower = voice.language().lowercaseString();
                let exact = vlower.isEqualToString(&target);
                let related = exact
                    || vlower.isEqualToString(&exact_primary)
                    || vlower.hasPrefix(&prefix)
                    || vlower.hasPrefix(&prefix_under);
                if !related {
                    continue;
                }
                let score = voice.quality().0 as i64 + if exact { 10 } else { 0 };
                if score > best_score {
                    best_score = score;
                    tied.clear();
                    tied.push(voice.clone());
                } else if score == best_score {
                    tied.push(voice.clone());
                }
            }
            // Single winner (the common case: an outright premium/enhanced
            // pick like Majed) or no eloquence among the ties: first wins.
            let mut winner: Option<Retained<AVSpeechSynthesisVoice>> = None;
            let mut winner_eloquence = false;
            for voice in tied {
                let eloquent = voice.identifier().to_string().contains(".eloquence.");
                if winner.is_none() || (eloquent && !winner_eloquence) {
                    winner = Some(voice);
                    winner_eloquence = eloquent;
                }
            }
            winner
        }
    }

    fn installed_voices() -> Vec<NativeVoice> {
        unsafe {
            AVSpeechSynthesisVoice::speechVoices()
                .iter()
                .map(|voice| {
                    let string = |s: Retained<NSString>| s.to_string();
                    NativeVoice {
                        id: string(voice.identifier()),
                        name: string(voice.name()),
                        lang: string(voice.language()),
                        quality: voice.quality().0 as i64,
                    }
                })
                .collect()
        }
    }

    // The synthesizer and its delegate, owned by the main thread (only
    // `run_on_main_thread` closures touch this). `AVSpeech` delivers
    // delegate callbacks on the main runloop; the pair is retained here for
    // the app's lifetime (`delegate` is a weak reference).
    thread_local! {
        static MAIN_STATE: RefCell<Option<(Retained<AVSpeechSynthesizer>, Retained<TtsDelegate>)>> =
            const { RefCell::new(None) };
    }

    /// Run `f` with the main-thread synthesizer, creating it on first use.
    /// Call only from inside `run_on_main_thread`.
    fn with_main_synth(f: impl FnOnce(&AVSpeechSynthesizer)) {
        MAIN_STATE.with(|state| {
            if state.borrow().is_none() {
                unsafe {
                    let synth = AVSpeechSynthesizer::new();
                    let delegate: Retained<TtsDelegate> = msg_send![TtsDelegate::class(), new];
                    synth.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
                    *state.borrow_mut() = Some((synth, delegate));
                }
            }
            if let Some((synth, _)) = state.borrow().as_ref() {
                f(synth);
            }
        });
    }

    /// An explicitly chosen installed voice by registry identifier (the
    /// settings voice picker). None when it is not installed anymore.
    fn voice_by_id(id: &str) -> Option<Retained<AVSpeechSynthesisVoice>> {
        unsafe {
            for voice in AVSpeechSynthesisVoice::speechVoices().iter() {
                if voice.identifier().to_string() == id {
                    return Some(voice.clone());
                }
            }
            None
        }
    }

    /// Primary language of an installed voice (`en` for `en-US`).
    fn voice_primary(voice: &AVSpeechSynthesisVoice) -> String {
        unsafe {
            voice
                .language()
                .to_string()
                .split(['-', '_'])
                .next()
                .unwrap_or("")
                .to_lowercase()
        }
    }

    /// Identify the language of a text sample (`NLLanguageRecognizer`).
    /// None when the sample is too short to classify or the recognizer is
    /// uncertain — callers fall back to script detection. Stateless class
    /// call; runs on the invoke handler thread.
    pub fn identify_lang(text: &str) -> Option<String> {
        let trimmed = text.trim();
        if trimmed.chars().count() < 10 {
            return None;
        }
        unsafe {
            let ns = NSString::from_str(trimmed);
            NLLanguageRecognizer::dominantLanguageForString(&ns).map(|id| id.to_string())
        }
    }

    /// The user's own System Voice for a language (Read & Speak → System
    /// Voice), as a registry identifier. macOS keeps it in the
    /// `com.apple.Accessibility` suite under
    /// `SpokenContentDefaultVoiceSelectionsByLanguage`, keyed by primary
    /// language (`boundLanguage`; Mandarin binds as `cmn`, not `zh`).
    /// Undocumented storage: any shape change here (or a neural Siri voice
    /// that `AVSpeech` cannot see) simply yields None and the quality
    /// ranking below takes over — never an error.
    fn system_voice_id(lang: &str) -> Option<String> {
        unsafe {
            let primary = lang.split(['-', '_']).next().unwrap_or(lang).to_lowercase();
            let mut candidates = vec![primary.as_str()];
            if primary == "zh" {
                candidates.push("cmn");
            }
            let mtm = MainThreadMarker::new()?;
            let suite = NSString::from_str("com.apple.Accessibility");
            let defaults = NSUserDefaults::initWithSuiteName(mtm.alloc(), Some(&suite))?;
            let key = NSString::from_str("SpokenContentDefaultVoiceSelectionsByLanguage");
            let all = defaults.dictionaryForKey(&key)?;
            for candidate in candidates {
                let ckey = NSString::from_str(candidate);
                if let Some(entry) = all.objectForKey(&ckey) {
                    // Untyped dictionary: `DowncastTarget` only covers the
                    // default type parameters, and the lookup below takes
                    // any object key.
                    let dict: &NSDictionary = entry.downcast_ref()?;
                    let vkey = NSString::from_str("voiceId");
                    let any: Option<Retained<AnyObject>> = msg_send![dict, objectForKey: &*vkey];
                    if let Some(any) = any {
                        if let Some(voice) = any.downcast_ref::<NSString>() {
                            return Some(voice.to_string());
                        }
                    }
                }
            }
            None
        }
    }

    fn speak_on_main(app: &AppHandle, id: u64, text: String, lang: String, voice: Option<String>) {
        let _ = app.run_on_main_thread(move || {
            with_main_synth(|synth| unsafe {
                synth.stopSpeakingAtBoundary(AVSpeechBoundary::Immediate);
                CURRENT_ID.store(id, Ordering::SeqCst);
                let ns = NSString::from_str(&text);
                let utterance = AVSpeechUtterance::speechUtteranceWithString(&ns);
                // Priority: explicit picker (for its own language family)
                // > the user's System Voice for the language > best
                // installed voice for the language. A picked voice never
                // reads another language: highlights and words detected as
                // German get a German voice, not the English pick. Empty
                // saved ids mean auto-pick, same as None.
                let requested = voice.filter(|v| !v.is_empty());
                let req_primary = lang
                    .split(['-', '_'])
                    .next()
                    .unwrap_or(&lang)
                    .to_lowercase();
                let explicit = match requested.as_deref().and_then(voice_by_id) {
                    Some(v) if voice_primary(&v) == req_primary => Some(v),
                    Some(v) => {
                        eprintln!(
                            "[tts] speak id={id} lang={lang}: picked voice is {} ({}), text is another language — using system/auto",
                            v.identifier().to_string(),
                            voice_primary(&v),
                        );
                        None
                    }
                    None => {
                        if requested.is_some() {
                            eprintln!(
                                "[tts] speak id={id} lang={lang}: saved voice not installed, using system/auto"
                            );
                        }
                        None
                    }
                };
                let systematic = system_voice_id(&lang);
                let chosen = explicit
                    .map(|v| (v, "explicit"))
                    .or_else(|| {
                        systematic
                            .as_deref()
                            .and_then(voice_by_id)
                            .map(|v| (v, "system"))
                    })
                    .or_else(|| pick_voice(&lang).map(|v| (v, "auto")));
                match chosen {
                    Some((picked, origin)) => {
                        // One line per utterance in the `tauri dev`
                        // terminal: the fastest way to confirm which
                        // installed voice a complaint is about.
                        eprintln!(
                            "[tts] speak id={id} lang={lang} voice={} ({}, {origin})",
                            picked.identifier().to_string(),
                            picked.name().to_string(),
                        );
                        utterance.setVoice(Some(&picked));
                    }
                    None => {
                        eprintln!(
                            "[tts] speak id={id} lang={lang}: no installed voice matches, using synthesizer default"
                        );
                    }
                }
                utterance.setRate(0.5);
                synth.speakUtterance(&utterance);
            });
        });
    }

    fn stop_on_main(app: &AppHandle) {
        let _ = app.run_on_main_thread(|| {
            with_main_synth(|synth| unsafe {
                synth.stopSpeakingAtBoundary(AVSpeechBoundary::Immediate);
            });
        });
    }

    fn worker(rx: Receiver<Cmd>) {
        // The worker only queues: speech runs on the main thread (see
        // MAIN_STATE), and voice inventory is a plain registry read.
        for cmd in rx {
            match cmd {
                Cmd::Speak { id, text, lang, voice } => {
                    if let Some(app) = APP.get() {
                        speak_on_main(app, id, text, lang, voice);
                    }
                }
                Cmd::Stop => {
                    if let Some(app) = APP.get() {
                        stop_on_main(app);
                    }
                }
                Cmd::Voices(reply) => {
                    let _ = reply.send(installed_voices());
                }
            }
        }
    }

    pub fn supported() -> bool {
        true
    }

    pub fn speak(
        app: &AppHandle,
        text: String,
        lang: String,
        voice: Option<String>,
    ) -> Result<u64, String> {
        if text.trim().is_empty() {
            return Ok(0);
        }
        let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
        engine(app)
            .tx
            .send(Cmd::Speak { id, text, lang, voice })
            .map_err(|e| e.to_string())?;
        Ok(id)
    }

    pub fn stop(app: &AppHandle) -> Result<(), String> {
        engine(app).tx.send(Cmd::Stop).map_err(|e| e.to_string())
    }

    pub fn voices(app: &AppHandle) -> Result<Vec<NativeVoice>, String> {
        let (tx, rx) = channel();
        engine(app)
            .tx
            .send(Cmd::Voices(tx))
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())
    }
}

/// Does this build speak through the native engine? Always true on macOS,
/// always false elsewhere — the frontend gates the toggle on this.
#[tauri::command]
pub fn tts_supported() -> bool {
    #[cfg(target_os = "macos")]
    return imp::supported();
    #[cfg(not(target_os = "macos"))]
    return false;
}

/// Speak `text` with the best installed voice for `lang` (BCP-47), or the
/// explicit registry identifier in `voice` (the settings voice picker).
/// Without an explicit voice, auto-pick prefers the user's System Voice for
/// the language (Read & Speak → System Voice) when it resolves to an
/// installed voice, else the highest-quality installed voice.
/// Returns immediately with the utterance id; progress arrives as
/// `tts-word` / `tts-done` events carrying that id.
#[tauri::command]
pub fn tts_speak(
    app: AppHandle,
    text: String,
    lang: String,
    voice: Option<String>,
) -> Result<u64, String> {
    #[cfg(target_os = "macos")]
    return imp::speak(&app, text, lang, voice);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, text, lang, voice);
        return Err("native TTS requires macOS".into());
    }
}

/// Stop any in-progress native speech immediately.
#[tauri::command]
pub fn tts_stop(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return imp::stop(&app);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        return Err("native TTS requires macOS".into());
    }
}

/// Identify the language of a text sample for highlight-to-speak in Latin
/// scripts, where script detection cannot tell French from English.
/// Returns a BCP-47-ish tag, or null when the sample is too short or the
/// recognizer is uncertain (callers fall back to script detection).
#[tauri::command]
pub fn tts_identify_lang(text: String) -> Option<String> {
    #[cfg(target_os = "macos")]
    return imp::identify_lang(&text);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = text;
        return None;
    }
}

/// List installed system voices with their quality tiers.
#[tauri::command]
pub fn tts_voices(app: AppHandle) -> Result<Vec<imp::NativeVoice>, String> {
    #[cfg(target_os = "macos")]
    return imp::voices(&app);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        return Err("native TTS requires macOS".into());
    }
}

// The stub build has no `imp` module; the error type must still name a
// concrete serializable type.
#[cfg(not(target_os = "macos"))]
mod imp {
    #[derive(Clone, serde::Serialize)]
    pub struct NativeVoice {
        pub id: String,
        pub name: String,
        pub lang: String,
        pub quality: i64,
    }
}
