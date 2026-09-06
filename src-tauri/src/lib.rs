// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            keychain_get,
            keychain_set,
            keychain_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
