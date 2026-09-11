import { describe, it, expect } from "vitest";
import {
	coverageFor,
	fontNudgeFor,
	probeScript,
	scriptsInText
} from "./fontCoverage";

describe("scriptsInText", () => {
	it("applies the kana tie-break like the reading aids", () => {
		expect(scriptsInText("hello")).toEqual([]);
		expect(scriptsInText("学习中文")).toEqual(["zh"]);
		expect(scriptsInText("日本語を学ぶ")).toEqual(["ja"]);
		expect(scriptsInText("한국어를 배워요")).toEqual(["ko"]);
		expect(scriptsInText("中文と한국어")).toEqual(["ja", "ko"]);
	});
});

describe("probeScript", () => {
	it("maps check results to ok/missing and swallows throws", () => {
		expect(probeScript("zh", () => true)).toBe("ok");
		expect(probeScript("zh", () => false)).toBe("missing");
		expect(
			probeScript("zh", () => {
				throw new Error("no fonts");
			})
		).toBe("unknown");
	});
});

describe("coverageFor", () => {
	it("leaves unrequested scripts unknown", () => {
		expect(coverageFor(["zh"], () => true)).toEqual({
			zh: "ok",
			ja: "unknown",
			ko: "unknown"
		});
	});
});

describe("fontNudgeFor", () => {
	it("returns null when nothing is missing", () => {
		expect(fontNudgeFor({ zh: "ok", ja: "ok", ko: "unknown" })).toBe(null);
	});

	it("names the missing scripts and the OS panes", () => {
		const nudge = fontNudgeFor({ zh: "missing", ja: "ok", ko: "missing" });
		expect(nudge).toContain("Chinese (Han)");
		expect(nudge).toContain("Korean (Hangul)");
		expect(nudge).toContain("Language & Region");
		expect(nudge).toContain("fonts-noto-cjk");
	});
});
