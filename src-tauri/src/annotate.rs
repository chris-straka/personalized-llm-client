//! External-text bridge for the "Annotate" system menu entries.
//!
//! Android exposes the app in the OS text-selection menu
//! (`ACTION_PROCESS_TEXT`, plus an in-app `Annotate` action-mode item —
//! see `MainActivity.kt`). Both arrive as native calls into this module,
//! which forwards them as the `annotate-external` window event the
//! frontend listens for. The web annotate row stays untouched: native
//! entries are an additional trigger, never a replacement.
//!
//! Payload shape: `{ "text": string | null }`. `Some` carries text
//! selected OUTSIDE the app (composer prefill); `None` means "annotate
//! the live web selection" (the in-app menu item — the frontend owns
//! the selection, so no text crosses JNI).
//!
//! The event, the payload, and `remember` compile on every platform; only
//! the `#[no_mangle]` entry points are Android-gated (the `jni` crate
//! itself is an Android-only dependency, so JNI paths stay fully
//! qualified inside those fns).

use std::sync::OnceLock;

use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();

/// Capture the handle for later native-triggered emits. Called once
/// from `setup`, before any activity intent can reach the native fns.
pub fn remember(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

/// External selections are user text, not code: trim, drop empties, and
/// cap length so a foreign share can't flood the composer.
pub fn clean_external(text: &str) -> Option<String> {
    const MAX_CHARS: usize = 4000;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(MAX_CHARS).collect())
}

#[derive(Clone, serde::Serialize)]
struct ExternalPayload {
    text: Option<String>,
}

fn emit(text: Option<String>) {
    if let Some(app) = APP.get() {
        let _ = app.emit("annotate-external", ExternalPayload { text });
    }
}

/// Text shared from another app (PROCESS_TEXT). Null/empty shares emit
/// nothing: there is no quote to prefill with.
#[cfg(target_os = "android")]
#[no_mangle]
pub unsafe extern "C" fn Java_studio_ccez_app_MainActivity_nativeOnExternalText(
    mut env: jni::JNIEnv,
    _this: jni::objects::JObject,
    text: jni::objects::JObject,
) {
    let incoming: Option<String> = if text.as_raw().is_null() {
        None
    } else {
        env.get_string(&jni::objects::JString::from(text))
            .ok()
            .map(|s| s.to_string_lossy().into_owned())
            .and_then(|s| clean_external(&s))
    };
    if let Some(text) = incoming {
        emit(Some(text));
    }
}

/// In-app Annotate menu item: no text crosses (the frontend annotates
/// its live web selection, exactly like the web row's button).
#[cfg(target_os = "android")]
#[no_mangle]
pub unsafe extern "C" fn Java_studio_ccez_app_MainActivity_nativeOnAnnotateTrigger(
    _env: jni::JNIEnv,
    _this: jni::objects::JObject,
) {
    emit(None);
}

#[cfg(test)]
mod tests {
    use super::clean_external;

    #[test]
    fn trims_and_keeps_text() {
        assert_eq!(clean_external("  hello  "), Some("hello".into()));
    }

    #[test]
    fn drops_empties() {
        assert_eq!(clean_external(""), None);
        assert_eq!(clean_external("   \n  "), None);
    }

    #[test]
    fn caps_length() {
        let long = "x".repeat(5000);
        let out = clean_external(&long).expect("non-empty");
        assert_eq!(out.chars().count(), 4000);
    }
}
