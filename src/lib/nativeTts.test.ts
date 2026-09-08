import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
	sentenceAtOffset,
	friendlyNativeError,
	quoteLangFor,
	speakNative,
	stopNative,
	audioFileNameFor,
	renderNativeSpeech,
	saveNativeAudio
} from "./nativeTts";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

beforeEach(() => {
	vi.useRealTimers();
	mockInvoke.mockReset();
	mockListen.mockReset();
	// No shell outside Tauri: every bridge call rejects, like the real
	// invoke does in browsers and tests.
	mockInvoke.mockRejectedValue(new Error("no bridge"));
	mockListen.mockResolvedValue(() => {});
});

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

describe("speakNative watchdog", () => {
	afterEach(() => {
		stopNative();
		vi.useRealTimers();
	});

	it("surfaces a wedged bridge via onError instead of sticking", async () => {
		vi.useFakeTimers();
		mockInvoke.mockImplementation(() => new Promise(() => {}));
		const errors: string[] = [];
		const ended: string[] = [];
		const ok = speakNative("Hello world, this is a spoken test.", "en-US", {
			onError: (message) => errors.push(message),
			onEnd: () => ended.push("end")
		});
		expect(ok).toBe(true);
		// 35 chars → max(30s, 35 × 250ms) = 30s ceiling.
		await vi.advanceTimersByTimeAsync(31_000);
		expect(errors).toEqual(["Speech timed out — stopped. Try again."]);
		expect(ended).toEqual([]);
	});

	it("stays silent when a stop supersedes the stuck utterance", async () => {
		vi.useFakeTimers();
		mockInvoke.mockImplementation(() => new Promise(() => {}));
		const errors: string[] = [];
		speakNative("First utterance that will wedge.", "en-US", {
			onError: (message) => errors.push(message)
		});
		await vi.advanceTimersByTimeAsync(10_000);
		stopNative();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(errors).toEqual([]);
	});
});

describe("audioFileNameFor", () => {
	it("slugs the first words with a ccez prefix and wav suffix", () => {
		expect(audioFileNameFor("Bonjour tout le monde, comment ça va?")).toBe(
			"ccez-bonjour-tout-le-monde-comment-ça.wav"
		);
	});

	it("keeps non-Latin scripts instead of falling back", () => {
		expect(audioFileNameFor("你好世界这是一个测试消息啊")).toBe("ccez-你好世界这是一个测试消息啊.wav");
	});

	it("falls back for empty or punctuation-only text", () => {
		expect(audioFileNameFor("   ")).toBe("ccez-message.wav");
		expect(audioFileNameFor("…?!")).toBe("ccez-message.wav");
	});

	it("caps length and strips trailing dashes", () => {
		const name = audioFileNameFor(
			"supercalifragilisticexpialidocious antidisestablishmentarianism pneumonoultramicroscopicsilicovolcanoconiosis"
		);
		expect(name.endsWith(".wav")).toBe(true);
		expect(name.length).toBeLessThanOrEqual("ccez-".length + 48 + ".wav".length);
		expect(name).not.toMatch(/-\.wav$/);
	});
});

describe("renderNativeSpeech", () => {
	it("returns null without a bridge instead of throwing", async () => {
		await expect(renderNativeSpeech("Hello", "en-US")).resolves.toBeNull();
		await expect(renderNativeSpeech("   ", "en-US")).resolves.toBeNull();
	});
});

describe("saveNativeAudio", () => {
	it("returns null without a bridge instead of throwing", async () => {
		await expect(saveNativeAudio("ccez-hello.wav", "UklGRg==")).resolves.toBeNull();
		await expect(saveNativeAudio("  ", "UklGRg==")).resolves.toBeNull();
		await expect(saveNativeAudio("ccez-hello.wav", "")).resolves.toBeNull();
	});
});
