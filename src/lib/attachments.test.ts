import { describe, it, expect } from "vitest";
import {
	IMAGE_MARKER,
	IMAGE_MAX_DIM,
	MAX_FILE_CHARS,
	fitDimensions,
	imageTokens,
	isTextFile,
	stripImageMarkers
} from "./attachments";
import { estimateTextTokens } from "./render";

describe("image token estimates", () => {
	it("charges a base cost plus per-tile cost", () => {
		expect(imageTokens(100, 100)).toBe(85 + 170);
		// 1024x512 → 2x1 tiles.
		expect(imageTokens(1024, 512)).toBe(85 + 170 * 2);
	});
});

describe("downscale dimensions", () => {
	it("leaves small images alone", () => {
		expect(fitDimensions(800, 600)).toEqual({ width: 800, height: 600 });
	});

	it("caps the long side at IMAGE_MAX_DIM, keeping aspect ratio", () => {
		const { width, height } = fitDimensions(4000, 2000);
		expect(Math.max(width, height)).toBe(IMAGE_MAX_DIM);
		expect(width / height).toBeCloseTo(2, 1);
	});
});

describe("text file detection", () => {
	const file = (name: string, type: string) => ({ name, type }) as File;
	it("accepts text mimes, code extensions, and rejects binaries", () => {
		expect(isTextFile(file("a.txt", "text/plain"))).toBe(true);
		expect(isTextFile(file("app.tsx", ""))).toBe(true);
		expect(isTextFile(file("data.json", "application/json"))).toBe(true);
		expect(isTextFile(file("photo.png", "image/png"))).toBe(false);
		expect(isTextFile(file("app.zip", "application/zip"))).toBe(false);
	});
});

describe("image markers", () => {
	it("strips pasted-image marker lines on send", () => {
		const text = `hello\n${IMAGE_MARKER}\nworld`;
		expect(stripImageMarkers(text)).toBe("hello\nworld");
		expect(stripImageMarkers("no markers")).toBe("no markers");
	});
});

describe("attachment budgets", () => {
	it("text attachments cost ~4 chars per token, capped by MAX_FILE_CHARS", () => {
		expect(MAX_FILE_CHARS).toBe(100_000);
		expect(estimateTextTokens("a".repeat(400))).toBe(100);
	});
});
