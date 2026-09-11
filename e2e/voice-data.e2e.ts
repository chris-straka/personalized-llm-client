import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Voice + data bucket (user-visible surface):
 * - Settings always shows the Study-fonts inventory (browser preview
 *   included — `document.fonts` needs no shell).
 * - The Lesson-audio export stays shell-only (no native bridge here).
 * - The composer still accepts attachments (pdf/docx inline as text
 *   via the offline extractors; covered at unit level).
 */
test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "你好，let us study" }]);
	await page.goto("/");
	await expect(page.locator("article.assistant")).toBeVisible({ timeout: 60_000 });
});

test("settings show the study-fonts inventory with a recheck", async ({ page }) => {
	await page.keyboard.press("Meta+,");
	const panel = page.locator(".settings-panel");
	await expect(panel).not.toHaveClass(/closed/);
	const fonts = panel.getByText("Study fonts", { exact: true });
	await expect(fonts).toBeVisible();
	await expect(panel.getByText("Chinese (Han):")).toBeVisible();
	await expect(panel.getByText("Japanese (kana):")).toBeVisible();
	await expect(panel.getByText("Korean (Hangul):")).toBeVisible();
	await expect(
		panel.getByRole("button", { name: "Check fonts again" })
	).toBeVisible();
});

test("browser preview offers no lesson-audio export", async ({ page }) => {
	await page.keyboard.press("Meta+,");
	const panel = page.locator(".settings-panel");
	await expect(panel).not.toHaveClass(/closed/);
	await expect(panel.getByText("Lesson audio", { exact: true })).toHaveCount(0);
});
