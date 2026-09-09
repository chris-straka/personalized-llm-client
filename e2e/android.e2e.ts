import { test, expect, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Android milestone (S24 Galaxy): key chords don't exist on a phone, so
 * the shortcuts modal teaches touch gestures, and edge swipes open the
 * sidebars. The phone build is future work — these specs pin the
 * UA-gated branches that ship on desktop today.
 */
test.use({
	userAgent:
		"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
});

test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "hello" }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
});

/** Synthetic right-edge swipe: the phone gesture that opens settings. */
async function swipeFromRightEdge(page: Page): Promise<void> {
	const width = await page.evaluate(() => window.innerWidth);
	await page.evaluate((w: number) => {
		const touch = (x: number, y: number) =>
			new Touch({ identifier: 9, target: document.body, clientX: x, clientY: y });
		window.dispatchEvent(
			new TouchEvent("touchstart", { bubbles: true, cancelable: true, composed: true, touches: [touch(w - 4, 600)] })
		);
		window.dispatchEvent(
			new TouchEvent("touchend", {
				bubbles: true,
				cancelable: true,
				composed: true,
				touches: [],
				changedTouches: [touch(w - 140, 604)]
			})
		);
	}, width);
}

test("shortcuts modal teaches touch gestures on Android", async ({ page }) => {
	await swipeFromRightEdge(page);
	await page.locator('button:has-text("Show all gestures")').click();
	await expect(page.locator("#shortcuts-heading")).toBeVisible();
	await expect(page.locator("#shortcuts-heading")).toHaveText("Touch gestures");
	const modal = page.locator(".modal-veil");
	await expect(modal.locator('dt:has-text("Chats list")')).toBeVisible();
	await expect(modal.locator("dd:has-text(\"Swipe right from the left edge\")")).toBeVisible();
	await expect(modal.locator('dt:has-text("Chats sidebar")')).toHaveCount(0);
	await expect(modal.locator('dt:has-text("Newer / older chat")')).toBeVisible();
	await expect(modal.locator('dt:has-text("Delete current chat")')).toBeVisible();
	await expect(modal.locator('dt:has-text("Reply language")')).toBeVisible();
});

/** Synthetic edge swipe (untrusted TouchEvents still hit window listeners). */
async function swipeFromLeftEdge(page: Page): Promise<void> {
	await page.evaluate(() => {
		const touch = (x: number, y: number) =>
			new Touch({ identifier: 7, target: document.body, clientX: x, clientY: y });
		window.dispatchEvent(
			new TouchEvent("touchstart", { bubbles: true, cancelable: true, composed: true, touches: [touch(4, 600)] })
		);
		window.dispatchEvent(
			new TouchEvent("touchend", {
				bubbles: true,
				cancelable: true,
				composed: true,
				touches: [],
				changedTouches: [touch(140, 604)]
			})
		);
	});
}

test("edge swipe from the left toggles the chat sidebar", async ({ page }) => {
	const aside = page.locator("aside:has(button.side-chat)");
	// State varies by persisted settings; read it, then flip twice.
	const startedOpen = !(await aside.getAttribute("class"))?.includes("collapsed");
	await swipeFromLeftEdge(page);
	if (startedOpen) await expect(aside).toHaveClass(/collapsed/);
	else await expect(aside).not.toHaveClass(/collapsed/);
	await swipeFromLeftEdge(page);
	if (startedOpen) await expect(aside).not.toHaveClass(/collapsed/);
	else await expect(aside).toHaveClass(/collapsed/);
});

/** Synthetic mid-screen swipe (same untrusted-event path as edges). */
async function swipeMidScreen(page: Page, x0: number, x1: number): Promise<void> {
	await page.evaluate(
		({ x0, x1 }: { x0: number; x1: number }) => {
			const touch = (x: number, y: number) =>
				new Touch({ identifier: 9, target: document.body, clientX: x, clientY: y });
			window.dispatchEvent(
				new TouchEvent("touchstart", { bubbles: true, cancelable: true, composed: true, touches: [touch(x0, 600)] })
			);
			window.dispatchEvent(
				new TouchEvent("touchend", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [],
					changedTouches: [touch(x1, 604)]
				})
			);
		},
		{ x0, x1 }
	);
}

test("mid-screen swipe right toggles the chat sidebar", async ({ page }) => {
	const aside = page.locator("aside:has(button.side-chat)");
	const startedOpen = !(await aside.getAttribute("class"))?.includes("collapsed");
	await swipeMidScreen(page, 150, 260);
	if (startedOpen) await expect(aside).toHaveClass(/collapsed/);
	else await expect(aside).not.toHaveClass(/collapsed/);
});

test("mid-screen swipe left toggles the settings panel", async ({ page }) => {
	const panel = page.locator(".settings-panel");
	const startedOpen = !(await panel.getAttribute("class"))?.includes("closed");
	await swipeMidScreen(page, 260, 150);
	if (startedOpen) await expect(panel).toHaveClass(/closed/);
	else await expect(panel).not.toHaveClass(/closed/);
});
