//! Dev-only Dock / app-switcher tile fix (macOS).
//!
//! `tauri dev` runs an unbundled binary, so the Cmd+Tab tile comes from the
//! raw `icon.icns` bytes Tauri installs via `setApplicationIconImage` on
//! Ready. That image reports 512x512pt, and the switcher draws it oversized:
//! bigger than its neighbors, burying the focus outline. The shipped bundle
//! is unaffected (IconServices picks the right representation), so this only
//! runs on debug builds: wait for Tauri's icon, then replace it with the same
//! artwork at a tile-sized 128pt.

use objc2::{AllocAnyThread, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSImage};
use objc2_foundation::{NSData, NSSize};

/// Tile size the switcher lays out for; matches neighboring apps.
const TILE_PT: f64 = 128.0;
/// Width above which the installed runtime icon counts as oversized.
const OVERSIZED_PT: f64 = 200.0;
/// Same artwork as the bundle icon, at 256px: crisp on Retina at 128pt.
const ICON_BYTES: &[u8] = include_bytes!("../icons/128x128@2x.png");

fn current_width() -> Option<f64> {
    let mtm = MainThreadMarker::new()?;
    let icon = NSApplication::sharedApplication(mtm).applicationIconImage()?;
    Some(icon.size().width)
}

fn install() {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let data = NSData::with_bytes(ICON_BYTES);
    let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) else {
        return;
    };
    image.setSize(NSSize::new(TILE_PT, TILE_PT));
    unsafe {
        NSApplication::sharedApplication(mtm).setApplicationIconImage(Some(&image));
    }
}

/// Block (on a background thread) until Tauri has installed its oversized
/// icon, then swap in the tile-sized one. Bounded so dev startup can never
/// hang on this; silent unless the swap happens.
pub fn watch(window: tauri::WebviewWindow) {
    std::thread::spawn(move || {
        for _ in 0..100 {
            let (tx, rx) = std::sync::mpsc::channel::<Option<f64>>();
            if window
                .run_on_main_thread(move || {
                    let _ = tx.send(current_width());
                })
                .is_err()
            {
                return;
            }
            match rx.recv_timeout(std::time::Duration::from_millis(200)) {
                Ok(Some(w)) if w > OVERSIZED_PT => {
                    let _ = window.run_on_main_thread(install);
                    eprintln!("[ccez] dev Dock tile resized to {TILE_PT}pt");
                    return;
                }
                _ => std::thread::sleep(std::time::Duration::from_millis(100)),
            }
        }
    });
}
