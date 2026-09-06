// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
	detectScript,
	extractWordAt,
	ttsLangFor,
	speakWord,
	vocalizeArabic,
	buildVocalizeMessages
} from "./reading";
import { pinyinRuby } from "./pinyin";
import { furiganaHtml } from "./furigana";
import type { ChatProvider } from "./providers/types";

describe("script detection", () => {
	it("detects Arabic, Japanese, Chinese, and nothing", () => {
		expect(detectScript("مرحبا بالعالم")).toBe("ar");
		expect(detectScript("漢字を読む")).toBe("ja");
		expect(detectScript("你好世界")).toBe("zh");
		expect(detectScript("hello world")).toBeNull();
		// Kana wins over shared Han characters.
		expect(detectScript("カタカナと漢字")).toBe("ja");
		// Arabic wins over anything mixed in.
		expect(detectScript("hello مرحبا")).toBe("ar");
	});
});

describe("word extraction", () => {
	it("expands to the full word and stops at punctuation", () => {
		expect(extractWordAt("hello world", 1)).toBe("hello");
		expect(extractWordAt("hello, world", 5)).toBe("");
		expect(extractWordAt("你好世界", 1)).toBe("你好世界");
		expect(extractWordAt("ancienne d'un", 11)).toBe("un");
		expect(extractWordAt("ancienne d'un", 9)).toBe("d");
		expect(extractWordAt("بالعالم، كيف", 3)).toBe("بالعالم");
		expect(extractWordAt("", 0)).toBe("");
		expect(extractWordAt("hi", 9)).toBe("");
	});
});

describe("speech", () => {
	it("maps scripts to voice locales", () => {
		expect(ttsLangFor("你好")).toBe("zh-CN");
		expect(ttsLangFor("読む")).toBe("ja-JP");
		expect(ttsLangFor("مرحبا")).toBe("ar-SA");
		expect(ttsLangFor("hello")).toBe("en-US");
	});

	it("reports unavailable synthesis without throwing", () => {
		expect(speakWord("hello")).toEqual({ spoken: false, lang: "en-US" });
	});
});

describe("vocalization", () => {
	it("builds a tashkeel-only prompt", () => {
		const messages = buildVocalizeMessages("مرحبا");
		expect(messages[0].content).toContain("tashkeel");
		expect(messages[1]).toEqual({ role: "user", content: "مرحبا" });
	});

	it("caches by exact input", async () => {
		const chat = vi.fn(async () => ({ content: "مَرْحَبًا", usage: null }));
		const provider = { id: "scripted", chat, stream: chat } as unknown as ChatProvider;
		await expect(vocalizeArabic(provider, "مرحبا")).resolves.toBe("مَرْحَبًا");
		await expect(vocalizeArabic(provider, "مرحبا")).resolves.toBe("مَرْحَبًا");
		expect(chat).toHaveBeenCalledTimes(1);
		await expect(vocalizeArabic(provider, "  ")).rejects.toThrow("Nothing to vocalize");
	});
});

describe("pinyin ruby", () => {
	it("annotates Han characters with tone-marked readings", () => {
		const html = pinyinRuby("汉语拼音");
		expect(html).toContain("<ruby>汉<rt>hàn</rt></ruby>");
		expect(html).toContain("<ruby>语<rt>yǔ</rt></ruby>");
	});

	it("resolves polyphones from context and passes other text through", () => {
		const html = pinyinRuby("银行， OK!");
		expect(html).toContain("<rt>yín</rt>");
		expect(html).toContain("<rt>háng</rt>");
		expect(html).toContain("，");
		expect(html).toContain("OK!");
		expect(html).not.toContain("<rt>OK");
	});
});

describe("furigana", () => {
	it("converts kanji to ruby readings", async () => {
		const html = await furiganaHtml("漢字を読む");
		expect(html).toContain("<ruby>");
		expect(html).toContain("かんじ");
		expect(html).toContain("よ");
	}, 120000);
});
