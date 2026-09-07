//! Current macOS keyboard input source (for the voice-language shortcut).
//!
//! Pure-Rust bindings through `objc2` — no Objective-C is written anywhere
//! in this project. The webview cannot see which input source is checked in
//! the input menu (Chromium's layout map is permission-gated and WebKit
//! lacks it entirely), so ⇧⌘Delete asks here and the frontend maps the
//! returned bundle id (e.g. `com.apple.keylayout.US`) to a voice locale.
//!
//! Compiled only on macOS. Every other platform gets a stub returning
//! `None`, and the frontend leaves the voice language unchanged.

use tauri::AppHandle;

#[cfg(target_os = "macos")]
mod imp {
    use std::sync::mpsc::channel;
    use std::time::Duration;

    use objc2::MainThreadMarker;
    use objc2_app_kit::NSTextInputContext;
    use tauri::AppHandle;

    /// Bundle id of the selected keyboard input source, e.g.
    /// `com.apple.keylayout.US`. `None` when there is no current input
    /// context. Runs on the main thread: `currentInputContext` needs it,
    /// and Tauri commands arrive on a worker pool.
    pub fn current_input_source(app: &AppHandle) -> Option<String> {
        let (tx, rx) = channel();
        let _ = app.run_on_main_thread(move || {
            let source = MainThreadMarker::new()
                .and_then(NSTextInputContext::currentInputContext)
                .and_then(|context| context.selectedKeyboardInputSource())
                .map(|id| id.to_string());
            let _ = tx.send(source);
        });
        rx.recv_timeout(Duration::from_secs(2)).ok().flatten()
    }
}

/// Bundle id of the selected keyboard input source, or `None` where the
/// platform (or thread state) cannot provide one.
#[tauri::command]
pub fn current_input_source(app: AppHandle) -> Option<String> {
    #[cfg(target_os = "macos")]
    return imp::current_input_source(&app);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        return None;
    }
}
