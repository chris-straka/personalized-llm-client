// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
	detectScript,
	detectScripts,
	classifyAidLine,
	extractWordAt,
	ttsLangFor,
	speakWord,
	vocalizeArabic,
	buildVocalizeMessages,
	buildAidMessages,
	runModelAid,
	MODEL_AIDS,
	MODEL_AID_FOR_SCRIPT,
	localAidFor,
	localAidsFor,
	LOCAL_AID_BUTTON,
	LOCAL_AID_SHOW_ORIGINAL,
	LOCAL_AID_ADD_TITLE
} from "./reading";
import { pinyinRuby } from "./pinyin";
import { isFuriganaCached } from "./furigana";
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

	it("reports every aid script present, in priority order", () => {
		expect(detectScripts("hello world")).toEqual([]);
		expect(detectScripts("你好世界")).toEqual(["zh"]);
		// Kanji share lines with kana: pure Japanese stays Japanese-only.
		expect(detectScripts("漢字を読む")).toEqual(["ja"]);
		// A Han-only line beside kana lines: both scripts present.
		expect(detectScripts("こんにちは！\n你好！")).toEqual(["ja", "zh"]);
		// Same-line mixing falls back to Japanese-only (as before).
		expect(detectScripts("こんにちは！你好！")).toEqual(["ja"]);
		expect(detectScripts("hello مرحبا\n你好")).toEqual(["ar", "zh"]);
		// Mixed messages offer both local aids, furigana first.
		expect(localAidsFor(detectScripts("こんにちは！\n你好！"))).toEqual(["furigana", "pinyin"]);
		expect(localAidsFor(detectScripts("你好世界"))).toEqual(["pinyin"]);
		expect(localAidsFor(detectScripts("漢字を読む"))).toEqual(["furigana"]);
		expect(localAidsFor(detectScripts("hello world"))).toEqual([]);
		expect(localAidsFor(detectScripts("مرحبا بالعالم"))).toEqual([]);
	});

	it("classifies rendered lines to their owning aid", () => {
		expect(classifyAidLine("こんにちは！テストです。")).toBe("furigana");
		expect(classifyAidLine("漢字を読む")).toBe("furigana");
		expect(classifyAidLine("你好！测试。")).toBe("pinyin");
		expect(classifyAidLine("Hello world")).toBeNull();
		expect(classifyAidLine("")).toBeNull();
		// Same-line mixing reads as Japanese (kana wins, as in detection).
		expect(classifyAidLine("テストtest测试")).toBe("furigana");
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
		expect(MODEL_AIDS.tashkeel!.instruction).toContain("tashkeel");
	});

	it("builds a tashkeel-only prompt", () => {
		const messages = buildAidMessages("tashkeel", "مرحبا");
		expect(messages[0]?.content).toContain("tashkeel");
		expect(messages[1]).toEqual({ role: "user", content: "مرحبا" });
		expect(() => buildAidMessages("nope", "x")).toThrow("Unknown reading aid");
	});

	it("keeps the vocalize wrappers working", () => {
		expect(buildVocalizeMessages("مرحبا")[0]?.content).toContain("tashkeel");
	});

	it("maps scripts to their local rendering, if any", () => {
		expect(localAidFor("zh")).toBe("pinyin");
		expect(localAidFor("ja")).toBe("furigana");
		// Arabic renders identically with the toggle on or off: its aid
		// is model-applied, never locally computed.
		expect(localAidFor("ar")).toBeNull();
		expect(localAidFor(null)).toBeNull();
		expect(localAidFor(detectScript("hello world"))).toBeNull();
		expect(localAidFor(detectScript("مرحبا بالعالم"))).toBeNull();
		expect(localAidFor(detectScript("你好世界"))).toBe("pinyin");
	});

	it("gives every aid script a visible path: local rendering or a model aid", () => {
		for (const script of ["zh", "ja", "ar"] as const) {
			expect(localAidFor(script) ?? MODEL_AID_FOR_SCRIPT[script]).toBeTruthy();
		}
	});

	it("labels local-aid buttons in their own script", () => {
		expect(LOCAL_AID_BUTTON.pinyin).toBe("拼音");
		expect(LOCAL_AID_BUTTON.furigana).toBe("読み仮名");
	});

	it("labels the pinned state in the aid's own script", () => {
		expect(LOCAL_AID_SHOW_ORIGINAL.pinyin).toBe("显示原件");
		expect(LOCAL_AID_SHOW_ORIGINAL.furigana).toBe("オリジナルを表示");
	});

	it("titles the unpinned buttons in English", () => {
		expect(LOCAL_AID_ADD_TITLE.pinyin).toBe("Add pinyin");
		expect(LOCAL_AID_ADD_TITLE.furigana).toBe("Add furigana");
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
	// Live conversion needs the Web Worker (no engine in Vitest): the
	// real end-to-end path is covered by e2e/furigana.e2e.ts, and the
	// ruby builder by furiganaRuby.test.ts.
	it("reports the conversion cache without fetching", () => {
		// Sync check: unseen text is uncached and checking starts no load.
		expect(isFuriganaCached("未見の文です 98765")).toBe(false);
		// Cache keys are exact input text, not prefixes of it — and an
		// empty cache stays empty without a worker to fill it.
		expect(isFuriganaCached("漢字を読む")).toBe(false);
	});
});
