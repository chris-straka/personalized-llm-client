import { invoke } from "@tauri-apps/api/core";

/**
 * On-device OCR (Stage: learner OCR): thin invoke wrapper over the Rust
 * `ocr_supported` / `ocr_recognize` commands (`src-tauri/src/ocr.rs`,
 * macOS-only Vision text recognition, `#[cfg]`-gated with stubs
 * elsewhere — same pattern as `nativeTts.ts` / `nativeDictate.ts`).
 *
 * The recognized text comes back as plain selectable text, so callers
 * hand it to the existing pinyin/furigana pipeline (composer insert →
 * message render) with no new rendering path.
 *
 * Every function fails cleanly outside the Tauri shell (plain `vite dev`,
 * Vitest): `invoke` rejects, the support probe is false, and recognition
 * surfaces a friendly error instead of throwing raw bridge text.
 */

/** One recognized line: top candidate plus its confidence in [0, 1]. */
export interface OcrLine {
	text: string;
	confidence: number;
}

/** Shaped result (mirrors the Rust `OcrOutput`). */
export interface OcrResult {
	/** Lines joined with `\n` — what the caller inserts. */
	text: string;
	lines: OcrLine[];
	/** Mean line confidence, 0 when nothing was recognized. */
	confidence: number;
}

let supportedCache: boolean | null = null;

/**
 * True only inside a Tauri shell on a build with on-device OCR (the Mac
 * app today). Never throws. Success caches; failure does NOT — a
 * cold-start transient must not hide the affordance all session.
 */
export async function ocrSupported(): Promise<boolean> {
	if (supportedCache) return true;
	try {
		supportedCache = await invoke<boolean>("ocr_supported");
	} catch {
		return false;
	}
	return supportedCache;
}

/**
 * Recognize text in an image. `image` is a data URL (as stored on
 * composer attachments) or raw base64; `lang` is an optional BCP-47
 * hint for the recognition languages (the backend takes a learner
 * default without one). Resolves with the shaped text; rejects with a
 * raw bridge message the caller maps through `friendlyOcrError`.
 */
export async function recognizeImageText(
	image: string,
	lang: string | null = null
): Promise<OcrResult> {
	return await invoke<OcrResult>("ocr_recognize", { image, lang });
}

/**
 * True for rejections that mean "no on-device OCR in this build" — the
 * caller explains instead of retrying. Pure and unit-tested.
 */
export function isOcrUnsupported(message: string): boolean {
	return /requires macos|not supported|no on-device ocr/i.test(message);
}

/**
 * Raw bridge/invoke errors translated into something actionable,
 * mirroring `friendlyNativeError` for the speech path. Pure and
 * unit-tested.
 */
export function friendlyOcrError(message: string): string {
	if (isOcrUnsupported(message)) {
		return "Text recognition needs the Mac app (this preview has no on-device OCR).";
	}
	if (/capabilit|not allowed|permission|denied/i.test(message)) {
		return "Text recognition is blocked by the app's permissions — rebuild the app and try again.";
	}
	if (/no text found/i.test(message)) {
		return "No text found in this image.";
	}
	return message;
}
