import { describe, it, expect, vi, afterEach } from "vitest";
import {
	builtinAiAvailable,
	builtinTranslatorReady,
	builtinTranslate,
	builtinDetectLanguage,
	hoverTranslate
} from "./builtinAi";

const G = globalThis as Record<string, unknown>;

afterEach(() => {
	vi.restoreAllMocks();
	delete G.Translator;
	delete G.LanguageDetector;
	delete G.Summarizer;
});

describe("chrome built-in AI probes", () => {
	it("reports none available by default (provider fallback)", () => {
		expect(builtinAiAvailable()).toEqual([]);
	});
	it("detects translator/detector/summarizer globals", () => {
		G.Translator = { create: async () => ({ translate: async (t: string) => t }) };
		G.LanguageDetector = { create: async () => ({ detect: async () => [] }) };
		G.Summarizer = { create: async () => ({ summarize: async () => "" }) };
		expect(builtinAiAvailable()).toEqual(["translator", "detector", "summarizer"]);
	});
	it("readiness is false without the API, never throws", async () => {
		await expect(builtinTranslatorReady("fr", "en")).resolves.toBe(false);
		await expect(builtinTranslate("bonjour", "fr", "en")).resolves.toBeNull();
		await expect(builtinDetectLanguage("bonjour")).resolves.toBeNull();
	});
	it("uses the on-device translator when present", async () => {
		G.Translator = {
			availability: async () => "available",
			create: async () => ({ translate: async (t: string) => `ONDEVICE:${t}` })
		};
		G.LanguageDetector = { create: async () => ({ detect: async () => [{ detectedLanguage: "fr" }] }) };
		await expect(builtinTranslatorReady("fr", "en")).resolves.toBe(true);
		const fallback = vi.fn(async () => "FALLBACK");
		await expect(hoverTranslate("bonjour", "en", fallback)).resolves.toEqual({
			text: "ONDEVICE:bonjour",
			via: "builtin"
		});
		expect(fallback).not.toHaveBeenCalled();
	});
	it("falls back to the keyed helper when on-device fails", async () => {
		const fallback = vi.fn(async (t: string) => `KEYED:${t}`);
		await expect(hoverTranslate("bonjour", "en", fallback)).resolves.toEqual({
			text: "KEYED:bonjour",
			via: "fallback"
		});
		expect(fallback).toHaveBeenCalledWith("bonjour", "en");
	});
	it("rejects blank selections like translateSelection", async () => {
		await expect(hoverTranslate("   ", "en", async () => "x")).rejects.toThrow(
			"Nothing selected to translate."
		);
	});
});
