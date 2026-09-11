//! Native macOS dictation via `SFSpeechRecognizer` (Apple Speech framework).
//!
//! Pure-Rust bindings through `objc2` — no Objective-C is written anywhere
//! in this project. Only the half-dozen selectors this feature needs are
//! declared (a published `objc2-speech` crate also exists, but the surface
//! here is small enough that one module plus the already-locked `block2`
//! dependency covers it).
//!
//! Design: `dictate_start` prompts for speech-recognition permission when
//! needed, routes the microphone through an `AVAudioEngine` tap into a
//! `SFSpeechAudioBufferRecognitionRequest`, and streams progress back to
//! the frontend as `dictate-result` window events carrying
//! `{transcript, final}`. Partials arrive with `final=false`; the completed
//! utterance (or `dictate_stop`, which ends the audio early) delivers the
//! last event with `final=true`. Exactly one session runs at a time.
//!
//! The recognition itself is network-based by default: `Apple's docs note
//! per-device/per-day throttling and a ~1-minute task cap, and
//! `supportsOnDeviceRecognition` is iOS-only API, so on-device recognition
//! is not requested here. `isAvailable` is checked before starting.
//!
//! Crash-safety: calling `requestAuthorization` without the
//! `NSSpeechRecognitionUsageDescription` key (or touching the mic without
//! `NSMicrophoneUsageDescription`) kills the process, and neither key
//! exists under `tauri dev` (the dev binary is not a bundle). Both keys are
//! therefore verified against the main bundle first, and a missing key is a
//! plain `Err` instead of a crash.
//!
//! Compiled only on macOS. Every other platform gets stubs (`dictate_start`
//! reports "unsupported", `dictate_stop` is a no-op success) so the shared
//! command surface registers everywhere, mirroring `tts.rs`.

#![allow(dead_code)] // macOS-only shim: stubs compile everywhere, real code runs on macOS.
use tauri::AppHandle;

/// Payload for the `dictate-result` window event: the current transcript
/// and whether the utterance is complete. Partials carry `final=false`;
/// the completed utterance carries `final=true`. A failed recognition is
/// reported as an empty transcript with `final=true`, and only then.
/// Failures the command can see are returned as `Err` strings instead.
#[derive(Clone, serde::Serialize)]
pub struct DictateResult {
    pub transcript: String,
    /// Serializes to the JSON key `final` (`r#` escapes the reserved word).
    pub r#final: bool,
}

impl DictateResult {
    /// A failed recognition, delivered as an event only as a last resort
    /// (async errors the command has already returned from).
    pub fn failed() -> Self {
        Self {
            transcript: String::new(),
            r#final: true,
        }
    }
}

/// Locale identifier for the recognizer from a BCP-47 tag. Pure:
/// trims, defaults an empty tag to `en-US`, and passes anything else
/// through untouched (`NSLocale` accepts both `en-US` and `en_US`).
pub fn normalize_lang(lang: Option<&str>) -> String {
    match lang.map(str::trim).filter(|s| !s.is_empty()) {
        Some(lang) => lang.to_string(),
        None => "en-US".to_string(),
    }
}

/// Human-readable name for an `SFSpeechRecognizerAuthorizationStatus`
/// code (0 = not determined, 1 = denied, 2 = restricted, 3 = authorized).
/// Pure and unit-tested; unknown codes stay numeric, never panic.
pub fn auth_status_message(status: i64) -> String {
    match status {
        0 => "not determined".to_string(),
        1 => "denied".to_string(),
        2 => "restricted".to_string(),
        3 => "authorized".to_string(),
        _ => format!("unknown ({status})"),
    }
}

