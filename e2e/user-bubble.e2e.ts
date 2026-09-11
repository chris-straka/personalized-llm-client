import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

/** A short own message stays on one line: the bubble shrink-wraps the
text instead of squeezing it into an early wrap with dead space left. */
test("short own message stays on one line", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "Give me a paragraph in english" }]);
	await page.goto("/");
	const rendered = page.locator("article.user .rendered").first();
	await expect(rendered).toBeVisible();
	const lines = await rendered.evaluate((el) => {
		const text = el.querySelector("p")?.firstChild;
		if (!text) return -1;
		const range = document.createRange();
		range.selectNodeContents(text);
		return [...range.getClientRects()].filter((r) => r.width > 1).length;
	});
	expect(lines).toBe(1);
});
