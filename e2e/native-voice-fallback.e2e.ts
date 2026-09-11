import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Platform-parity fallback (Windows/Linux native TTS + Linux dictation):
 * the new Rust commands only exist inside the Tauri shell, so the
 * browser preview must behave exactly as before — web-voices fieldset
 * in settings, per-message Speak offered, no native UI leaking in.
 * (Shell-side speech itself is device-only and unverified here.)
 */
test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "hello there" }]);
	await page.goto("/");
	await expect(page.locator("article.assistant")).toBeVisible({ timeout: 60_000 });
});

test("browser settings show the web-voices engine note, not the system picker", async ({
	page
}) => {
	await page.keyboard.press("Meta+,");
	const panel = page.locator(".settings-panel");
	await expect(panel).not.toHaveClass(/closed/);
	await expect(panel.getByText("browser preview can only use web voices")).toBeVisible();
	await expect(panel.locator('select[aria-labelledby="system-voice-label"]')).toHaveCount(0);
});

test("assistant messages still offer read-aloud without a native bridge", async ({ page }) => {
	const article = page.locator("article.assistant");
	await article.hover();
	await expect(article.locator('button[aria-label="Read this message aloud"]')).toBeVisible();
});