/// Human-readable message for a speech-task `NSError`, using the error
/// table in `SFSpeechRecognitionTask.h`. Pure and unit-tested; anything
/// unlisted falls back to the domain/code pair instead of guessing.
pub fn task_error_message(domain: &str, code: i64) -> String {
    let known = match (domain, code) {
        ("kLSRErrorDomain", 102) => Some("speech assets are not installed"),
        ("kLSRErrorDomain", 201) => Some("Siri/Dictation is disabled on this Mac"),
        ("kLSRErrorDomain", 300) => Some("could not initialize the recognizer"),
        ("kLSRErrorDomain", 301) => Some("recognition was cancelled"),
        ("kAFAssistantErrorDomain", 203) => Some("speech recognition failed"),
        ("kAFAssistantErrorDomain", 1100) => Some("another recognition is already active"),
        ("kAFAssistantErrorDomain", 1101 | 1107) => {
            Some("the connection to the speech service broke")
        }
        ("kAFAssistantErrorDomain", 1110) => Some("no speech was recognized"),
        ("kAFAssistantErrorDomain", 1700) => Some("the request is not authorized"),
        _ => None,
    };
    match known {
        Some(msg) => msg.to_string(),
        None => format!("speech recognition failed ({domain} {code})"),
    }
}

/// Begin one dictation utterance in `lang` (BCP-47, e.g. `en-US`;
/// defaults when empty). Returns immediately; transcripts stream back as
/// `dictate-result` events. Errors that are visible synchronously
/// (unsupported language, denied permission, unavailable service) are
/// returned as `Err` strings.
#[cfg_attr(target_os = "macos", tauri::command)]
pub fn dictate_start(app: AppHandle, lang: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return imp::start(&app, lang.as_deref());
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, lang);
        return Err("native dictation requires macOS".into());
    }
}

