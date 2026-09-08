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
    use std::time::{Duration, Instant};

    use base64::Engine as _;
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
    static RENDER_TAG: AtomicU64 = AtomicU64::new(1);

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

    /// Locale and persona name out of a system voice id like
    /// `com.apple.voice.premium.en-GB.Malcolm` (locale `en-GB`, name
    /// `Malcolm`). Pure: the registry lookup below stays in the caller.
    fn split_system_id(id: &str) -> (Option<String>, Option<String>) {
        let mut rev = id.split('.').rev();
        let name = rev.next().filter(|s| !s.is_empty()).map(|s| s.to_string());
        let locale = rev
            .next()
            .filter(|s| s.contains('-') || s.contains('_'))
            .map(|s| s.to_string());
        (locale, name)
    }

    /// Installed voice with this persona name in this primary language
    /// (`Malcolm` for `en`), or None. Premium/neural System Voice ids
    /// (`com.apple.voice.*`) are never in the AVSpeech registry, so the
    /// exact-id lookup misses and this keeps the same person instead of
    /// falling through to registry order.
    fn voice_by_name(name: &str, primary: &str) -> Option<Retained<AVSpeechSynthesisVoice>> {
        unsafe {
            for voice in AVSpeechSynthesisVoice::speechVoices().iter() {
                if !voice.name().to_string().eq_ignore_ascii_case(name) {
                    continue;
                }
                let owned = voice.clone();
                if voice_primary(&owned) == primary {
                    return Some(owned);
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
    fn system_voice_id(ctx: &str, lang: &str) -> Option<String> {
        unsafe {
            let primary = lang.split(['-', '_']).next().unwrap_or(lang).to_lowercase();
            let mut candidates = vec![primary.as_str()];
            if primary == "zh" {
                candidates.push("cmn");
            }
            let Some(mtm) = MainThreadMarker::new() else {
                eprintln!("[tts] {ctx}: system voice lookup: no main-thread marker");
                return None;
            };
            let suite = NSString::from_str("com.apple.Accessibility");
            let Some(defaults) = NSUserDefaults::initWithSuiteName(mtm.alloc(), Some(&suite))
            else {
                eprintln!("[tts] {ctx}: system voice lookup: cannot open Accessibility suite");
                return None;
            };
            let key = NSString::from_str("SpokenContentDefaultVoiceSelectionsByLanguage");
            let Some(all) = defaults.dictionaryForKey(&key) else {
                eprintln!("[tts] {ctx}: system voice lookup: selections key missing");
                return None;
            };
            for candidate in candidates {
                let ckey = NSString::from_str(candidate);
                if let Some(entry) = all.objectForKey(&ckey) {
                    // Untyped dictionary: `DowncastTarget` only covers the
                    // default type parameters, and the lookup below takes
                    // any object key.
                    let Some(dict) = entry.downcast_ref::<NSDictionary>() else {
                        eprintln!("[tts] {ctx}: system voice lookup: entry for {candidate} is not a dictionary");
                        continue;
                    };
                    let vkey = NSString::from_str("voiceId");
                    let any: Option<Retained<AnyObject>> = msg_send![dict, objectForKey: &*vkey];
                    if let Some(any) = any {
                        if let Some(voice) = any.downcast_ref::<NSString>() {
                            return Some(voice.to_string());
                        }
                        eprintln!("[tts] {ctx}: system voice lookup: voiceId for {candidate} is not a string");
                    } else {
                        eprintln!("[tts] {ctx}: system voice lookup: no voiceId for {candidate}");
                    }
                }
            }
            eprintln!("[tts] {ctx} lang={lang}: no system voice entry");
            None
        }
    }

    /// Voice pick shared by live speech and offline render, so a
    /// downloaded file sounds like the readback it came from. Priority:
    /// explicit picker (for its own language family) > the user's System
    /// Voice for the language (exact id, else same persona by name, else
    /// the system locale) > best installed voice for the language. A
    /// picked voice never reads another language: highlights and words
    /// detected as German get a German voice, not the English pick.
    /// Empty saved ids mean auto-pick, same as None.
    fn choose_voice(
        ctx: &str,
        lang: &str,
        voice: Option<&str>,
    ) -> Option<(Retained<AVSpeechSynthesisVoice>, &'static str)> {
        unsafe {
            let requested = voice.filter(|v| !v.is_empty());
            let req_primary = lang
                .split(['-', '_'])
                .next()
                .unwrap_or(lang)
                .to_lowercase();
            let explicit = match requested.and_then(voice_by_id) {
                Some(v) if voice_primary(&v) == req_primary => Some(v),
                Some(v) => {
                    // Routine, not an error: the saved voice belongs to
                    // another language, so the pick below falls through to
                    // the System Voice / best installed voice as designed.
                    eprintln!(
                        "[tts] {ctx} lang={lang}: saved voice {} ({}) is another language — auto-picking instead",
                        v.identifier().to_string(),
                        voice_primary(&v),
                    );
                    None
                }
                None => {
                    if requested.is_some() {
                        eprintln!(
                            "[tts] {ctx} lang={lang}: saved voice not installed, using system/auto"
                        );
                    }
                    None
                }
            };
            let systematic = system_voice_id(ctx, lang);
            explicit
                .map(|v| (v, "explicit"))
                .or_else(|| {
                    let id = systematic.as_deref()?;
                    if let Some(v) = voice_by_id(id) {
                        return Some((v, "system"));
                    }
                    // Premium/neural System Voice ids (`com.apple.voice.*`,
                    // e.g. Malcolm) are never in the AVSpeech registry, so
                    // the exact lookup misses: try the same persona by name,
                    // then the system locale, staying inside the message's
                    // language family. Without this the pick degrades to
                    // registry order (Eddy over Jamie).
                    let (sys_locale, sys_name) = split_system_id(id);
                    if let Some(wanted) = sys_name {
                        if let Some(v) = voice_by_name(&wanted, &req_primary) {
                            eprintln!(
                                "[tts] {ctx} lang={lang}: system voice {id} not in registry, using same persona {}",
                                v.identifier().to_string(),
                            );
                            return Some((v, "system"));
                        }
                    }
                    if let Some(locale) = sys_locale {
                        let locale_primary = locale
                            .split(['-', '_'])
                            .next()
                            .unwrap_or("")
                            .to_lowercase();
                        if locale_primary == req_primary {
                            if let Some(v) = pick_voice(&locale) {
                                eprintln!(
                                    "[tts] {ctx} lang={lang}: system voice {id} not in registry, picking for system locale {locale}"
                                );
                                return Some((v, "system-locale"));
                            }
                        }
                    }
                    eprintln!(
                        "[tts] {ctx} lang={lang}: system voice {id} not in registry, auto-picking instead"
                    );
                    None
                })
                .or_else(|| pick_voice(lang).map(|v| (v, "auto")))
        }
    }

    /// Utterance with the shared voice pick and the shared rate, for
    /// speech and render alike. `ctx` tags the `tauri dev` log lines
    /// (`speak id=7`, `render`). One line per utterance in the terminal:
    /// the fastest way to confirm which installed voice a complaint is
    /// about.
    fn build_utterance(
        text: &str,
        lang: &str,
        voice: Option<&str>,
        ctx: &str,
    ) -> Retained<AVSpeechUtterance> {
        unsafe {
            let ns = NSString::from_str(text);
            let utterance = AVSpeechUtterance::speechUtteranceWithString(&ns);
            match choose_voice(ctx, lang, voice) {
                Some((picked, origin)) => {
                    eprintln!(
                        "[tts] {ctx} lang={lang} voice={} ({}, {origin})",
                        picked.identifier().to_string(),
                        picked.name().to_string(),
                    );
                    utterance.setVoice(Some(&picked));
                }
                None => {
                    eprintln!(
                        "[tts] {ctx} lang={lang}: no installed voice matches, using synthesizer default"
                    );
                }
            }
            utterance.setRate(0.5);
            utterance
        }
    }

    fn speak_on_main(app: &AppHandle, id: u64, text: String, lang: String, voice: Option<String>) {
        let _ = app.run_on_main_thread(move || {
            with_main_synth(|synth| unsafe {
                synth.stopSpeakingAtBoundary(AVSpeechBoundary::Immediate);
                CURRENT_ID.store(id, Ordering::SeqCst);
                let utterance =
                    build_utterance(&text, &lang, voice.as_deref(), &format!("speak id={id}"));
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

    /// 80-bit extended float (AIFF sample rate) to u32. None on
    /// zero/infinity/NaN/overflow — never panics, never silent garbage.
    fn extended80_to_u32(b: &[u8; 10]) -> Option<u32> {
        let biased = ((u16::from(b[0]) & 0x7f) << 8) | u16::from(b[1]);
        if biased == 0x7fff {
            return None;
        }
        let exp = biased as i32 - 16383 - 63;
        let mantissa = u64::from_be_bytes(b[2..10].try_into().ok()?);
        if mantissa == 0 {
            return Some(0);
        }
        let value = mantissa as f64 * 2f64.powi(exp);
        if !value.is_finite() || value < 0.0 || value > u32::MAX as f64 {
            return None;
        }
        Some(value.round() as u32)
    }

    /// Interleaved f32 samples from `say` AIFF-C output: `twos`/`NONE`
    /// (16-bit big-endian) and `sowt` (16-bit little-endian) PCM. Pure
    /// and unit-tested. Anything else is a clear error, not silence.
    fn aiff_samples(aiff: &[u8]) -> Result<(Vec<f32>, u16, u32), String> {
        let err = |what: &str| format!("unreadable audio file ({what})");
        if aiff.len() < 12
            || &aiff[0..4] != b"FORM"
            || (&aiff[8..12] != b"AIFC" && &aiff[8..12] != b"AIFF")
        {
            return Err(err("not AIFF"));
        }
        let aifc = &aiff[8..12] == b"AIFC";
        let mut channels = 0u16;
        let mut rate = 0u32;
        let mut big_endian = true;
        let mut sound: &[u8] = &[];
        let mut i = 12;
        while i + 8 <= aiff.len() {
            let id = &aiff[i..i + 4];
            let size =
                u32::from_be_bytes(aiff[i + 4..i + 8].try_into().map_err(|_| err("truncated"))?)
                    as usize;
            let body = aiff
                .get(i + 8..i + 8 + size)
                .ok_or_else(|| err("truncated"))?;
            if id == b"COMM" {
                if body.len() < 18 {
                    return Err(err("bad COMM"));
                }
                channels = u16::from_be_bytes([body[0], body[1]]);
                let bits = i16::from_be_bytes([body[6], body[7]]);
                let ext: [u8; 10] = body[8..18].try_into().map_err(|_| err("bad rate"))?;
                rate = extended80_to_u32(&ext).ok_or_else(|| err("bad rate"))?;
                if aifc {
                    if body.len() < 22 {
                        return Err(err("bad COMM"));
                    }
                    match &body[18..22] {
                        b"twos" | b"NONE" if bits == 16 => big_endian = true,
                        b"sowt" if bits == 16 => big_endian = false,
                        other => {
                            return Err(format!(
                                "unsupported AIFF encoding {}",
                                String::from_utf8_lossy(other)
                            ));
                        }
                    }
                } else if bits != 16 {
                    return Err(err("only 16-bit supported"));
                }
            } else if id == b"SSND" {
                if body.len() < 8 {
                    return Err(err("bad SSND"));
                }
                let offset =
                    u32::from_be_bytes(body[0..4].try_into().map_err(|_| err("bad SSND"))?)
                        as usize;
                sound = body.get(8 + offset..).ok_or_else(|| err("bad SSND offset"))?;
            }
            i += 8 + size + (size & 1);
        }
        if channels == 0 || rate == 0 || sound.is_empty() {
            return Err(err("no audio"));
        }
        let mut samples = Vec::with_capacity(sound.len() / 2);
        for pair in sound.chunks_exact(2) {
            let raw = if big_endian {
                i16::from_be_bytes([pair[0], pair[1]])
            } else {
                i16::from_le_bytes([pair[0], pair[1]])
            };
            samples.push(raw as f32 / 32768.0);
        }
        Ok((samples, channels, rate))
    }

    /// Render `text` to a WAV file (base64) without playing anything, for
    /// the per-message download button. Runs Apple's `say` CLI in a child
    /// process: the in-process `AVSpeechSynthesizer` offline render hangs
    /// without callbacks on some systems (probe-verified), while `say`
    /// renders the same voices in seconds. A child process can never wedge
    /// the app's main thread, and it is killed on timeout.
    ///
    /// Same voice pick as live speech, so the file sounds like the
    /// readback it came from (`say` takes Apple's display names, which
    /// match the registry names here). Pace may differ slightly: `say`
    /// has no rate control, so long files can run a little faster or
    /// slower than the 0.5-rate readback.
    pub fn render(
        _app: &AppHandle,
        text: String,
        lang: String,
        voice: Option<String>,
    ) -> Result<String, String> {
        if text.trim().is_empty() {
            return Err("nothing to render".into());
        }
        // Same voice pick as live speech, so the file sounds like the
        // readback it came from. `say` takes Apple's display names
        // ("Jamie (Premium)"), which match the registry names here.
        let picked = match choose_voice("render", &lang, voice.as_deref()) {
            Some((v, origin)) => unsafe {
                let name = v.name().to_string();
                eprintln!(
                    "[tts] render lang={lang} voice={} ({name}, {origin}) via say",
                    v.identifier().to_string(),
                );
                Some(name)
            },
            None => {
                eprintln!("[tts] render lang={lang}: no installed voice, using say default");
                None
            }
        };
        let tag = RENDER_TAG.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir();
        let txt_path = dir.join(format!("ccez-tts-{tag}.txt"));
        let aiff_path = dir.join(format!("ccez-tts-{tag}.aiff"));
        let cleanup = || {
            let _ = std::fs::remove_file(&txt_path);
            let _ = std::fs::remove_file(&aiff_path);
        };
        // Text goes through a file (`say -f`): no shell-quoting hazards
        // and no command-line length ceiling on long messages.
        if let Err(e) = std::fs::write(&txt_path, &text) {
            cleanup();
            return Err(format!("could not stage text: {e}"));
        }
        let mut cmd = std::process::Command::new("/usr/bin/say");
        if let Some(name) = picked.as_deref() {
            cmd.arg("-v").arg(name);
        }
        cmd.arg("-f")
            .arg(&txt_path)
            .arg("-o")
            .arg(&aiff_path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| format!("could not start say: {e}"))?;
        // say renders ~1000 chars/sec (probe-verified); the floor keeps
        // short renders safe and the kill below keeps a stuck child from
        // outliving the request.
        let budget = Duration::from_secs((15 + text.len() as u64 / 100).min(300));
        let started = Instant::now();
        let status = loop {
            match child.try_wait() {
                Err(e) => {
                    let _ = child.kill();
                    cleanup();
                    return Err(e.to_string());
                }
                Ok(Some(status)) => break status,
                Ok(None) if started.elapsed() > budget => {
                    let _ = child.kill();
                    let _ = child.wait();
                    cleanup();
                    eprintln!("[tts] render: say timed out");
                    return Err("render timed out — try a shorter message".into());
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            }
        };
        if !status.success() {
            let mut err = String::new();
            if let Some(stderr) = child.stderr.take() {
                use std::io::Read as _;
                let mut reader = std::io::BufReader::new(stderr);
                let _ = reader.read_to_string(&mut err);
            }
            cleanup();
            let detail = err.trim().to_string();
            if detail.is_empty() {
                eprintln!("[tts] render: say failed");
                return Err("speech renderer failed".into());
            }
            eprintln!("[tts] render: say failed: {detail}");
            return Err(format!("speech renderer failed: {detail}"));
        }
        let aiff = std::fs::read(&aiff_path).map_err(|e| {
            cleanup();
            format!("could not read rendered audio: {e}")
        })?;
        cleanup();
        let (samples, channels, sample_rate) =
            aiff_samples(&aiff).map_err(|e| {
                eprintln!("[tts] render: {e}");
                e
            })?;
        if samples.is_empty() {
            return Err("synthesizer produced no audio".into());
        }
        let frames = samples.len() / channels.max(1) as usize;
        eprintln!(
            "[tts] render: done, {frames} frames ({}s of audio)",
            frames / sample_rate.max(1) as usize
        );
        let wav = super::wav_bytes(&samples, channels, sample_rate);
        Ok(base64::engine::general_purpose::STANDARD.encode(&wav))
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

    #[cfg(test)]
    mod system_id_tests {
        use super::split_system_id;

        #[test]
        fn splits_premium_system_id() {
            let (locale, name) = split_system_id("com.apple.voice.premium.en-GB.Malcolm");
            assert_eq!(locale.as_deref(), Some("en-GB"));
            assert_eq!(name.as_deref(), Some("Malcolm"));
        }

        #[test]
        fn splits_eloquence_system_id() {
            let (locale, name) = split_system_id("com.apple.eloquence.en-US.Eddy");
            assert_eq!(locale.as_deref(), Some("en-US"));
            assert_eq!(name.as_deref(), Some("Eddy"));
        }

        #[test]
        fn rejects_garbage_gracefully() {
            assert_eq!(split_system_id(""), (None, None));
            let (locale, name) = split_system_id("not-a-voice-id");
            assert_eq!(locale, None);
            assert_eq!(name.as_deref(), Some("not-a-voice-id"));
        }
    }

    #[cfg(test)]
    mod aiff_tests {
        use super::{aiff_samples, extended80_to_u32};

        /// Minimal AIFF-C: mono `twos` 16-bit at 22050 Hz (the exact
        /// 80-bit rate bytes `say` emits) with three known samples.
        fn fixture() -> Vec<u8> {
            let mut out = Vec::new();
            out.extend_from_slice(b"FORM");
            out.extend_from_slice(&0u32.to_be_bytes()); // patched below
            out.extend_from_slice(b"AIFC");
            out.extend_from_slice(b"COMM");
            out.extend_from_slice(&22u32.to_be_bytes());
            out.extend_from_slice(&1i16.to_be_bytes()); // channels
            out.extend_from_slice(&3u32.to_be_bytes()); // frames
            out.extend_from_slice(&16i16.to_be_bytes()); // bits
            out.extend_from_slice(&[0x40, 0x0d, 0xac, 0x44, 0, 0, 0, 0, 0, 0]); // 22050
            out.extend_from_slice(b"twos");
            out.extend_from_slice(b"SSND");
            out.extend_from_slice(&14u32.to_be_bytes());
            out.extend_from_slice(&0u32.to_be_bytes()); // offset
            out.extend_from_slice(&0u32.to_be_bytes()); // blocksize
            out.extend_from_slice(&(-32768i16).to_be_bytes());
            out.extend_from_slice(&32767i16.to_be_bytes());
            out.extend_from_slice(&0i16.to_be_bytes());
            let form_size = (out.len() - 8) as u32;
            out[4..8].copy_from_slice(&form_size.to_be_bytes());
            out
        }

        #[test]
        fn parses_say_output() {
            let (samples, channels, rate) = aiff_samples(&fixture()).unwrap();
            assert_eq!(channels, 1);
            assert_eq!(rate, 22050);
            assert_eq!(samples.len(), 3);
            assert!((samples[0] - -1.0).abs() < 1e-6);
            assert!((samples[1] - 32767.0 / 32768.0).abs() < 1e-6);
            assert_eq!(samples[2], 0.0);
        }

        #[test]
        fn rejects_non_audio() {
            assert!(aiff_samples(&[]).is_err());
            assert!(aiff_samples(b"RIFF....WAVEfmt ").is_err());
            let mut bad = fixture();
            bad[8..12].copy_from_slice(b"XXXX");
            assert!(aiff_samples(&bad).is_err());
        }

        #[test]
        fn extended80_basics() {
            assert_eq!(
                extended80_to_u32(&[0x40, 0x0d, 0xac, 0x44, 0, 0, 0, 0, 0, 0]),
                Some(22050)
            );
            assert_eq!(extended80_to_u32(&[0; 10]), Some(0));
            assert_eq!(
                extended80_to_u32(&[0x7f, 0xff, 0, 0, 0, 0, 0, 0, 0, 0]),
                None
            );
        }
    }
}

/// Encode interleaved `f32` samples (`channels` per frame) as 16-bit PCM
/// WAV bytes. Pure function — unit-tested below, shared by the render
/// command. A zero channel count is treated as mono; a sample count that
/// is not a whole number of frames drops the trailing partial frame.
pub fn wav_bytes(interleaved: &[f32], channels: u16, sample_rate: u32) -> Vec<u8> {
    let channels = channels.max(1);
    let frames = (interleaved.len() / channels as usize) as u32;
    let data_bytes = frames * channels as u32 * 2;
    let mut out = Vec::with_capacity(44 + data_bytes as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&(sample_rate * channels as u32 * 2).to_le_bytes()); // byte rate
    out.extend_from_slice(&(channels * 2).to_le_bytes()); // block align
    out.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_bytes.to_le_bytes());
    for (i, &sample) in interleaved.iter().enumerate() {
        if i as u32 >= frames * channels as u32 {
            break;
        }
        let quantized = (sample.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        out.extend_from_slice(&quantized.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod wav_tests {
    use super::wav_bytes;

    fn header(bytes: &[u8]) -> (u32, u16, u32) {
        let rate = u32::from_le_bytes(bytes[24..28].try_into().unwrap());
        let channels = u16::from_le_bytes(bytes[22..24].try_into().unwrap());
        let data = u32::from_le_bytes(bytes[40..44].try_into().unwrap());
        (rate, channels, data)
    }

    #[test]
    fn encodes_known_samples() {
        let wav = wav_bytes(&[0.0, 1.0, -1.0, 0.5], 1, 8000);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(header(&wav), (8000, 1, 8));
        assert_eq!(&wav[44..], &[0x00, 0x00, 0xFF, 0x7F, 0x01, 0x80, 0x00, 0x40]);
    }

    #[test]
    fn clamps_out_of_range_samples() {
        let wav = wav_bytes(&[2.0, -2.0], 1, 44100);
        assert_eq!(&wav[44..], &[0xFF, 0x7F, 0x01, 0x80]);
    }

    #[test]
    fn stereo_interleaves_and_sizes_correctly() {
        let wav = wav_bytes(&[0.0, 0.0, 0.0, 0.0], 2, 22050);
        assert_eq!(header(&wav), (22050, 2, 8));
        assert_eq!(wav.len(), 44 + 8);
    }

    #[test]
    fn empty_input_is_a_valid_empty_wav() {
        let wav = wav_bytes(&[], 1, 44100);
        assert_eq!(wav.len(), 44);
        assert_eq!(header(&wav), (44100, 1, 0));
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

/// Render `text` to a WAV file without playing it, for the per-message
/// download button. Same voice pick and rate as `tts_speak`, so the file
/// sounds like the readback it came from. Returns the WAV base64-encoded
/// (the invoke bridge has no binary path). Blocks until the synthesizer
/// finishes or a generous timeout fires.
#[tauri::command]
pub fn tts_render(
    app: AppHandle,
    text: String,
    lang: String,
    voice: Option<String>,
) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    return imp::render(&app, text, lang, voice);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, text, lang, voice);
        return Err("native TTS requires macOS".into());
    }
}

/// Save rendered WAV bytes (base64, from `tts_render`) into the user's
/// Downloads folder — the shell leg of the per-message download icon. A
/// WebView blob download is cancelled when no download handler is
/// registered, so the bytes go through here instead. Uniquifies like a
/// browser (`name (1).wav`). Returns the saved file name.
#[tauri::command]
pub fn tts_save_audio(name: String, wav_base64: String) -> Result<String, String> {
    use base64::Engine as _;
    let stem = name.replace('\\', "/");
    let stem = stem.rsplit('/').next().unwrap_or(&stem).trim();
    let stem = stem.trim_matches(|c| c == '.' || c == ' ');
    if stem.is_empty() {
        return Err("empty file name".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(wav_base64.trim())
        .map_err(|e| e.to_string())?;
    let dir = dirs::download_dir().ok_or("no Downloads folder found")?;
    let (base, ext) = stem
        .rsplit_once('.')
        .map(|(b, e)| (b, format!(".{e}")))
        .unwrap_or((stem, String::new()));
    // Claim the destination atomically (`create_new` fails when the name
    // is taken): an exists-then-write check races a second simultaneous
    // save into silently overwriting the first file.
    let mut counter = 0;
    let dest = loop {
        let candidate = if counter == 0 {
            dir.join(format!("{base}{ext}"))
        } else {
            dir.join(format!("{base} ({counter}){ext}"))
        };
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(mut file) => {
                use std::io::Write as _;
                file.write_all(&bytes).map_err(|e| e.to_string())?;
                break candidate;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                counter += 1;
            }
            Err(e) => return Err(e.to_string()),
        }
    };
    dest.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.to_string())
        .ok_or_else(|| "could not name saved file".into())
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
