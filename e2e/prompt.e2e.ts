import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

test("prompt types and sends without vim", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await page.locator(".cm-content").click();
	await page.keyboard.type("hello world");
	await expect(page.locator(".cm-content")).toContainText("hello world");
	await page.keyboard.press("Enter");
	await expect(page.locator("article.user .rendered")).toContainText("hello world");
	// Ctrl+G still hops out to scroll mode.
	await page.locator(".cm-content").click();
	await page.keyboard.press("Control+g");
	await expect(page.locator(".cm-content")).toContainText("ctrl+g to hop back in");
});

/** The prompt grows with the draft, then stops and scrolls inside. */
test("long drafts cap the prompt height and scroll", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await page.locator(".cm-content").click();
	for (let i = 0; i < 15; i++) {
		await page.keyboard.type(`draft line ${i + 1}`);
		await page.keyboard.press("Shift+Enter");
	}
	const sizes = await page.evaluate(() => {
		const scroller = document.querySelector(".prompt .cm-scroller");
		if (!(scroller instanceof HTMLElement)) return null;
		return { client: scroller.clientHeight, scroll: scroller.scrollHeight };
	});
	if (!sizes) throw new Error("prompt scroller missing");
	// 12rem cap ≈ 192px at the default root size; stay well under it
	// while the content overflows into a scroll.
	expect(sizes.client).toBeLessThanOrEqual(210);
	expect(sizes.scroll).toBeGreaterThan(sizes.client);
});
