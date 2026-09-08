// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
	splitSentences,
	speechText,
	replyLangFor,
	splitSpeechSegments,
	speakText,
	speakMultilingual,
	stopSpeaking,
	isSpeaking,
	micAvailable,
	dictateOnce
} from "./voice";
import { ttsLangFor } from "./reading";

describe("splitSentences", () => {
	it("splits on Latin and CJK terminators", () => {
		expect(splitSentences("Hello world. How are you? Fine!")).toEqual([
			"Hello world.",
			"How are you?",
			"Fine!"
		]);
		expect(splitSentences("你好世界。今天好吗？很好！")).toEqual(["你好世界。", "今天好吗？", "很好！"]);
	});

	it("handles single sentences and empties", () => {
		expect(splitSentences("Bonjour")).toEqual(["Bonjour"]);
		expect(splitSentences("   ")).toEqual([]);
		expect(splitSentences("")).toEqual([]);
	});
});

describe("speechText", () => {
	it("drops code fences and markdown noise", () => {
		const text = speechText('# Title\n\nHello **world**.\n\n```ts\nconst x = 1;\n```\n\n[Pasted an image]');
		expect(text).toContain("Title");
		expect(text).toContain("Hello world.");
		expect(text).not.toContain("const x");
		expect(text).not.toContain("```");
		expect(text).not.toContain("[Pasted an image]");
	});

	it("names pasted content instead of reading markers", () => {
		expect(speechText("[paste 250 chars]")).toBe("pasted content");
		expect(speechText("[Pasted content 250 chars]")).toBe("pasted content");
	});
});

describe("replyLangFor", () => {
	it("resolves non-Latin scripts and falls back for Latin", () => {
		expect(replyLangFor("你好世界", "en-US")).toBe("zh-CN");
		expect(replyLangFor("Bonjour le monde", "fr-FR")).toBe("fr-FR");
		expect(replyLangFor("Guten Morgen", "de-DE")).toBe("de-DE");
		expect(replyLangFor("```py\nprint(1)\n```\nHello", "en-US")).toBe("en-US");
	});
});

describe("speech unavailability", () => {
	it("no-ops cleanly without throwing", () => {
		expect(speakText("hello", "en-US")).toBe(false);
		expect(speakMultilingual("hello", () => "en-US")).toBe(false);
		expect(isSpeaking()).toBe(false);
		expect(() => stopSpeaking()).not.toThrow();
		expect(micAvailable()).toBe(false);
		expect(dictateOnce("en-US", () => {}, () => {})).toBeNull();
	});
});

describe("splitSpeechSegments", () => {
	const langFor = (sentence: string): string => ttsLangFor(sentence, "en-US");
	it("resolves a voice locale per sentence", () => {
		expect(splitSpeechSegments("Hello world. 你好！こんにちは！", langFor)).toEqual([
			{ text: "Hello world.", lang: "en-US" },
			{ text: "你好！", lang: "zh-CN" },
			{ text: "こんにちは！", lang: "ja-JP" }
		]);
	});
	it("returns no segments for blank text", () => {
		expect(splitSpeechSegments("   ", langFor)).toEqual([]);
	});
});
