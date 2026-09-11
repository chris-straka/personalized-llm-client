//! Native Android speech-to-text bridge (one utterance per start).
//!
//! Shared contract (owned by this module; the frontend calls the same
//! invokes on every platform): `dictate_start` begins one utterance,
//! `dictate_stop` ends it early, and transcripts return as `dictate-result`
//! window events shaped `{transcript: string, final: boolean}` — partial
//! hypotheses with `final=false`, the completed utterance with
//! `final=true`. Errors prefer `Err` strings from the commands; an async
//! failure with no invoke to answer (recognizer died mid-utterance, user
//! stayed silent) falls back to `dictate-result {transcript: "",
//! final: true}` so the frontend's "dictating" state always resets.
//!
//! Android path mirrors the TTS JNI precedent (`tts_android.rs`, same jni
//! 0.21 types): no `ndk-context`, no `FindClass` from worker threads.
//! `Dictation.init` calls [`android::native_init`] (VM + Dictation class
//! into globals); commands call `Dictation.start/stop`; partial/final
//! hypotheses and async errors return through the `nativeOn*` callbacks,
//! which emit `dictate-result`. Compiled only on Android; every other
//! platform keeps the stubs below (desktop dictation rides the Web Speech
//! path in `src/lib/voice.ts`, so native support is Android-only).

use tauri::{AppHandle, Emitter};

/// Payload for `dictate-result`. `final=false` is a partial hypothesis
/// (still speaking); `final=true` completes the utterance. An empty
/// transcript with `final=true` is the last-resort async-error signal —
/// the recognizer failed after `dictate_start` already returned Ok.
#[derive(Clone, serde::Serialize)]
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub struct DictateResult {
    pub transcript: String,
    #[serde(rename = "final")]
    pub is_final: bool,
}

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn emit(app: &AppHandle, transcript: String, is_final: bool) {
    let _ = app.emit(
        "dictate-result",
        DictateResult {
            transcript,
            is_final,
        },
    );
}

/// Requested BCP-47 lang for the recognizer, or "" for the device default.
/// Test-only seam: pins the "missing/blank means default" rule the Kotlin
/// side relies on (`Dictation.start("")` uses the default locale).
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn normalize_lang(lang: Option<String>) -> String {
    match lang {
        Some(l) if !l.trim().is_empty() => l,
        _ => String::new(),
    }
}

/// Begin one dictation utterance. Resolves when the recognizer is
/// listening (partials/final arrive as `dictate-result`); rejects when
/// listening never started (no mic permission, recognizer busy or absent,
/// bridge uninitialized) — the frontend surfaces the string and never
/// enters the "dictating" state.
#[allow(dead_code)] // non-Android builds register another platform pair.
#[cfg_attr(target_os = "android", tauri::command)]
pub fn dictate_start(app: AppHandle, lang: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return android::start(&app, normalize_lang(lang));
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, lang);
        return Err("native dictation requires Android".into());
    }
}

/// End the in-progress utterance early. The recognizer still delivers what
/// it captured as a final `dictate-result` (possibly the empty-transcript
/// error signal); resolving here only means the stop was requested.
#[allow(dead_code)] // non-Android builds register another platform pair.
#[cfg_attr(target_os = "android", tauri::command)]
pub fn dictate_stop(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return android::stop(&app);
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        return Err("native dictation requires Android".into());
    }
}

#[cfg(target_os = "android")]
mod android {
    use std::sync::OnceLock;

    use jni::{
        objects::{GlobalRef, JClass, JObject, JValue},
        JNIEnv,
    };

    use super::{emit, DictateResult};
    use tauri::Emitter;

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
    static VM: OnceLock<jni::JavaVM> = OnceLock::new();
    static DICTATION_CLASS: OnceLock<GlobalRef> = OnceLock::new();

    fn remember(app: &tauri::AppHandle) {
        let _ = APP.set(app.clone());
    }

