import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Right-clicking a Han character with a live highlight shows pinyin
 * for just the highlighted text (never pinned, never per-message).
 * The highlight clearing dismisses it; anything else right-clicked
 * with a selection keeps speaking as before.
 */
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		(window as unknown as { __spoken: string[] }).__spoken = [];
		const synth = window.speechSynthesis;
		if (synth) {
			synth.speak = ((utterance: SpeechSynthesisUtterance) => {
				(window as unknown as { __spoken: string[] }).__spoken.push(utterance.text);
			}) as typeof synth.speak;
		}
	});
	await seedChat(page, [{ role: "assistant", content: "你好世界" }]);
	await page.goto("/");
	await expect(page.locator("article.assistant .rendered p").first()).toBeVisible({
		timeout: 60_000
	});
});

async function spoken(page: Page): Promise<string[]> {
	return page.evaluate(
		() => (window as unknown as { __spoken: string[] }).__spoken ?? []
	);
}

/** Highlight the first two Hanzi of the paragraph via the live selection. */
async function selectFirstTwo(page: Page): Promise<string> {
	return page.evaluate(() => {
		const p = document.querySelector("article.assistant .rendered p");
		const text = p?.firstChild;
		if (!text) return "";
		const selection = window.getSelection();
		selection?.setBaseAndExtent(text, 0, text, 2);
		return selection?.toString() ?? "";
	});
}

async function clickOnText(page: Page): Promise<void> {
	const box = await page.locator("article.assistant .rendered p").first().boundingBox();
	if (!box) throw new Error("missing para box");
	await page.mouse.click(box.x + 8, box.y + box.height / 2, { button: "right" });
}

test("right-clicking a hanzi highlight shows its pinyin only", async ({ page }) => {
	const selected = await selectFirstTwo(page);
	expect(selected).toBe("你好");
	await clickOnText(page);
	const panel = page.locator(".sel-pinyin");
	await expect(panel).toBeVisible({ timeout: 10_000 });
	await expect(panel.locator("rt").first()).toHaveText("nǐ");
	// Speech always runs too: the panel is a silent extra.
	await expect.poll(() => spoken(page), { timeout: 10_000 }).toContain(selected);
	// Escape dismisses the panel.
	await page.keyboard.press("Escape");
	await expect(panel).toHaveCount(0);
});

test("clicking off dismisses the panel with the highlight live", async ({ page }) => {
	await selectFirstTwo(page);
	await clickOnText(page);
	const panel = page.locator(".sel-pinyin");
	await expect(panel).toBeVisible({ timeout: 10_000 });
	await page.mouse.click(5, 5);
	await expect(panel).toHaveCount(0);
});

test("clearing the highlight dismisses the panel", async ({ page }) => {
	await selectFirstTwo(page);
	await clickOnText(page);
	const panel = page.locator(".sel-pinyin");
	await expect(panel).toBeVisible({ timeout: 10_000 });
	await page.evaluate(() => window.getSelection()?.removeAllRanges());
	await expect(panel).toHaveCount(0);
});

test("right-clicking hanzi with no highlight still speaks", async ({ page }) => {
	await clickOnText(page);
	await expect
		.poll(() => spoken(page), { timeout: 10_000 })
		.not.toEqual([]);
	await expect(page.locator(".sel-pinyin")).toHaveCount(0);
});

test("right-clicking kanji in japanese shows furigana and speaks", async ({ page }) => {
	// Like Inspect, a lone Han char reads its locale from the
	// surrounding sentence: kana nearby means Japanese.
	await seedChat(page, [{ role: "assistant", content: "漢字を読む" }]);
	await page.goto("/");
	await expect(page.locator("article.assistant .rendered p").first()).toBeVisible({
		timeout: 60_000
	});
	const selected = await page.evaluate(() => {
		const p = document.querySelector("article.assistant .rendered p");
		const text = p?.firstChild;
		if (!text) return "";
		window.getSelection()?.setBaseAndExtent(text, 0, text, 2);
		return window.getSelection()?.toString() ?? "";
	});
	expect(selected).toBe("漢字");
	await clickOnText(page);
	const panel = page.locator(".sel-pinyin");
	// Conversion runs in the dictionary worker: slower than pinyin.
	await expect(panel).toBeVisible({ timeout: 60_000 });
	await expect(panel.locator(".frt").first()).toHaveText("かんじ", { timeout: 10_000 });
	await expect.poll(() => spoken(page), { timeout: 10_000 }).toContain("漢字");
});
