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
	await seedChat(page, [{ role: "assistant", content: "漢字を読む" }]);
	await page.goto("/");
	await expect(page.locator("article.assistant .actions")).toBeVisible({ timeout: 60_000 });
});

test("clicking the furigana aid pins kanji readings", async ({ page }) => {
	const aidBtn = page.locator('article.assistant .actions button:has-text("読み仮名")');
	await aidBtn.hover();
	await aidBtn.click();
	const body = page.locator("article.assistant");
	// Golden shape: one ruby each for 漢字 and 読, okurigana plain.
	await expect(body.locator("ruby")).toHaveCount(2, { timeout: 60_000 });
	await expect(body).toContainText("かんじ");
	await expect(body).toContainText("よ");
});
