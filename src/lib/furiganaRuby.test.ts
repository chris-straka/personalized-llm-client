import { describe, it, expect } from "vitest";
import { toHiragana } from "wanakana";
import { rubyHtmlForTokens, type RubyToken } from "./furiganaRuby";

const ruby = (tokens: RubyToken[]): string => rubyHtmlForTokens(tokens, toHiragana);

/**
 * Exact kuroshiro outputs (captured from kuroshiro 1.2.0 + kuromoji
 * before the lindera swap). Token streams mirror the analyzer's
 * segmentation; the builder must reproduce the HTML verbatim.
 */
describe("rubyHtmlForTokens", () => {
	it("matches kuroshiro on 漢字を読む", () => {
		expect(
			ruby([
				{ surface: "漢字", reading: "カンジ" },
				{ surface: "を", reading: "ヲ" },
				{ surface: "読", reading: "ヨ" },
				{ surface: "む", reading: "ム" }
			])
		).toBe(
			"<ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>を<ruby>読<rp>(</rp><rt>よ</rt><rp>)</rp></ruby>む"
		);
	});

	it("matches kuroshiro on 感じ取れたら手を繋ごう", () => {
		expect(
			ruby([
				{ surface: "感じ", reading: "カンジ" },
				{ surface: "取れ", reading: "トレ" },
				{ surface: "たら", reading: "タラ" },
				{ surface: "手", reading: "テ" },
				{ surface: "を", reading: "ヲ" },
				{ surface: "繋ご", reading: "ツナゴ" },
				{ surface: "う", reading: "ウ" }
			])
		).toBe(
			"<ruby>感<rp>(</rp><rt>かん</rt><rp>)</rp></ruby>じ<ruby>取<rp>(</rp><rt>と</rt><rp>)</rp></ruby>れたら<ruby>手<rp>(</rp><rt>て</rt><rp>)</rp></ruby>を<ruby>繋<rp>(</rp><rt>つな</rt><rp>)</rp></ruby>ごう"
		);
	});

	it("matches kuroshiro on 美しい花が咲いている", () => {
		expect(
			ruby([
				{ surface: "美し", reading: "ウツクシ" },
				{ surface: "い", reading: "イ" },
				{ surface: "花", reading: "ハナ" },
				{ surface: "が", reading: "ガ" },
				{ surface: "咲い", reading: "サイ" },
				{ surface: "ている", reading: "テイル" }
			])
		).toBe(
			"<ruby>美<rp>(</rp><rt>うつく</rt><rp>)</rp></ruby>しい<ruby>花<rp>(</rp><rt>はな</rt><rp>)</rp></ruby>が<ruby>咲<rp>(</rp><rt>さ</rt><rp>)</rp></ruby>いている"
		);
	});

	it("matches kuroshiro on 株式会社の田中さんにお会いしました", () => {
		expect(
			ruby([
				{ surface: "株式会社", reading: "カブシキガイシャ" },
				{ surface: "の", reading: "ノ" },
				{ surface: "田中", reading: "タナカ" },
				{ surface: "さんに", reading: "サンニ" },
				{ surface: "お", reading: "オ" },
				{ surface: "会", reading: "ア" },
				{ surface: "いしました", reading: "イシマシタ" }
			])
		).toBe(
			"<ruby>株式会社<rp>(</rp><rt>かぶしきがいしゃ</rt><rp>)</rp></ruby>の<ruby>田中<rp>(</rp><rt>たなか</rt><rp>)</rp></ruby>さんにお<ruby>会<rp>(</rp><rt>あ</rt><rp>)</rp></ruby>いしました"
		);
	});

	it("splits coarse tokens on interior kana", () => {
		// Lindera segments 感じ取れ as one token where kuromoji gave
		// 感じ|取れ: the interior じ must still pin the split.
		expect(ruby([{ surface: "感じ取れ", reading: "カンジトレ" }])).toBe(
			"<ruby>感<rp>(</rp><rt>かん</rt><rp>)</rp></ruby>じ<ruby>取<rp>(</rp><rt>と</rt><rp>)</rp></ruby>れ"
		);
	});

	it("passes through when an anchor is missing from the reading", () => {
		expect(ruby([{ surface: "取れ", reading: "トク" }])).toBe("取れ");
	});

	it("keeps 々 inside the kanji run", () => {
		expect(ruby([{ surface: "様々", reading: "サマザマ" }])).toBe(
			"<ruby>様々<rp>(</rp><rt>さまざま</rt><rp>)</rp></ruby>"
		);
	});

	it("passes through kana, romaji, numbers, and unknown readings", () => {
		expect(ruby([{ surface: "これはひらがなだけです", reading: "*" }])).toBe(
			"これはひらがなだけです"
		);
		expect(ruby([{ surface: "mixedカタカナWord123", reading: "*" }])).toBe(
			"mixedカタカナWord123"
		);
		expect(ruby([{ surface: "漢字", reading: null }])).toBe("漢字");
		expect(ruby([{ surface: "", reading: "ア" }])).toBe("");
	});

	it("passes through when the alignment explains nothing", () => {
		// Reading fully consumed by leading okurigana: no ruby, not a
		// wrong one.
		expect(ruby([{ surface: "あ亜", reading: "ア" }])).toBe("あ亜");
	});
});
