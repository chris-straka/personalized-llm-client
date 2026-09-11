//! Windows dictation via `Windows.Media.SpeechRecognition`.
//!
//! Shared contract (mirrors the TTS bridge in `tts.rs`): the Tauri commands
//! `dictate_start` (begins one utterance) and `dictate_stop` (ends early)
//! return `Result<_, String>` — errors prefer `Err` strings. Window event
//! `dictate-result` carries `{transcript: string, final: boolean}`:
//! interim hypotheses with `final=false`, the completed utterance with
//! `final=true`. An empty-transcript `final=true` event is emitted only as a
//! last resort when the session fails after `dictate_start` already returned
//! `Ok` (there is no `Err` channel left at that point).
//!
//! Platform gating follows `tts.rs`: the WinRT engine lives in `imp` behind
//! `cfg(target_os = "windows")`. Every other platform gets commands that
//! report "requires Windows". The pure mapping helpers below (`join_…`,
//! `pick_…`, `should_…`) compile everywhere and are unit-tested on any host.
//!
//! Packaging caveat (verified against Microsoft Learn, not on-device): the
//! `Windows.Media.SpeechRecognition` APIs require MSIX package identity —
//! "Unpackaged apps cannot use these APIs." A Tauri NSIS bundle is an
//! unpackaged Win32 app (Tauri v2 bundle targets are app/appimage/deb/dmg/
//! msi/nsis/rpm/updater — no MSIX), so recognizer construction is expected
//! to fail there today. That failure surfaces as an `Err` string naming
//! package identity and the mic-privacy settings; if the app ever gains
//! package identity (MSIX/sparse package), the same code path lights up
//! with no code change. Mic consent itself needs no manifest entry for
//! unpackaged apps — it is the OS-level Settings → Privacy → Microphone
//! ("Let desktop apps access your microphone") switch, plus the
//! Settings → Privacy → Speech ("Online speech recognition") toggle for
//! dictation grammars.

#![allow(dead_code)] // Windows-only shim: stubs compile everywhere, real code runs on Windows.
use tauri::AppHandle;

/// Payload for the `dictate-result` window event.
#[derive(Clone, serde::Serialize, Debug, PartialEq)]
pub struct DictateResult {
    pub transcript: String,
    pub r#final: bool,
}

/// Append one accepted result chunk to the running transcript. Pure:
/// blank chunks add nothing, otherwise a single space joins.
pub fn join_transcript(existing: &str, chunk: &str) -> String {
    let chunk = chunk.trim();
    if chunk.is_empty() {
        return existing.to_string();
    }
    if existing.trim().is_empty() {
        return chunk.to_string();
    }
    format!("{} {chunk}", existing.trim_end())
}

/// Whether a hypothesis/result text is worth forwarding. Pure: anything
/// that is not blank after trimming counts.
pub fn should_append(text: &str) -> bool {
    !text.trim().is_empty()
}

/// Normalize a BCP-47 tag for comparison: lowercase, `_` → `-`.
fn normalize_tag(tag: &str) -> String {
    tag.trim().replace('_', "-").to_lowercase()
}

/// Pick the recognizer language tag for a requested locale out of the
/// tags the system topic language list reports. Exact match wins,
/// otherwise the first tag sharing the primary language (`en` for
/// `en-GB`); None means "use the system default recognizer". Pure.
pub fn pick_recognizer_tag(requested: Option<&str>, supported: &[String]) -> Option<String> {
    let wanted = normalize_tag(requested.filter(|s| !s.trim().is_empty())?);
    if let Some(hit) = supported.iter().find(|t| normalize_tag(t) == wanted) {
        return Some(hit.clone());
    }
    let primary = wanted.split('-').next().unwrap_or(&wanted);
    supported
        .iter()
        .find(|t| {
            let n = normalize_tag(t);
            n == *primary || n.starts_with(&format!("{primary}-"))
        })
        .cloned()
}

