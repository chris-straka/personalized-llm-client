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

/** A message with its own Japanese and Chinese sections offers both
local aids, furigana first. Kanji alone must not summon pinyin: only a
Han-only line counts as Chinese. */
test("a Japanese+Chinese message offers furigana and pinyin", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "こんにちは！テストです。\n你好！测试。" }
	]);
	await page.goto("/");
	const actions = page.locator("article.assistant .actions");
	await expect(actions).toBeVisible({ timeout: 60_000 });
	await expect(actions.locator('button:has-text("読み仮名")')).toBeVisible();
	await expect(actions.locator('button:has-text("拼音")')).toBeVisible();
});

/** Pure Japanese (kana mixed through every line) stays furigana-only. */
test("pure Japanese offers no pinyin button", async ({ page }) => {
	const actions = page.locator("article.assistant .actions");
	await expect(actions).toBeVisible({ timeout: 60_000 });
	await expect(actions.locator('button:has-text("読み仮名")')).toBeVisible();
	await expect(actions.locator('button:has-text("拼音")')).toHaveCount(0);
});

/** Both aids pin at once on a mixed message: each renders only its own
lines, and each button swaps in place to its own show-original — the
row never shuffles, and unpinning one keeps the other up. */
test("pinning furigana and pinyin together renders each on its own lines", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "漢字を読む\n你好世界" }]);
	await page.goto("/");
	const actions = page.locator("article.assistant .actions");
	const body = page.locator("article.assistant .rendered");
	await expect(actions).toBeVisible({ timeout: 60_000 });
	await actions.locator('button:has-text("読み仮名")').click();
	await expect(body).toContainText("かんじ");
	await actions.locator('button:has-text("拼音")').click();
	await expect(body).toContainText("nǐ");
	// Both lines keep ruby: furigana on the Japanese line, pinyin on
	// the Chinese line.
	await expect(body.locator("ruby")).not.toHaveCount(0);
	await expect(body).toContainText("かんじ");
	// Both buttons swapped in place to their own show-originals.
	await expect(actions.locator('button:has-text("オリジナルを表示")')).toBeVisible();
	await expect(actions.locator('button:has-text("显示原件")')).toBeVisible();
	// Unpinning furigana keeps pinyin up.
	await actions.locator('button:has-text("オリジナルを表示")').click();
	await expect(actions.locator('button:has-text("読み仮名")')).toBeVisible();
	await expect(actions.locator('button:has-text("显示原件")')).toBeVisible();
	await expect(body).toContainText("nǐ");
});

/** Clicking the pinyin aid pins Chinese readings (kana passes through). */
test("clicking the pinyin aid pins Chinese readings", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "こんにちは！\n你好！" }]);
	await page.goto("/");
	const actions = page.locator("article.assistant .actions");
	const body = page.locator("article.assistant .rendered");
	await expect(actions).toBeVisible({ timeout: 60_000 });
	await actions.locator('button:has-text("拼音")').click();
	await expect(body.locator("ruby")).not.toHaveCount(0);
	await expect(body).toContainText("nǐ");
	await expect(actions.locator('button:has-text("显示原件")')).toBeVisible();
});
