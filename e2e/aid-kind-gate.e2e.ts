import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

const ARTICLE = "article.assistant";
const BODY = `${ARTICLE} .rendered`;
const PINYIN_TIP = "Add pinyin";
const FURIGANA_TIP = "Add furigana";
const PINYIN_ORIGINAL = "显示原件";

/**
 * Local-aid hover previews unlock per kind, not per message: pinning
 * (clicking) furigana must never let a pinyin hover reveal readings —
 * only pinyin's own click unlocks pinyin's hover. Pinyin converts
 * synchronously, so this needs no dictionary wait.
 */
test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "你好世界\n漢字を読む" }]);
	await page.goto("/");
	await expect(page.locator(`${ARTICLE} .actions`)).toBeVisible({ timeout: 60_000 });
});

test("hovering pinyin before any click previews nothing", async ({ page }) => {
	const body = page.locator(BODY);
	const before = await body.innerHTML();
	const pinyinBtn = page.locator(`${ARTICLE} .actions button[data-tip="${PINYIN_TIP}"]`);
	await expect(pinyinBtn).toBeVisible();

	await pinyinBtn.hover();
	await page.waitForTimeout(400);
	expect(await body.locator("ruby, rt").count()).toBe(0);
	expect(await body.innerHTML()).toBe(before);
});

test("only the clicked kind's hover previews", async ({ page }) => {
	const body = page.locator(BODY);
	const before = await body.innerHTML();
	const pinyinBtn = page.locator(`${ARTICLE} .actions button[data-tip="${PINYIN_TIP}"]`);
	const furiganaBtn = page.locator(`${ARTICLE} .actions button[data-tip="${FURIGANA_TIP}"]`);

	// Click pinyin (pins, renders synchronously), then unpin so both
	// buttons are back to hover-only.
	await pinyinBtn.click();
	const showOriginal = page.locator(`${ARTICLE} .actions button[data-tip="${PINYIN_ORIGINAL}"]`);
	await expect(showOriginal).toBeVisible();
	expect(await body.locator("ruby, rt").count()).toBeGreaterThan(0);
	await showOriginal.click();
	await expect(pinyinBtn).toBeVisible();
	await page.mouse.move(2, 2);

	// Pinyin's own hover previews now...
	await pinyinBtn.hover();
	await expect(body.locator("ruby, rt").first()).toBeVisible();
	await page.mouse.move(2, 2);

	// ...but furigana was never clicked, so its hover stays color-only.
	await furiganaBtn.hover();
	await page.waitForTimeout(400);
	expect(await body.innerHTML()).toBe(before);
	expect(await body.locator("ruby, rt").count()).toBe(0);
});