/// Rejection reason when `dictate_start` fires while a session is active.
/// Pure so the single-utterance rule is pinned by test.
pub fn start_rejected(active: bool) -> Option<&'static str> {
    if active {
        Some("dictation already in progress — call dictate_stop first")
    } else {
        None
    }
}

/// Begins one dictation utterance. Returns once listening has started;
/// partial (`final=false`) and final (`final=true`) transcripts arrive as
/// `dictate-result` window events.
#[cfg_attr(target_os = "windows", tauri::command)]
pub fn dictate_start(app: AppHandle, lang: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return imp::start(&app, lang);
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, lang);
        return Err("dictation requires Windows".into());
    }
}

/// Ends the active utterance early; the accumulated transcript is still
/// delivered as a `final=true` event. No-op when nothing is active.
#[cfg_attr(target_os = "windows", tauri::command)]
pub fn dictate_stop(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return imp::stop(&app);
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        return Err("dictation requires Windows".into());
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{channel, Sender},
        Arc, Mutex, OnceLock,
    };

    use tauri::{AppHandle, Emitter};
    use windows::{
        core::{Ref, Result as WinResult, HSTRING},
        Foundation::TypedEventHandler,
        Globalization::Language,
        Media::SpeechRecognition::{
            SpeechContinuousRecognitionCompletedEventArgs,
            SpeechContinuousRecognitionResultGeneratedEventArgs,
            SpeechContinuousRecognitionSession, SpeechRecognitionHypothesisGeneratedEventArgs,
            SpeechRecognitionResultStatus, SpeechRecognizer, SpeechRecognizerState,
        },
        Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED},
    };

    use super::{
        join_transcript, pick_recognizer_tag, should_append, start_rejected, DictateResult,
    };

    /// One utterance at a time; the worker owns the recognizer.
    static ACTIVE: AtomicBool = AtomicBool::new(false);
    static STOP_TX: OnceLock<Mutex<Option<Sender<Wake>>>> = OnceLock::new();

    fn stop_box() -> &'static Mutex<Option<Sender<Wake>>> {
        STOP_TX.get_or_init(|| Mutex::new(None))
    }

    enum Wake {
        /// `dictate_stop` from the frontend.
        UserStop,
        /// The session ended itself (timeout, error, end-of-speech).
        Completed(SpeechRecognitionResultStatus),
    }

    pub fn start(app: &AppHandle, lang: Option<String>) -> Result<(), String> {
        if let Some(reason) = start_rejected(ACTIVE.load(Ordering::SeqCst)) {
            return Err(reason.into());
        }
        ACTIVE.store(true, Ordering::SeqCst);
        let app = app.clone();
        std::thread::Builder::new()
            .name("ccez-dictate".into())
            .spawn(move || run_session(&app, lang.as_deref()))
            .map_err(|e| {
                ACTIVE.store(false, Ordering::SeqCst);
                format!("dictation thread failed to start: {e}")
            })?;
        Ok(())
    }

    pub fn stop(_app: &AppHandle) -> Result<(), String> {
        if !ACTIVE.load(Ordering::SeqCst) {
            return Ok(());
        }
        let tx = stop_box()
            .lock()
            .map_err(|e| format!("dictation state lock poisoned: {e}"))?
            .clone();
        if let Some(tx) = tx {
            let _ = tx.send(Wake::UserStop);
        }
        Ok(())
    }

    /// Last-resort error path: `dictate_start` already returned `Ok`, so no
    /// `Err` channel remains — log and close the utterance with an empty
    /// final event per the shared contract.
    fn fail(app: &AppHandle, ctx: &str, err: impl std::fmt::Display) {
        ACTIVE.store(false, Ordering::SeqCst);
        eprintln!("[dictate] {ctx}: {err}");
        let _ = app.emit(
            "dictate-result",
            DictateResult {
                transcript: String::new(),
                r#final: true,
            },
        );
    }

    fn emit_final(app: &AppHandle, transcript: String) {
        ACTIVE.store(false, Ordering::SeqCst);
        let _ = app.emit(
            "dictate-result",
            DictateResult {
                transcript,
                r#final: true,
            },
        );
    }

    /// Tags the system dictation topic supports, for [`pick_recognizer_tag`].
    fn supported_tags() -> Vec<String> {
        SpeechRecognizer::SupportedTopicLanguages()
            .map(|view| {
                view.into_iter()
                    .filter_map(|lang| lang.LanguageTag().map(|t| t.to_string()).ok())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Default recognizer, or one pinned to `lang` when it resolves against
    /// the system topic languages. Construction itself fails without
    /// package identity or mic access — the caller maps that to guidance.
    fn build_recognizer(lang: Option<&str>) -> WinResult<SpeechRecognizer> {
        let wanted = lang.filter(|s| !s.trim().is_empty());
        if let Some(tag) = wanted {
            let supported = supported_tags();
            if let Some(pick) = pick_recognizer_tag(Some(tag), &supported) {
                let language = Language::CreateLanguage(&HSTRING::from(pick.as_str()))?;
                return SpeechRecognizer::Create(&language);
            }
        }
        SpeechRecognizer::new()
    }

    fn describe_winrt(err: &windows::core::Error) -> String {
        format!(
            "{err}. The speech runtime needs MSIX package identity (unavailable in the NSIS build), \
             microphone access (Settings → Privacy → Microphone → “Let desktop apps access your \
             microphone”), and Online speech recognition (Settings → Privacy → Speech) for dictation."
        )
    }

    fn run_session(app: &AppHandle, lang: Option<&str>) {
        // WinRT worker: MTA apartment; `SpeechRecognizer` is agile and its
        // event callbacks arrive on RPC threads, so no message pump needed.
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        struct Uninit;
        impl Drop for Uninit {
            fn drop(&mut self) {
                unsafe {
                    CoUninitialize();
                }
            }
        }
        let _uninit = Uninit;

        if let Err(e) = run_session_inner(app, lang) {
            fail(app, "session", describe_winrt(&e));
        }
    }

    fn run_session_inner(app: &AppHandle, lang: Option<&str>) -> WinResult<()> {
        let recognizer = build_recognizer(lang).map_err(|e| {
            eprintln!("[dictate] recognizer construction failed: {e:?}");
            e
        })?;

        // Constraints must compile before any recognition call, even with
        // the default dictation grammar (no custom constraints added).
        let status = recognizer.CompileConstraintsAsync()?.get()?.Status()?;
        if status != SpeechRecognitionResultStatus::Success {
            // Compilation-level failure, before any audio flowed: close the
            // utterance the contract way so the frontend never hangs
            // "listening" (unreachable packaged, the normal path in NSIS).
            fail(
                app,
                "compile",
                format!("constraint compilation status: {status:?}"),
            );
            return Ok(());
        }

        let session = recognizer.ContinuousRecognitionSession()?;
        let (wake_tx, wake_rx) = channel::<Wake>();
        *stop_box().lock().unwrap_or_else(|e| e.into_inner()) = Some(wake_tx.clone());
        let transcript = Arc::new(Mutex::new(String::new()));

        // Interim hypotheses → partial events (accumulated text + guess).
        // The handler type is annotated: `Param<T>` accepts several shapes,
        // so the closure parameter types would otherwise not infer.
        let hyp_handler: TypedEventHandler<
            SpeechRecognizer,
            SpeechRecognitionHypothesisGeneratedEventArgs,
        > = {
            let app = app.clone();
            let transcript = transcript.clone();
            TypedEventHandler::new(
                move |_sender: Ref<'_, SpeechRecognizer>,
                      args: Ref<'_, SpeechRecognitionHypothesisGeneratedEventArgs>| {
                    if let Some(args) = args.as_ref() {
                        if let Ok(hypothesis) = args.Hypothesis() {
                            if let Ok(text) = hypothesis.Text() {
                                let text = text.to_string();
                                if should_append(&text) {
                                    let shown = transcript
                                        .lock()
                                        .map(|acc| join_transcript(&acc, &text))
                                        .unwrap_or_else(|_| text.clone());
                                    let _ = app.emit(
                                        "dictate-result",
                                        DictateResult {
                                            transcript: shown,
                                            r#final: false,
                                        },
                                    );
                                }
                            }
                        }
                    }
                Ok(())
            })
        };
        let hyp_token = recognizer.HypothesisGenerated(&hyp_handler)?;

        // Final chunks → append + partial events; the closing event is
        // emitted by the stop/completed path below so every utterance ends
        // with exactly one `final=true`.
        let res_handler: TypedEventHandler<
            SpeechContinuousRecognitionSession,
            SpeechContinuousRecognitionResultGeneratedEventArgs,
        > = {
            let app = app.clone();
            let transcript = transcript.clone();
            TypedEventHandler::new(
                move |_sender: Ref<'_, SpeechContinuousRecognitionSession>,
                      args: Ref<'_, SpeechContinuousRecognitionResultGeneratedEventArgs>| {
                if let Some(args) = args.as_ref() {
                    if let Ok(result) = args.Result() {
                        let confident = result
                            .Confidence()
                            .map(|c| {
                                use windows::Media::SpeechRecognition::SpeechRecognitionConfidence as C;
                                matches!(c, C::High | C::Medium)
                            })
                            .unwrap_or(false);
                        if confident {
                            if let Ok(text) = result.Text() {
                                let text = text.to_string();
                                if should_append(&text) {
                                    let shown = transcript
                                        .lock()
                                        .map(|mut acc| {
                                            let joined = join_transcript(&acc, &text);
                                            *acc = joined.clone();
                                            joined
                                        })
                                        .unwrap_or_else(|_| text.clone());
                                    let _ = app.emit(
                                        "dictate-result",
                                        DictateResult {
                                            transcript: shown,
                                            r#final: false,
                                        },
                                    );
                                }
                            }
                        }
                    }
                }
                Ok(())
            })
        };
        let res_token = session.ResultGenerated(&res_handler)?;

        // Session end (stop, timeout, error) → wake the worker, which owns
        // the single closing event.
        let done_handler: TypedEventHandler<
            SpeechContinuousRecognitionSession,
            SpeechContinuousRecognitionCompletedEventArgs,
        > = {
            let wake_tx = wake_tx.clone();
            TypedEventHandler::new(
                move |_sender: Ref<'_, SpeechContinuousRecognitionSession>,
                      args: Ref<'_, SpeechContinuousRecognitionCompletedEventArgs>| {
                let status = args
                    .as_ref()
                    .and_then(|a| a.Status().ok())
                    .unwrap_or(SpeechRecognitionResultStatus::Unknown);
                let _ = wake_tx.send(Wake::Completed(status));
                Ok(())
            })
        };
        let done_token = session.Completed(&done_handler)?;

        if recognizer.State()? != SpeechRecognizerState::Idle {
            teardown(&session, &recognizer, hyp_token, res_token, done_token);
            emit_final(app, String::new());
            return Ok(());
        }
        session.StartAsync()?.get()?;

        match wake_rx.recv() {
            // `dictate_stop`: let pending results flush, then close.
            Ok(Wake::UserStop) => {
                let _ = session.StopAsync()?.get();
                let status = wake_rx
                    .recv_timeout(std::time::Duration::from_secs(5))
                    .map(|w| match w {
                        Wake::Completed(s) => s,
                        Wake::UserStop => SpeechRecognitionResultStatus::Success,
                    })
                    .unwrap_or(SpeechRecognitionResultStatus::Success);
                let _ = status;
                let done = transcript.lock().map(|acc| acc.clone()).unwrap_or_default();
                teardown(&session, &recognizer, hyp_token, res_token, done_token);
                emit_final(app, done);
            }
            // The runtime ended the session itself.
            Ok(Wake::Completed(status)) => {
                let done = transcript.lock().map(|acc| acc.clone()).unwrap_or_default();
                teardown(&session, &recognizer, hyp_token, res_token, done_token);
                if done.trim().is_empty() && status != SpeechRecognitionResultStatus::Success {
                    fail(
                        app,
                        "completed",
                        format!(
                            "recognition ended without transcript: {status:?}. Check microphone access \
                             (Settings → Privacy → Microphone) and Online speech recognition \
                             (Settings → Privacy → Speech)."
                        ),
                    );
                } else {
                    emit_final(app, done);
                }
            }
            // Channel died without a verdict: close rather than hang.
            Err(_) => {
                teardown(&session, &recognizer, hyp_token, res_token, done_token);
                emit_final(app, String::new());
            }
        }
        Ok(())
    }

    /// Unsubscribe (tokens are raw `i64` in windows 0.61) and release the
    /// stop channel. Best-effort: teardown must not fail the closing event.
    fn teardown(
        session: &SpeechContinuousRecognitionSession,
        recognizer: &SpeechRecognizer,
        hyp: i64,
        res: i64,
        done: i64,
    ) {
        let _ = recognizer.RemoveHypothesisGenerated(hyp);
        let _ = session.RemoveResultGenerated(res);
        let _ = session.RemoveCompleted(done);
        *stop_box().lock().unwrap_or_else(|e| e.into_inner()) = None;
    }
}

