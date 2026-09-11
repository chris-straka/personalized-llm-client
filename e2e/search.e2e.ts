import { test, expect, type Page } from "@playwright/test";

/**
 * Search-mobile bucket: the Ctrl+P / Cmd+P command palette (Worker
 * index, IndexedDB snapshot, in-memory fallback), the sidebar search
 * box behind the left-to-right swipe, and the touch paste-images
 * button. Written, not run, per the bucket brief (shared dev-server
 * port) — run with `bun run test:e2e e2e/search.e2e.ts`.
 */

async function seedThreeChats(page: Page): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-studio-settings-v1", JSON.stringify({}));
		const msg = (id: string, content: string) => ({
			id,
			role: "assistant",
			content,
			usage: null,
			error: null
		});
		window.localStorage.setItem(
			"ccez-studio-chats-v1",
			JSON.stringify([
				{ id: "chat-ramen", createdAt: 1, replyLang: null, messages: [msg("m1", "ramen recipe with miso broth")] },
				{ id: "chat-sushi", createdAt: 2, replyLang: null, messages: [msg("m2", "sushi rice vinegar ratio")] },
				{ id: "chat-cjk", createdAt: 3, replyLang: null, messages: [msg("m3", "今天的中文菜单")] }
			])
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
}

test.describe("search palette", () => {
	test("Ctrl+P opens the palette and finds a message", async ({ page }) => {
		await seedThreeChats(page);
		await page.keyboard.press("Control+p");
		await expect(page.getByRole("dialog", { name: "Search chats" })).toBeVisible();
		await page.getByLabel("Search chats and annotations").fill("ramen");
		await expect(page.locator(".search-hit").first()).toContainText("ramen", { timeout: 8000 });
	});

	test("CJK query matches without whitespace boundaries", async ({ page }) => {
		await seedThreeChats(page);
		await page.keyboard.press("Control+p");
		await page.getByLabel("Search chats and annotations").fill("中文");
		await expect(page.locator(".search-hit").first()).toContainText("中文", { timeout: 8000 });
	});

	test("Enter jumps to the hit chat and Esc closes", async ({ page }) => {
		await seedThreeChats(page);
		await page.keyboard.press("Control+p");
		const box = page.getByLabel("Search chats and annotations");
		await box.fill("sushi");
		await expect(page.locator(".search-hit").first()).toContainText("sushi", { timeout: 8000 });
		await box.press("Enter");
		await expect(page.locator("article .rendered").first()).toContainText("sushi");
		await page.keyboard.press("Control+p");
		await expect(page.getByRole("dialog", { name: "Search chats" })).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog", { name: "Search chats" })).toBeHidden();
	});
});

test.describe("sidebar search", () => {
	test("typing in the sidebar box filters the chat list", async ({ page }) => {
		await seedThreeChats(page);
		await page.keyboard.press("Control+b");
		const box = page.getByLabel("Search chats");
		await expect(box).toBeVisible();
		await box.fill("sushi");
		await expect(page.locator("aside ul li")).toHaveCount(1);
		await page.getByLabel("Clear chat search").click();
		await expect(page.locator("aside ul li")).toHaveCount(3);
	});
});

test.describe("touch paths", () => {
	test.use({
		userAgent:
			"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
		viewport: { width: 412, height: 915 }
	});

	test("left-to-right swipe opens the chats sidebar with its search box", async ({ page }) => {
		await seedThreeChats(page);
		await expect(page.locator("aside")).toHaveClass(/collapsed/);
		await page.evaluate(() => {
			const touch = (x: number, y: number) =>
				new Touch({ identifier: 7, target: document.body, clientX: x, clientY: y });
			window.dispatchEvent(
				new TouchEvent("touchstart", { bubbles: true, cancelable: true, composed: true, touches: [touch(4, 600)] })
			);
			window.dispatchEvent(
				new TouchEvent("touchend", { bubbles: true, cancelable: true, composed: true, touches: [], changedTouches: [touch(200, 604)] })
			);
		});
		await expect(page.locator("aside")).not.toHaveClass(/collapsed/);
		await expect(page.getByLabel("Search chats")).toBeVisible();
	});

	test("paste-images button appears with clipboard.read and reports an empty clipboard", async ({
		page
	}) => {
		await page.addInitScript(() => {
			const nav = window.navigator as Navigator & { clipboard?: { read?: () => Promise<never[]> } };
			if (!nav.clipboard) return;
			try {
				Object.defineProperty(nav.clipboard, "read", { value: async () => [], configurable: true });
			} catch {
				// Clipboard is not patchable here; the button stays hidden.
			}
		});
		await seedThreeChats(page);
		const paste = page.getByLabel("Paste images from the clipboard");
		if ((await paste.count()) === 0) test.skip(true, "clipboard.read unavailable in this shell");
		await paste.click();
		await expect(page.locator(".error").first()).toContainText("No images on the clipboard.");
	});
});
