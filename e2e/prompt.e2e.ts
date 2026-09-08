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
