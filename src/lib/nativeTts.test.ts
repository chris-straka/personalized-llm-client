import { describe, it, expect } from "vitest";
import {
	sentenceAtOffset,
	friendlyNativeError,
	quoteLangFor,
	speakNative,
	stopNative
} from "./nativeTts";

describe("sentenceAtOffset", () => {
	const sentences = ["Hello world.", "How are you?", "Fine."];
	const utterance = sentences.join(" ");

	it("maps offsets inside each sentence", () => {
		expect(sentenceAtOffset(sentences, utterance, 0)).toBe(0);
		expect(sentenceAtOffset(sentences, utterance, 11)).toBe(0);
		expect(sentenceAtOffset(sentences, utterance, 12)).toBe(1);
		expect(sentenceAtOffset(sentences, utterance, 13)).toBe(1);
		expect(sentenceAtOffset(sentences, utterance, 25)).toBe(2);
	});

	it("clamps past-the-end offsets to the last sentence", () => {
		expect(sentenceAtOffset(sentences, utterance, 10_000)).toBe(2);
	});

	it("falls back to cursor order when a sentence is not found", () => {
		expect(sentenceAtOffset(["zzz", "Fine."], utterance, 5)).toBe(1);
	});
});

describe("friendlyNativeError", () => {
	it("maps capability denials to a rebuild hint", () => {
		expect(friendlyNativeError("tts_speak not allowed.")).toContain("permissions");
		expect(friendlyNativeError("permission denied")).toContain("permissions");
	});

	it("maps timeouts to a retry hint", () => {
		expect(friendlyNativeError("recv timed out")).toContain("try again");
	});

	it("maps non-macOS builds to the browser-preview note", () => {
		expect(friendlyNativeError("native TTS requires macOS")).toContain("Mac app");
	});

	it("passes unknown errors through untouched", () => {
		expect(friendlyNativeError("boom")).toBe("boom");
	});
});

describe("quoteLangFor", () => {
	it("uses script detection without touching the bridge", async () => {
		await expect(quoteLangFor("你好，这是一个中文测试句子", "en-US")).resolves.toBe("zh-CN");
		await expect(quoteLangFor("مرحبا بك في هذا الاختبار الطويل", "en-US")).resolves.toBe(
			"ar-SA"
		);
	});

	it("falls back without a bridge for Latin text", async () => {
		await expect(
			quoteLangFor("this is a fairly long english sentence for testing", "en-US")
		).resolves.toBe("en-US");
	});
});

describe("stopNative", () => {
	it("never throws without a bridge (send-path regression)", () => {
		expect(() => stopNative()).not.toThrow();
	});
});

describe("speakNative", () => {
	it("returns false without touching the bridge for empty text", () => {
		expect(
			speakNative("   ", "en-US", {
				onError: () => {
					throw new Error("onError must not fire when there is nothing to say");
				}
			})
		).toBe(false);
	});

	it("reports bridge failure via onError instead of throwing", async () => {
		const errors: string[] = [];
		const ok = speakNative("Hello world, this is a spoken test.", "en-US", {
			onError: (message) => errors.push(message)
		});
		expect(ok).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(errors.length).toBe(1);
	});
});