/// End the active utterance early. The recognizer finishes on the audio
/// captured so far and delivers it as a final (`final=true`)
/// `dictate-result` event. No active utterance is not an error.
#[cfg_attr(target_os = "macos", tauri::command)]
pub fn dictate_stop(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return imp::stop(&app);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        return Ok(());
    }
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::c_long;
    use std::ptr::NonNull;
    use std::sync::{
        mpsc::{channel, Receiver, Sender},
        OnceLock,
    };
    use std::time::Duration;

    use block2::RcBlock;
    use objc2::rc::{Allocated, Retained};
    use objc2::runtime::AnyClass;
    use objc2::{extern_class, extern_conformance, extern_methods, msg_send, ClassType};
    use objc2_avf_audio::{
        AVAudioEngine, AVAudioFormat, AVAudioFrameCount, AVAudioInputNode, AVAudioNodeBus,
        AVAudioPCMBuffer, AVAudioTime,
    };
    use objc2_foundation::{NSBundle, NSError, NSLocale, NSObject, NSObjectProtocol, NSString};
    use tauri::{AppHandle, Emitter};

    use super::{auth_status_message, normalize_lang, task_error_message, DictateResult};

    // Selectors verified against the macOS SDK Speech framework headers
    // (SFSpeechRecognizer.h, SFSpeechRecognitionRequest.h,
    // SFSpeechRecognitionResult.h, SFTranscription.h,
    // SFSpeechRecognitionTask.h).

    extern_class!(
        #[unsafe(super(NSObject))]
        #[derive(Debug, PartialEq, Eq, Hash)]
        pub struct SFSpeechRecognizer;
    );

    extern_conformance!(
        unsafe impl NSObjectProtocol for SFSpeechRecognizer {}
    );

    impl SFSpeechRecognizer {
        extern_methods!(
            #[unsafe(method(authorizationStatus))]
            #[unsafe(method_family = none)]
            pub fn authorization_status() -> c_long;

            #[unsafe(method(requestAuthorization:))]
            #[unsafe(method_family = none)]
            pub fn request_authorization(handler: *mut block2::DynBlock<dyn Fn(c_long)>);

            #[unsafe(method(isAvailable))]
            #[unsafe(method_family = none)]
            pub fn is_available(&self) -> bool;

            #[unsafe(method(recognitionTaskWithRequest:resultHandler:))]
            #[unsafe(method_family = none)]
            pub fn recognition_task(
                &self,
                request: &SFSpeechAudioBufferRecognitionRequest,
                handler: *mut block2::DynBlock<
                    dyn Fn(*mut SFSpeechRecognitionResult, *mut NSError),
                >,
            ) -> Retained<SFSpeechRecognitionTask>;

            #[unsafe(method(initWithLocale:))]
            #[unsafe(method_family = init)]
            pub fn init_with_locale(
                this: Allocated<Self>,
                locale: &NSLocale,
            ) -> Option<Retained<Self>>;
        );
    }

    extern_class!(
        #[unsafe(super(NSObject))]
        #[derive(Debug, PartialEq, Eq, Hash)]
        pub struct SFSpeechAudioBufferRecognitionRequest;
    );

    extern_conformance!(
        unsafe impl NSObjectProtocol for SFSpeechAudioBufferRecognitionRequest {}
    );

    impl SFSpeechAudioBufferRecognitionRequest {
        extern_methods!(
            #[unsafe(method(new))]
            #[unsafe(method_family = new)]
            pub fn new() -> Retained<Self>;

            #[unsafe(method(setShouldReportPartialResults:))]
            #[unsafe(method_family = none)]
            pub fn set_should_report_partial_results(&self, value: bool);

            #[unsafe(method(appendAudioPCMBuffer:))]
            #[unsafe(method_family = none)]
            pub fn append_audio_pcm_buffer(&self, buffer: &AVAudioPCMBuffer);

            #[unsafe(method(endAudio))]
            #[unsafe(method_family = none)]
            pub fn end_audio(&self);
        );
    }

    extern_class!(
        #[unsafe(super(NSObject))]
        #[derive(Debug, PartialEq, Eq, Hash)]
        pub struct SFSpeechRecognitionTask;
    );

    extern_conformance!(
        unsafe impl NSObjectProtocol for SFSpeechRecognitionTask {}
    );

    impl SFSpeechRecognitionTask {
        extern_methods!(
            #[unsafe(method(cancel))]
            #[unsafe(method_family = none)]
            pub fn cancel(&self);

            #[unsafe(method(finish))]
            #[unsafe(method_family = none)]
            pub fn finish(&self);
        );
    }

    extern_class!(
        #[unsafe(super(NSObject))]
        #[derive(Debug, PartialEq, Eq, Hash)]
        pub struct SFSpeechRecognitionResult;
    );

    extern_conformance!(
        unsafe impl NSObjectProtocol for SFSpeechRecognitionResult {}
    );

    impl SFSpeechRecognitionResult {
        extern_methods!(
            #[unsafe(method(bestTranscription))]
            #[unsafe(method_family = none)]
            pub fn best_transcription(&self) -> Retained<SFTranscription>;

            #[unsafe(method(isFinal))]
            #[unsafe(method_family = none)]
            pub fn is_final(&self) -> bool;
        );
    }

    extern_class!(
        #[unsafe(super(NSObject))]
        #[derive(Debug, PartialEq, Eq, Hash)]
        pub struct SFTranscription;
    );

    extern_conformance!(
        unsafe impl NSObjectProtocol for SFTranscription {}
    );

    impl SFTranscription {
        extern_methods!(
            #[unsafe(method(formattedString))]
            #[unsafe(method_family = none)]
            pub fn formatted_string(&self) -> Retained<NSString>;
        );
    }

    /// The one live utterance. Owned exclusively by the worker thread
    /// below: `objc2` deliberately withholds `Send`/`Sync` from foreign
    /// classes, so no `Retained` here ever crosses a thread boundary. The
    /// result-handler block (recognizer queue) and the tap block (audio
    /// thread) only touch what they capture (`AppHandle`, which is
    /// thread-safe, and the request they feed).
    struct LiveSession {
        engine: Retained<AVAudioEngine>,
        input: Retained<AVAudioInputNode>,
        request: Retained<SFSpeechAudioBufferRecognitionRequest>,
        #[allow(dead_code)]
        task: Retained<SFSpeechRecognitionTask>,
    }

    enum Cmd {
        Start {
            lang: String,
            reply: Sender<Result<(), String>>,
        },
        Stop,
        /// The recognition callback saw a final result or an error and
        /// already emitted the closing event; the worker only tears down.
        Finished,
    }

    struct Worker {
        tx: Sender<Cmd>,
    }

    static WORKER: OnceLock<Worker> = OnceLock::new();

    fn worker(app: &AppHandle) -> &'static Worker {
        WORKER.get_or_init(|| {
            let (tx, rx) = channel::<Cmd>();
            let app = app.clone();
            let tx_worker = tx.clone();
            std::thread::Builder::new()
                .name("ccez-dictate".into())
                .spawn(move || run(rx, &app, &tx_worker))
                .expect("dictation worker thread");
            Worker { tx }
        })
    }

    /// Release the mic and drop the session. Never emits: result events
    /// come only from the recognition callback (a partial storm, then one
    /// final or one error), so a racing `dictate_stop` cannot duplicate
    /// the final transcript.
    fn end_session(session: LiveSession, end_audio: bool) {
        unsafe {
            if end_audio {
                session.request.end_audio();
            }
            let _: () = msg_send![&*session.input, removeTapOnBus: 0 as AVAudioNodeBus];
            session.engine.stop();
        }
    }

    fn run(rx: Receiver<Cmd>, app: &AppHandle, tx: &Sender<Cmd>) {
        let mut live: Option<LiveSession> = None;
        for cmd in rx {
            match cmd {
                Cmd::Start { lang, reply } => {
                    if live.is_some() {
                        let _ = reply.send(Err("dictation is already in progress".into()));
                        continue;
                    }
                    match begin(app, tx, &lang) {
                        Ok(session) => {
                            live = Some(session);
                            eprintln!("[dictate] started lang={lang}");
                            let _ = reply.send(Ok(()));
                        }
                        Err(e) => {
                            let _ = reply.send(Err(e));
                        }
                    }
                }
                Cmd::Stop => {
                    if let Some(session) = live.take() {
                        // Signal end-of-audio (the pending task completes
                        // and the callback delivers the final transcript)
                        // while stopping the mic immediately.
                        end_session(session, true);
                        eprintln!("[dictate] stopped early");
                    }
                }
                Cmd::Finished => {
                    if let Some(session) = live.take() {
                        end_session(session, false);
                    }
                }
            }
        }
    }

    /// Both usage-description keys must be in the bundled Info.plist;
    /// without them the OS kills the process on first use, and under
    /// `tauri dev` (no bundle) they are absent by definition.
    fn check_usage_descriptions() -> Result<(), String> {
        let bundle = NSBundle::mainBundle();
        let speech = NSString::from_str("NSSpeechRecognitionUsageDescription");
        let mic = NSString::from_str("NSMicrophoneUsageDescription");
        if bundle.objectForInfoDictionaryKey(&speech).is_none()
            || bundle.objectForInfoDictionaryKey(&mic).is_none()
        {
            return Err("dictation needs NSSpeechRecognitionUsageDescription and NSMicrophoneUsageDescription in the app Info.plist (dictation is unavailable under `tauri dev`)".into());
        }
        Ok(())
    }

    /// `Ok` when recognition is authorized. Prompts once (status 0) and
    /// blocks the invoke thread until the user answers; denied/restricted
    /// stay `Err` so the UI can explain instead of failing silently.
    fn ensure_authorized() -> Result<(), String> {
        const AUTHORIZED: c_long = 3;
        const DENIED: c_long = 1;
        const RESTRICTED: c_long = 2;
        let status = SFSpeechRecognizer::authorization_status();
        if status == AUTHORIZED {
            return Ok(());
        }
        if status == DENIED {
            return Err("speech recognition is denied — allow it in System Settings → Privacy & Security → Speech Recognition".into());
        }
        if status == RESTRICTED {
            return Err("speech recognition is restricted on this device".into());
        }
        let (tx, rx) = std::sync::mpsc::channel::<c_long>();
        let block = RcBlock::new(move |status: c_long| {
            let _ = tx.send(status);
        });
        SFSpeechRecognizer::request_authorization(RcBlock::as_ptr(&block));
        let status = rx
            .recv_timeout(Duration::from_secs(180))
            .map_err(|_| "timed out waiting for speech-recognition permission".to_string())?;
        // The system copied the block on the call above; dropping ours
        // only releases our own retain.
        drop(block);
        if status == AUTHORIZED {
            Ok(())
        } else {
            Err(format!(
                "speech recognition not authorized ({})",
                auth_status_message(status as i64)
            ))
        }
    }

    /// `nil` from `initWithLocale:` means the language has no recognizer
    /// (creation itself falls back to the dictation locale before failing).
    fn make_recognizer(lang: &str) -> Result<Retained<SFSpeechRecognizer>, String> {
        unsafe {
            if AnyClass::get(c"SFSpeechRecognizer").is_none() {
                return Err("speech recognition needs macOS 10.15 or later".into());
            }
            let ident = NSString::from_str(lang);
            let locale = NSLocale::localeWithLocaleIdentifier(&ident);
            let alloc: Allocated<SFSpeechRecognizer> =
                msg_send![SFSpeechRecognizer::class(), alloc];
            SFSpeechRecognizer::init_with_locale(alloc, &locale)
                .ok_or_else(|| format!("speech recognition does not support {lang}"))
        }
    }

    fn emit_result(app: &AppHandle, result: DictateResult) {
        let _ = app.emit("dictate-result", result);
    }

    fn emit_transcript(app: &AppHandle, transcript: String, final_: bool) {
        emit_result(
            app,
            DictateResult {
                transcript,
                r#final: final_,
            },
        );
    }

    pub fn start(app: &AppHandle, lang: Option<&str>) -> Result<(), String> {
        let lang = normalize_lang(lang);
        let (tx, rx) = channel();
        worker(app)
            .tx
            .send(Cmd::Start { lang, reply: tx })
            .map_err(|e| e.to_string())?;
        // The worker prompts for permission when needed, so starting can
        // take as long as the user needs to answer the system dialog.
        rx.recv_timeout(Duration::from_secs(210))
            .map_err(|e| format!("dictation did not start: {e}"))?
    }

    pub fn stop(app: &AppHandle) -> Result<(), String> {
        worker(app).tx.send(Cmd::Stop).map_err(|e| e.to_string())
    }

    /// Build and start one utterance on the worker thread (which then owns
    /// every object — nothing `Retained` leaves this thread).
    fn begin(app: &AppHandle, tx: &Sender<Cmd>, lang: &str) -> Result<LiveSession, String> {
        check_usage_descriptions()?;
        ensure_authorized()?;
        let recognizer = make_recognizer(lang)?;
        if !recognizer.is_available() {
            return Err(
                "speech recognition is unavailable right now (it needs a network connection) — try again later".into(),
            );
        }
        unsafe {
            let engine = AVAudioEngine::new();
            let input = engine.inputNode();
            let request = SFSpeechAudioBufferRecognitionRequest::new();
            // `shouldReportPartialResults` defaults to true; set it
            // explicitly so the streaming contract below holds.
            request.set_should_report_partial_results(true);

            let app_handle = app.clone();
            let done_tx = tx.clone();
            let result_block = RcBlock::new(
                move |result: *mut SFSpeechRecognitionResult, error: *mut NSError| {
                    if !error.is_null() {
                        let error = &*error;
                        let msg =
                            task_error_message(&error.domain().to_string(), error.code() as i64);
                        eprintln!("[dictate] recognition error: {msg}");
                        emit_result(&app_handle, DictateResult::failed());
                        let _ = done_tx.send(Cmd::Finished);
                    } else if !result.is_null() {
                        let result = &*result;
                        let transcript = result.best_transcription().formatted_string().to_string();
                        let final_ = result.is_final();
                        eprintln!(
                            "[dictate] {}: {transcript}",
                            if final_ { "final" } else { "partial" }
                        );
                        emit_transcript(&app_handle, transcript, final_);
                        if final_ {
                            // One utterance per start: a completed
                            // utterance ends the session (the mic stops).
                            let _ = done_tx.send(Cmd::Finished);
                        }
                    }
                },
            );
            let task = recognizer.recognition_task(&request, RcBlock::as_ptr(&result_block));
            // The recognizer copied the block; our retain is released
            // with `result_block` at the end of this scope.
            drop(result_block);

            let tap_request = request.clone();
            let tap = RcBlock::new(
                move |buffer: NonNull<AVAudioPCMBuffer>, _when: NonNull<AVAudioTime>| {
                    tap_request.append_audio_pcm_buffer(buffer.as_ref());
                },
            );
            let format: Retained<AVAudioFormat> =
                msg_send![&*input, outputFormatForBus: 0 as AVAudioNodeBus];
            let _: () = msg_send![
                &*input,
                installTapOnBus: 0 as AVAudioNodeBus,
                bufferSize: 1024 as AVAudioFrameCount,
                format: &*format,
                block: RcBlock::as_ptr(&tap)
            ];
            // The engine copied the tap; our retain is released with
            // `tap` at the end of this scope.
            drop(tap);

            engine.prepare();
            if let Err(error) = engine.startAndReturnError() {
                let _: () = msg_send![&*input, removeTapOnBus: 0 as AVAudioNodeBus];
                return Err(format!(
                    "could not start the microphone: {}",
                    error.localizedDescription()
                ));
            }
            Ok(LiveSession {
                engine,
                input,
                request,
                task,
            })
        }
    }
}

