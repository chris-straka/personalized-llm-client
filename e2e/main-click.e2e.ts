import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Clicking into the main chat collapses both sidebars (settings panel
 * and chats list), landing the click on a full-width conversation.
 * Key presses wait for the prompt editor: the window key handler only
 * attaches once it mounts, so an early chord would be lost to a race.
 */
test.beforeEach(async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
});

test("clicking the main chat collapses the chats sidebar", async ({ page }) => {
	const aside = page.locator("aside").first();
	await page.keyboard.press("Meta+b");
	await expect(aside).not.toHaveClass(/collapsed/);

	await page.locator(".empty-state h1").click();
	await expect(aside).toHaveClass(/collapsed/);
});

test("clicking the main chat closes the settings panel", async ({ page }) => {
	const panel = page.locator(".settings-panel");
	await page.keyboard.press("Meta+,");
	await expect(panel).not.toHaveClass(/closed/);

	await page.locator(".empty-state h1").click();
	await expect(panel).toHaveClass(/closed/);
});

test("shift-cmd-comma mirrors cmd-comma on the settings panel", async ({ page }) => {
	const panel = page.locator(".settings-panel");
	await page.keyboard.press("Meta+,");
	await expect(panel).not.toHaveClass(/closed/);
	await page.keyboard.press("Meta+,");
	await expect(panel).toHaveClass(/closed/);

	await page.keyboard.press("Shift+Meta+,");
	await expect(panel).not.toHaveClass(/closed/);
	await page.keyboard.press("Shift+Meta+,");
	await expect(panel).toHaveClass(/closed/);
});
