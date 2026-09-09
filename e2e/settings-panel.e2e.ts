import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/** Settings panel: five thinking pills share one row, labels stay terse. */
test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
});

test("thinking pills fit on one line", async ({ page }) => {
	const pills = page
		.locator('.settings-panel .segmented[aria-label="Thinking level"] button');
	await expect(pills).toHaveCount(5);
	const tops = await pills.evaluateAll((els) =>
		els.map((el) => Math.round(el.getBoundingClientRect().top))
	);
	expect(new Set(tops).size).toBe(1);
});

test("own-bubble toggle reads as Enable background on my messages", async ({ page }) => {
	await expect(page.locator(".settings-panel").getByText("Enable background on my messages")).toBeVisible();
});

/** Bubble background is decor only: turning it off never changes the
message alignment (left, right-docked, both ways). */
test("own-bubble off keeps left alignment, drops background", async ({ page }) => {
	const bubble = page.locator("article.user .bubble");
	await expect(bubble).toHaveCSS("background-color", "rgb(241, 241, 244)");
	await expect(bubble).toHaveCSS("text-align", "left");
	await page.locator(".settings-panel").getByText("Enable background on my messages").click();
	await expect(bubble).toHaveCSS("text-align", "left");
	const bg = await bubble.evaluate((el) => getComputedStyle(el).backgroundColor);
	expect(bg).toBe("rgba(0, 0, 0, 0)");
});