#[cfg(test)]
mod dictate_tests {
    use super::{auth_status_message, normalize_lang, task_error_message, DictateResult};

    #[test]
    fn lang_defaults_and_trims() {
        assert_eq!(normalize_lang(None), "en-US");
        assert_eq!(normalize_lang(Some("")), "en-US");
        assert_eq!(normalize_lang(Some("   ")), "en-US");
        assert_eq!(normalize_lang(Some("en-US")), "en-US");
        assert_eq!(normalize_lang(Some("  de-DE  ")), "de-DE");
        assert_eq!(normalize_lang(Some("zh-CN")), "zh-CN");
    }

    #[test]
    fn auth_codes_have_messages() {
        assert_eq!(auth_status_message(0), "not determined");
        assert_eq!(auth_status_message(1), "denied");
        assert_eq!(auth_status_message(2), "restricted");
        assert_eq!(auth_status_message(3), "authorized");
        assert!(auth_status_message(99).starts_with("unknown"));
    }

    #[test]
    fn task_errors_map_to_guidance() {
        assert!(task_error_message("kLSRErrorDomain", 201).contains("disabled"));
        assert!(task_error_message("kAFAssistantErrorDomain", 1110).contains("no speech"));
        assert!(task_error_message("kAFAssistantErrorDomain", 1700).contains("not authorized"));
        assert!(task_error_message("kAFAssistantErrorDomain", 1107).contains("broke"));
        // Unknown pairs fall back to domain + code, never an empty string.
        let fallback = task_error_message("weird.domain", 42);
        assert!(fallback.contains("weird.domain") && fallback.contains("42"));
    }

    #[test]
    fn result_payload_uses_shared_contract_keys() {
        let partial = DictateResult {
            transcript: "hello".into(),
            r#final: false,
        };
        let value = serde_json::to_value(&partial).expect("serializable");
        assert_eq!(value["transcript"], "hello");
        assert_eq!(value["final"], false);
        let failed = DictateResult::failed();
        let value = serde_json::to_value(&failed).expect("serializable");
        assert_eq!(value["transcript"], "");
        assert_eq!(value["final"], true);
    }
}
