import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/** The chat pill spans the full row width flush with the + button
(the row × overlays instead of reserving its slot). */
test("active chat pill sits flush with the new-chat button", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "hello" }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await page.keyboard.press("Meta+b");
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	await page.waitForTimeout(600);
	const edges = await page.evaluate(() => {
		const rect = (s: string) => document.querySelector(s)?.getBoundingClientRect();
		const pill = rect("aside ul button.side-chat");
		const plus = rect("aside button.new");
		if (!pill || !plus) throw new Error("no sidebar rows");
		return { pillRight: pill.x + pill.width, plusRight: plus.x + plus.width };
	});
	expect(Math.abs(edges.pillRight - edges.plusRight)).toBeLessThanOrEqual(1);
});

/** Double-clicking the empty gutters opens the nearby sidebar. */
test("gutter double-click opens the nearby sidebar", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "hello" }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
	await page.mouse.dblclick(8, 300);
	await expect(page.locator("aside").first()).not.toHaveClass(/collapsed/);
	await page.keyboard.press("Meta+b");
	await expect(page.locator("aside").first()).toHaveClass(/collapsed/);
	const width = await page.evaluate(() => window.innerWidth);
	await page.mouse.dblclick(width - 8, 300);
	await expect(page.locator(".settings-panel")).toBeVisible();
});

/** ⌘+ / ⌘− steps the UI text scale with a percent toast. */
test("command plus and minus scale text", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible();
	await page.keyboard.press("Meta+=");
	await expect(page.locator(".toast")).toContainText("Text size 110%");
	await page.keyboard.press("Meta+-");
	await expect(page.locator(".toast")).toContainText("Text size 100%");
});