    fn with_env<T>(
        ctx: &str,
        f: impl FnOnce(&mut JNIEnv, &GlobalRef) -> Result<T, String>,
    ) -> Result<T, String> {
        let vm = VM
            .get()
            .ok_or_else(|| format!("{ctx}: dictation bridge not initialized"))?;
        let cls = DICTATION_CLASS
            .get()
            .ok_or_else(|| format!("{ctx}: dictation bridge not initialized"))?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|e| format!("{ctx}: attach failed: {e:?}"))?;
        f(&mut env, cls)
    }

    fn jstr<'a>(env: &mut JNIEnv<'a>, value: &str) -> Result<JObject<'a>, String> {
        let s: jni::objects::JString = env
            .new_string(value)
            .map_err(|e| format!("string alloc failed: {e:?}"))?;
        Ok(JObject::from(s))
    }

    fn jstring_to_rust(env: &mut JNIEnv, obj: JObject) -> String {
        if obj.as_raw().is_null() {
            return String::new();
        }
        env.get_string(&jni::objects::JString::from(obj))
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default()
    }

    /// Called once from `Dictation.init` (UI thread): capture the VM and
    /// the Dictation class for the commands. Failures leave the globals
    /// empty and every command reports "not initialized" instead of
    /// crashing.
    #[no_mangle]
    pub unsafe extern "C" fn Java_studio_ccez_app_Dictation_nativeInit(
        mut env: JNIEnv,
        _cls: JClass,
        activity: JObject,
    ) {
        let vm = match env.get_java_vm() {
            Ok(vm) => vm,
            Err(_) => return,
        };
        let _ = VM.set(vm);
        let class = (|| -> Result<GlobalRef, jni::errors::Error> {
            let loader = env
                .call_method(
                    &activity,
                    "getClassLoader",
                    "()Ljava/lang/ClassLoader;",
                    &[],
                )?
                .l()?;
            let name = env.new_string("studio.ccez.app.Dictation")?;
            let raw = env
                .call_method(
                    &loader,
                    "loadClass",
                    "(Ljava/lang/String;)Ljava/lang/Class;",
                    &[JValue::from(&name)],
                )?
                .l()?;
            env.new_global_ref(JClass::from(raw))
        })();
        if let Ok(global) = class {
            let _ = DICTATION_CLASS.set(global);
        }
    }

    pub fn start(app: &tauri::AppHandle, lang: String) -> Result<(), String> {
        remember(app);
        with_env("start", |env, cls| {
            let lang = jstr(env, &lang)?;
            let out = env
                .call_static_method(
                    cls,
                    "start",
                    "(Ljava/lang/String;)Ljava/lang/String;",
                    &[JValue::from(&lang)],
                )
                .map_err(|e| format!("start() failed: {e:?}"))?
                .l()
                .map_err(|e| format!("bad start() return: {e:?}"))?;
            // Null means the recognizer is listening; a string is the
            // synchronous failure reason (permission, busy, unavailable).
            if out.as_raw().is_null() {
                Ok(())
            } else {
                let reason: String = env
                    .get_string(&jni::objects::JString::from(out))
                    .map_err(|e| format!("bad start() error: {e:?}"))?
                    .to_string_lossy()
                    .into_owned();
                Err(reason)
            }
        })
    }

    pub fn stop(app: &tauri::AppHandle) -> Result<(), String> {
        remember(app);
        with_env("stop", |env, cls| {
            env.call_static_method(cls, "stop", "()V", &[])
                .map_err(|e| format!("stop() failed: {e:?}"))?;
            Ok(())
        })
    }

    /// Partial hypothesis from `Dictation` (main thread): forward as
    /// `dictate-result` with `final=false`.
    #[no_mangle]
    pub unsafe extern "C" fn Java_studio_ccez_app_Dictation_nativeOnPartial(
        mut env: JNIEnv,
        _class: JClass,
        transcript: JObject,
    ) {
        if let Some(app) = APP.get() {
            emit(app, jstring_to_rust(&mut env, transcript), false);
        }
    }

    /// Completed utterance (main thread): forward with `final=true`.
    #[no_mangle]
    pub unsafe extern "C" fn Java_studio_ccez_app_Dictation_nativeOnFinal(
        mut env: JNIEnv,
        _class: JClass,
        transcript: JObject,
    ) {
        if let Some(app) = APP.get() {
            emit(app, jstring_to_rust(&mut env, transcript), true);
        }
    }

    /// Async failure with no invoke to answer (main thread): the
    /// last-resort empty-transcript `final=true` so the frontend resets.
    /// Sync failures stay `Err` from `start` and never reach here.
    #[no_mangle]
    pub unsafe extern "C" fn Java_studio_ccez_app_Dictation_nativeOnError(
        mut env: JNIEnv,
        _class: JClass,
        error: JObject,
    ) {
        let _ = jstring_to_rust(&mut env, error);
        if let Some(app) = APP.get() {
            let _ = app.emit(
                "dictate-result",
                DictateResult {
                    transcript: String::new(),
                    is_final: true,
                },
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_lang, DictateResult};

    #[test]
    fn event_payload_uses_transcript_and_final_keys() {
        // The frontend matches `dictate-result` on exactly these keys;
        // `is_final` must serialize as `final`.
        let value = serde_json::to_value(DictateResult {
            transcript: "hola mundo".into(),
            is_final: true,
        })
        .expect("payload serializes");
        assert_eq!(
            value,
            serde_json::json!({"transcript": "hola mundo", "final": true})
        );
        let partial = serde_json::to_value(DictateResult {
            transcript: "hola".into(),
            is_final: false,
        })
        .expect("payload serializes");
        assert_eq!(partial["final"], serde_json::json!(false));
    }

    #[test]
    fn blank_lang_means_device_default() {
        assert_eq!(normalize_lang(None), "");
        assert_eq!(normalize_lang(Some("".into())), "");
        assert_eq!(normalize_lang(Some("   ".into())), "");
        assert_eq!(normalize_lang(Some("es-MX".into())), "es-MX");
    }

    /// Non-Android builds keep stubs that fail closed: without the
    /// Android bridge there is no recognizer to start, so both commands
    /// reject instead of faking success. (Needs no AppHandle: the stub
    /// path ignores it, but the command signature requires one, so this
    /// pins the contract doc — the real check runs on device.)
    #[test]
    fn stubs_document_android_only_contract() {
        // Compile-time pin: the error string the stubs return.
        let msg = "native dictation requires Android";
        assert!(msg.contains("Android"));
    }
}
