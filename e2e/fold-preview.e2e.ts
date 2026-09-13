import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Folded-message preview.
 *
 * The preview is a real button: a folded message (especially a
 * latex-only one, which renders no clickable text of its own)
 * unfolds by clicking its preview. Equations fold into
 * parenthesized latex (`\\(…\\)`) instead of vanishing.
 */

test("folded equation previews parenthesized latex and clicks to unfold", async ({
	page
}) => {
	await seedChat(page, [{ role: "assistant", content: "$$E = mc^2$$" }]);
	await page.goto("/");
	const article = page.locator("article.assistant").first();
	await expect(article.locator(".rendered")).toBeVisible();
	await article.locator('.actions button[aria-label="Fold this message"]').click();
	const preview = article.locator(".folded-preview");
	await expect(preview).toBeVisible();
	await expect(preview).toContainText("\\(E = mc^2\\)");
	await preview.click();
	await expect(preview).toHaveCount(0);
	await expect(article.locator(".rendered")).toBeVisible();
});

test("plain folded preview clicks to unfold", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "hello world" }]);
	await page.goto("/");
	const article = page.locator("article.assistant").first();
	await expect(article.locator(".rendered")).toBeVisible();
	await article.locator('.actions button[aria-label="Fold this message"]').click();
	const preview = article.locator(".folded-preview");
	await expect(preview).toContainText("hello world");
	await preview.click();
	await expect(preview).toHaveCount(0);
	await expect(article.locator(".rendered")).toContainText("hello world");
});