#[cfg(test)]
mod dictate_tests {
    use super::{
        join_transcript, pick_recognizer_tag, should_append, start_rejected, DictateResult,
    };

    #[test]
    fn event_payload_serializes_with_final_key() {
        let json = serde_json::to_string(&DictateResult {
            transcript: "hello".into(),
            r#final: true,
        })
        .unwrap();
        assert_eq!(json, r#"{"transcript":"hello","final":true}"#);
    }

    #[test]
    fn join_skips_blanks_and_spaces_chunks() {
        assert_eq!(join_transcript("", "hello"), "hello");
        assert_eq!(join_transcript("", "   "), "");
        assert_eq!(join_transcript("hello", "world"), "hello world");
        assert_eq!(join_transcript("hello", "  "), "hello");
        assert_eq!(join_transcript("  ", "world"), "world");
        assert_eq!(join_transcript("hello ", " world "), "hello world");
    }

    #[test]
    fn hypotheses_gate_on_blank_text() {
        assert!(should_append("partial…"));
        assert!(!should_append(""));
        assert!(!should_append("   \n\t "));
    }

    #[test]
    fn picks_exact_tag_case_and_separator_insensitive() {
        let supported = vec!["en-US".to_string(), "de-DE".to_string()];
        assert_eq!(
            pick_recognizer_tag(Some("en-US"), &supported).as_deref(),
            Some("en-US")
        );
        assert_eq!(
            pick_recognizer_tag(Some("en_us"), &supported).as_deref(),
            Some("en-US")
        );
        assert_eq!(
            pick_recognizer_tag(Some("EN-us"), &supported).as_deref(),
            Some("en-US")
        );
    }

    #[test]
    fn falls_back_to_primary_language_then_none() {
        let supported = vec!["en-US".to_string(), "de-DE".to_string()];
        assert_eq!(
            pick_recognizer_tag(Some("en-GB"), &supported).as_deref(),
            Some("en-US")
        );
        assert_eq!(pick_recognizer_tag(Some("fr-FR"), &supported), None);
        assert_eq!(pick_recognizer_tag(None, &supported), None);
        assert_eq!(pick_recognizer_tag(Some("  "), &supported), None);
        let empty: Vec<String> = vec![];
        assert_eq!(pick_recognizer_tag(Some("en-US"), &empty), None);
    }

    #[test]
    fn second_start_is_rejected_while_active() {
        assert_eq!(
            start_rejected(true),
            Some("dictation already in progress — call dictate_stop first")
        );
        assert_eq!(start_rejected(false), None);
    }
}
