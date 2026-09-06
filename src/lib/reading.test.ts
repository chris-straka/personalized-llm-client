// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
	detectScript,
	extractWordAt,
	ttsLangFor,
	speakWord,
	vocalizeArabic,
	buildVocalizeMessages,
	buildAidMessages,
	runModelAid,
	MODEL_AIDS,
	MODEL_AID_FOR_SCRIPT
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
		expect(extractWordAt("«bonjour» verstehen", 1)).toBe("bonjour");
		expect(extractWordAt("بالعالم، كيف", 3)).toBe("بالعالم");
		expect(extractWordAt("", 0)).toBe("");
		expect(extractWordAt("hi", 9)).toBe("");
	});
});

describe("speech locales", () => {
	it("maps scripts to voice locales", () => {
		expect(ttsLangFor("你好")).toBe("zh-CN");
		expect(ttsLangFor("読む")).toBe("ja-JP");
		expect(ttsLangFor("مرحبا")).toBe("ar-SA");
		expect(ttsLangFor("안녕하세요")).toBe("ko-KR");
		expect(ttsLangFor("спасибо")).toBe("ru-RU");
		expect(ttsLangFor("ευχαριστώ")).toBe("el-GR");
		expect(ttsLangFor("שלום")).toBe("he-IL");
		expect(ttsLangFor("สวัสดี")).toBe("th-TH");
		expect(ttsLangFor("नमस्ते")).toBe("hi-IN");
	});

	it("falls back for Latin script (French/German/English)", () => {
		expect(ttsLangFor("hello")).toBe("en-US");
		expect(ttsLangFor("bonjour", "fr-FR")).toBe("fr-FR");
		expect(ttsLangFor("verstehen", "de-DE")).toBe("de-DE");
	});

	it("reports unavailable synthesis without throwing", () => {
		expect(speakWord("hello")).toEqual({ spoken: false, lang: "en-US" });
		expect(speakWord("bonjour", "fr-FR")).toEqual({ spoken: false, lang: "fr-FR" });
	});
});

describe("model-assisted reading aids", () => {
	it("registers tashkeel as the Arabic model aid", () => {
		expect(MODEL_AID_FOR_SCRIPT.ar).toBe("tashkeel");
		expect(MODEL_AID_FOR_SCRIPT.zh).toBeNull();
		expect(MODEL_AID_FOR_SCRIPT.ja).toBeNull();
		expect(MODEL_AIDS.tashkeel.instruction).toContain("tashkeel");
	});

	it("builds a tashkeel-only prompt", () => {
		const messages = buildAidMessages("tashkeel", "مرحبا");
		expect(messages[0].content).toContain("tashkeel");
		expect(messages[1]).toEqual({ role: "user", content: "مرحبا" });
		expect(() => buildAidMessages("nope", "x")).toThrow("Unknown reading aid");
	});

	it("keeps the vocalize wrappers working", () => {
		expect(buildVocalizeMessages("مرحبا")[0].content).toContain("tashkeel");
	});

	it("caches by aid + exact input", async () => {
		const chat = vi.fn(async () => ({ content: "مَرْحَبًا", usage: null }));
		const provider = { id: "scripted", chat, stream: chat } as unknown as ChatProvider;
		await expect(runModelAid(provider, "tashkeel", "مرحبا")).resolves.toBe("مَرْحَبًا");
		await expect(runModelAid(provider, "tashkeel", "مرحبا")).resolves.toBe("مَرْحَبًا");
		expect(chat).toHaveBeenCalledTimes(1);
		await expect(runModelAid(provider, "tashkeel", "  ")).rejects.toThrow("Nothing to vocalize");
		await expect(vocalizeArabic(provider, "مرحبا")).resolves.toBe("مَرْحَبًا");
		expect(chat).toHaveBeenCalledTimes(1);
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
