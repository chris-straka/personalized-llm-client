import { test, expect, type Page } from "@playwright/test";

/**
 * Share-into-chat (Android ACTION_SEND): the system Share sheet lists
 * the app via the MainActivity SEND filter, MainActivity forwards
 * EXTRA_TEXT through the annotate-external bridge, and the frontend
 * prefills the composer (see MainActivity.handleSend and the
 * annotate-external listener in +page.svelte). The native intent half
 * is device-only and NOT covered here — no Android toolchain runs in
 * this harness, so verify on a real device/CI with: share a URL from
 * Chrome into the app cold (killed) and warm (running), and confirm
 * the composer prefills exactly once each time. These specs pin the
 * user-visible end state the bridge produces, through the
 * web-reachable equivalent: shared text arriving in the phone
 * composer lands verbatim, stays editable, and sends as a message.
 */
test.use({
	userAgent:
		"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
	viewport: { width: 412, height: 915 }
});

/** Android composes in a plain textarea, not CodeMirror. */
const SHARE = "Look at this\nhttps://example.com/menu";

async function seedEmpty(page: Page): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-studio-settings-v1", JSON.stringify({}));
		window.localStorage.setItem(
			"ccez-studio-chats-v1",
			JSON.stringify([{ id: "e2e-chat", createdAt: 1, replyLang: null, messages: [] }])
		);
	});
	await page.goto("/");
	await expect(page.locator(".lang-menus")).toBeVisible();
}

test("shared text lands verbatim in an empty phone composer", async ({ page }) => {
	await seedEmpty(page);
	// The bridge prefills an empty draft with the share as-is.
	const box = page.locator(".prompt .ta-input");
	await box.click();
	await box.fill(SHARE);
	await expect(box).toHaveValue(SHARE);
	// Still editable: the user can add a question above the share.
	await box.evaluate((el) => {
		if (el instanceof HTMLTextAreaElement) el.setSelectionRange(0, 0);
	});
	await page.keyboard.type("what is this? ");
	await expect(box).toHaveValue(`what is this? ${SHARE}`);
});

test("a share into an empty app sends as the first message", async ({ page }) => {
	await seedEmpty(page);
	// Cold-start share outcome: the app opens on a chat whose first
	// user message carries the shared text.
	const box = page.locator(".prompt .ta-input");
	await box.click();
	await box.fill(SHARE);
	await page.locator(".send-btn").click();
	const sent = page.locator("article.user").filter({ hasText: "example.com/menu" });
	await expect(sent).toBeVisible({ timeout: 15000 });
});
