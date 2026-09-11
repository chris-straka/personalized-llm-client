import { describe, expect, it } from "vitest";
import { imageTypesForItem, readClipboardImageFiles } from "./touchPaste";

describe("imageTypesForItem", () => {
	it("keeps image types and drops the rest", () => {
		expect(imageTypesForItem(["text/plain", "image/png"])).toEqual(["image/png"]);
		expect(imageTypesForItem(["text/plain"])).toEqual([]);
	});
});

describe("readClipboardImageFiles", () => {
	it("converts clipboard images to Files", async () => {
		const files = await readClipboardImageFiles(async () => [
			{
				types: ["image/png"],
				getType: async () => new Blob(["x"], { type: "image/png" })
			}
		]);
		expect(files).toHaveLength(1);
		expect(files[0]?.type).toBe("image/png");
		expect(files[0]?.name).toContain("clipboard-image");
	});

	it("throws when no images are on the clipboard", async () => {
		await expect(readClipboardImageFiles(async () => [])).rejects.toThrow(
			"No images on the clipboard."
		);
	});

	it("skips unreadable types but keeps readable ones", async () => {
		const files = await readClipboardImageFiles(async () => [
			{
				types: ["image/png", "image/jpeg"],
				getType: async (type: string) => {
					if (type === "image/png") throw new Error("denied");
					return new Blob(["x"], { type });
				}
			}
		]);
		expect(files).toHaveLength(1);
		expect(files[0]?.type).toBe("image/jpeg");
	});
});
