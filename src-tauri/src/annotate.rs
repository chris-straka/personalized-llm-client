//! External-text bridge for the "Annotate" system menu entries.
//!
//! Android exposes the app in the OS text-selection menu
//! (`ACTION_PROCESS_TEXT` via the AnnotateAction manifest alias —
//! see `MainActivity.kt`, which forwards alias launches into the
//! singleTask instance). Shares arrive as native calls into this
//! module, which forwards them as the `annotate-external` window event
//! the frontend listens for. The web annotate row stays untouched:
//! native entries are an additional trigger, never a replacement.
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

use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();

/// Cold-start parking: a PROCESS_TEXT tap while the app is dead lands
/// in Activity.onCreate before setup captures the handle, so there is
/// nobody to emit to yet. The latest such share waits here until the
/// frontend drains it after registering its listener.
static PENDING: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn pending_slot() -> &'static Mutex<Option<String>> {
    PENDING.get_or_init(|| Mutex::new(None))
}

fn lock_slot() -> std::sync::MutexGuard<'static, Option<String>> {
    pending_slot().lock().unwrap_or_else(|e| e.into_inner())
}

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
    match APP.get() {
        Some(app) => {
            let _ = app.emit("annotate-external", ExternalPayload { text });
        }
        // No handle yet (cold start): park it for the drain below.
        None => {
            if let Some(text) = text {
                *lock_slot() = Some(text);
            }
        }
    }
}

/// Re-emit parked cold-start text, if any. Invoked once by the
/// frontend after its `annotate-external` listener is registered;
/// takes (clears) so a share is never delivered twice.
#[tauri::command]
pub fn drain_pending_external(app: AppHandle) {
    if let Some(text) = lock_slot().take() {
        let _ = app.emit("annotate-external", ExternalPayload { text: Some(text) });
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

    #[test]
    fn parks_text_before_remember() {
        // Unit tests never call remember (it needs a real handle),
        // so APP is unset and emit must park instead of dropping.
        super::emit(Some("  hello  ".into()));
        assert_eq!(super::lock_slot().take().as_deref(), Some("  hello  "));
    }
}
