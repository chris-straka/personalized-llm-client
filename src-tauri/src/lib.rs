// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

#[cfg(all(target_os = "macos", debug_assertions))]
mod dev_icon;
mod keyboard;
#[cfg(desktop)]
mod menu;
mod tts;

/// macOS Keychain (via the `keyring` crate) backing for API keys.
/// Service name matches the Tauri bundle identifier.
const KEYCHAIN_SERVICE: &str = "studio.ccez.app";

/// Read a secret; `None` when nothing is stored under `account`.
#[tauri::command]
fn keychain_get(account: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &account).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Write (create or replace) a secret.
#[tauri::command]
fn keychain_set(account: String, secret: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &account).map_err(|e| e.to_string())?;
    entry.set_password(&secret).map_err(|e| e.to_string())
}

/// Open System Settings at the Accessibility pane, where voice downloads
/// live (Read & Speak → System Voice → Manage Voices). Uses the `open` CLI
/// directly: no plugin scope to misconfigure, and opening Settings needs no
/// user permission. No public API goes deeper (sub-anchors are swallowed),
/// so the UI always prints the in-pane path alongside.
#[tauri::command]
fn open_voice_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        const URL: &str = "x-apple.systempreferences:com.apple.preference.universalaccess";
        let status = std::process::Command::new("open")
            .arg(URL)
            .status()
            .map_err(|e| e.to_string())?;
        return if status.success() {
            Ok(())
        } else {
            Err("System Settings did not open".into())
        };
    }
    #[cfg(not(target_os = "macos"))]
    {
        return Err("opening System Settings requires macOS".into());
    }
}

/// Delete a secret; missing entries are not an error.
#[tauri::command]
fn keychain_delete(account: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &account).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Install a default TLS crypto provider (ring). Tauri core's mobile-dev
/// protocol handler builds a reqwest client to proxy the dev server and
/// `build().unwrap()`s it; reqwest 0.13 panics without a provider even for
/// plain HTTP, and core only installs one on its HTTPS path. Without this
/// the app SIGABRTs ~2s after launch on Android dev builds.
fn install_tls_provider() {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_tls_provider();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            keychain_get,
            keychain_set,
            keychain_delete,
            open_voice_settings,
            keyboard::current_input_source,
            tts::tts_supported,
            tts::tts_speak,
            tts::tts_stop,
            tts::tts_voices,
            tts::tts_identify_lang
        ])
        .setup(|_app| {
            // Dev-only: shrink the oversized runtime Dock tile (see dev_icon).
            #[cfg(all(target_os = "macos", debug_assertions))]
            if let Some(window) = tauri::Manager::get_webview_window(_app.handle(), "main") {
                dev_icon::watch(window);
            }
            // Native menu bar (desktop only; mobile has no menu bar).
            #[cfg(desktop)]
            _app.set_menu(menu::build(_app.handle())?)?;
            Ok(())
        });
    // App-menu clicks, desktop only: mobile has no menu bar, and
    // Builder::on_menu_event itself is desktop-gated in Tauri 2.11.
    #[cfg(desktop)]
    let builder = builder.on_menu_event(|app, event| {
        menu::forward(app, event.id().as_ref());
    });
    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
