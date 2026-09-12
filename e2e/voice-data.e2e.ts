import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Voice + data bucket (user-visible surface):
 * - The Study-fonts inventory and the Lesson-audio export are both
 *   removed from settings (lesson-audio froze the app).
 * - The composer still accepts attachments (pdf/docx inline as text
 *   via the offline extractors; covered at unit level).
 */
test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "你好，let us study" }]);
	await page.goto("/");
	await expect(page.locator("article.assistant")).toBeVisible({ timeout: 60_000 });
});

test("settings show no study-fonts or lesson-audio sections", async ({ page }) => {
	await page.keyboard.press("Meta+,");
	const panel = page.locator(".settings-panel");
	await expect(panel).not.toHaveClass(/closed/);
	await expect(panel.getByText("Study fonts", { exact: true })).toHaveCount(0);
	await expect(panel.getByRole("button", { name: "Check fonts again" })).toHaveCount(0);
	await expect(panel.getByText("Lesson audio", { exact: true })).toHaveCount(0);
	await expect(panel.getByRole("button", { name: "Save sample audio" })).toHaveCount(0);
});
