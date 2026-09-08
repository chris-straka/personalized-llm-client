import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Furigana end to end (lindera worker + vendored IPAdic): the only
 * coverage of the real conversion engine — Vitest has no Web Worker.
 * First run pays the dictionary download + build (tens of seconds);
 * later runs reuse the worker cache per page load.
 */
test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
	// Two soft-break lines, one paragraph: aid HTML must keep that
	// structure (one <p> with a <br>), or the message grows on pin.
	await seedChat(page, [{ role: "assistant", content: "漢字を読む\nテストです" }]);
	await page.goto("/");
	await expect(page.locator("article.assistant .actions")).toBeVisible({ timeout: 60_000 });
});

test("clicking the furigana aid pins kanji readings", async ({ page }) => {
	const aidBtn = page.locator('article.assistant .actions button:has-text("読み仮名")');
	const body = page.locator("article.assistant .rendered");
	const before = await body.boundingBox();
	if (!before) throw new Error("message body lost its box");
	await aidBtn.hover();
	await aidBtn.click();
	// Golden shape: one ruby each for 漢字 and 読, okurigana plain.
	await expect(body.locator("ruby")).toHaveCount(2, { timeout: 60_000 });
	await expect(body).toContainText("かんじ");
	await expect(body).toContainText("よ");
	// Readings are overlay, never layout: spawning ruby must not move
	// the base text by even a pixel.
	const after = await body.boundingBox();
	if (!after) throw new Error("message body lost its box");
	for (const key of ["x", "y", "width", "height"] as const) {
		expect(Math.abs(after[key] - before[key])).toBeLessThanOrEqual(1);
	}
});
