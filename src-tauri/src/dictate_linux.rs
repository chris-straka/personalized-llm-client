//! Linux dictation: probe + guidance, no OS recognizer to drive.
//!
//! Shared contract (see `dictation.rs`): `dictate_start` begins one
//! utterance, `dictate_stop` ends it early, transcripts return as
//! `dictate-result` window events shaped `{transcript, final}`.
//!
//! Unlike macOS (SFSpeechRecognizer), Windows
//! (`Windows.Media.SpeechRecognition`) and Android (SpeechRecognizer),
//! Linux ships no OS-level speech-recognition API: Speech Dispatcher
//! and espeak are synthesis-only. The free offline recognizers that do
//! exist here (`nerd-dictation`, a Whisper/Vosk wrapper being the most
//! common) are third-party CLIs with no stable IPC to drive, so
//! auto-wiring one would be guessing at a stranger's interface.
//!
//! This module therefore probes `PATH` for the known CLI and reports a
//! `dictate_start` rejection the frontend already understands: the
//! message contains "not supported", so `nativeDictateFallback` routes
//! the caller to the Web Speech path silently (same as iOS today),
//! while the full text tells a Linux user exactly what to install.
//! `dictate_stop` is a no-op success — there is nothing to stop.
//!
//! The `find_recognizer` seam keeps the door open: when a stable local
//! recognizer interface is chosen, `dictate_start` can drive it without
//! changing the command surface. Platform gating mirrors
//! `dictate_windows.rs`: pure helpers compile everywhere and are
//! unit-tested on any host.

#![allow(dead_code)] // Linux-only shim: stubs compile everywhere, real code runs on Linux.
use tauri::AppHandle;

/// Requested BCP-47 lang for the recognizer, or "" for the default.
/// Same rule as the Android bridge (`dictation.rs`): a missing or
/// blank lang means "device default", so callers never branch.
pub fn normalize_lang(lang: Option<&str>) -> String {
    match lang.map(str::trim).filter(|s| !s.is_empty()) {
        Some(lang) => lang.to_string(),
        None => String::new(),
    }
}

/// Basename of the optional third-party recognizer CLI this module
/// looks for. `nerd-dictation` is the most common free offline
/// dictation CLI on Linux (Whisper/Vosk-backed, user-installed).
pub fn recognizer_cli() -> &'static str {
    "nerd-dictation"
}

/// Candidate paths for the recognizer CLI out of a `PATH`-style
/// string, in lookup order. Pure (no filesystem access): the runtime
/// keeps the first candidate that exists. Matches the
/// `candidate_paths` shape in `tts_linux.rs` without depending on it
/// (this module must stay dependency-free for its stub builds).
pub fn recognizer_candidates(path_env: &str) -> Vec<String> {
    let cli = recognizer_cli();
    path_env
        .split(':')
        .filter(|d| !d.is_empty())
        .map(|dir| format!("{dir}/{cli}"))
        .collect()
}

/// `dictate_start` rejection. Always contains "not supported" so the
/// frontend's `nativeDictateFallback` routes to Web Speech; the rest
/// names the way out (install the CLI) or, when it is already
/// installed, why the app still can't drive it. Pure and unit-tested.
pub fn unsupported_message(lang: &str, found: Option<&str>) -> String {
    let _ = lang;
    match found {
        Some(path) => format!(
            "native dictation is not supported on this platform: Linux has no OS speech-recognition API, \
             and the app cannot drive the third-party recognizer at {path} automatically — \
             use browser dictation instead"
        ),
        None => format!(
            "native dictation is not supported on this platform: Linux has no OS speech-recognition API \
             (install `{}` for offline dictation, or use browser dictation)",
            recognizer_cli()
        ),
    }
}

/// Begin one dictation utterance. Always rejects on Linux (see the
/// module docs): the frontend falls back to Web Speech on the
/// "not supported" text.
pub fn dictate_start(app: AppHandle, lang: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return imp::start(&app, lang);
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (app, lang);
        return Err("dictation requires Linux".into());
    }
}

/// End the active utterance early. Always a no-op success on Linux —
/// `dictate_start` never starts anything to stop.
pub fn dictate_stop(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    return imp::stop(&app);
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        return Ok(());
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use super::{normalize_lang, recognizer_candidates, unsupported_message};
    use tauri::AppHandle;

    pub fn start(_app: &AppHandle, lang: Option<String>) -> Result<(), String> {
        let lang = normalize_lang(lang.as_deref());
        // A real PATH hit still rejects (see the module docs), but the
        // message says so exactly; existence is checked, not assumed.
        let path_env = std::env::var("PATH").unwrap_or_default();
        let found = recognizer_candidates(&path_env)
            .into_iter()
            .find(|p| std::fs::metadata(p).is_ok());
        Err(unsupported_message(&lang, found.as_deref()))
    }

    pub fn stop(_app: &AppHandle) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod dictate_linux_tests {
    use super::{normalize_lang, recognizer_candidates, unsupported_message};

    #[test]
    fn blank_lang_means_default() {
        assert_eq!(normalize_lang(None), "");
        assert_eq!(normalize_lang(Some("")), "");
        assert_eq!(normalize_lang(Some("   ")), "");
        assert_eq!(normalize_lang(Some("de-DE")), "de-DE");
    }

    #[test]
    fn probe_lists_the_cli_per_path_dir() {
        assert_eq!(
            recognizer_candidates("/usr/bin:/usr/local/bin:"),
            vec![
                "/usr/bin/nerd-dictation".to_string(),
                "/usr/local/bin/nerd-dictation".to_string(),
            ]
        );
        assert!(recognizer_candidates("").is_empty());
    }

    #[test]
    fn rejection_routes_to_web_fallback() {
        // Contract with the frontend (`nativeDictateFallback`): the
        // message must contain "not supported", with or without the CLI.
        for found in [None, Some("/usr/bin/nerd-dictation")] {
            let msg = unsupported_message("en-US", found);
            assert!(
                msg.to_lowercase().contains("not supported"),
                "fallback contract broken: {msg}"
            );
        }
        assert!(unsupported_message("", None).contains("nerd-dictation"));
    }
}
