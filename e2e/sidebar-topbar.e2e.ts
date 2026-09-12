import { expect, test, type Page } from "@playwright/test";

const ALPHA = "Alpha active-chat message";
const BRAVO = "Bravo second-chat message";

/** Two chats: the first is active on load (loadChats lands on chats[0]). */
async function seedTwoChats(page: Page): Promise<void> {
	await page.addInitScript(
		({ a, b }: { a: string; b: string }) => {
			window.localStorage.setItem("ccez-mock-provider", "1");
			const chat = (id: string, content: string) => ({
				id,
				createdAt: 1,
				replyLang: null,
				messages: [{ id: `${id}-m`, role: "assistant", content, usage: null, error: null }]
			});
			window.localStorage.setItem(
				"ccez-studio-chats-v1",
				JSON.stringify([chat("chat-a", a), chat("chat-b", b)])
			);
		},
		{ a: ALPHA, b: BRAVO }
	);
}

const chatsAside = (page: Page) => page.locator("aside").first();
const chatRows = (page: Page) => page.locator("aside ul li button.side-chat");

async function openSidebar(page: Page): Promise<void> {
	await page.keyboard.press("Control+b");
	await expect(chatsAside(page)).not.toHaveClass(/collapsed/);
}

test.beforeEach(async ({ page }) => {
	await seedTwoChats(page);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
});

/** Clicking a chat closes the sidebar and lands on that chat. */
test("clicking a chat closes the sidebar", async ({ page }) => {
	await openSidebar(page);
	await chatRows(page).nth(1).click();
	await expect(chatsAside(page)).toHaveClass(/collapsed/);
	await expect(page.locator("main .messages")).toContainText(BRAVO);
});

/** Cmd+Shift+H opens on the current chat, so j/k starts there, not the top. */
test("Ctrl+Shift+H opens on the current chat for j/k", async ({ page }) => {
	// Make chat-b (row 1) the current chat first.
	await openSidebar(page);
	await chatRows(page).nth(1).click();
	await expect(chatsAside(page)).toHaveClass(/collapsed/);

	await page.keyboard.press("Control+Shift+H");
	await expect(chatsAside(page)).not.toHaveClass(/collapsed/);
	// Focus lands on the current chat's row (index 1), not the top.
	await expect
		.poll(() =>
			page.evaluate(
				() =>
					[...document.querySelectorAll("aside ul li button.side-chat")].indexOf(
						document.activeElement
					)
			)
		)
		.toBe(1);
	// k steps up (older) from the current chat onto chat-a.
	await page.keyboard.press("k");
	await expect(page.locator("main .messages")).toContainText(ALPHA);
});

/** Double-tap on non-button sidebar areas closes it; buttons keep working. */
test("double-tap on sidebar chrome closes it, on buttons does not", async ({ page }) => {
	await openSidebar(page);
	// A row button double-tap is a button action: the list stays open.
	await chatRows(page).nth(0).dispatchEvent("dblclick");
	await expect(chatsAside(page)).not.toHaveClass(/collapsed/);
	// Non-button sidebar chrome (the list padding) closes the list.
	await page.locator("aside ul").first().dispatchEvent("dblclick");
	await expect(chatsAside(page)).toHaveClass(/collapsed/);
});

/** The find bar pushes content down instead of covering the top message. */
test("open find never covers the top message", async ({ page }) => {
	await page.keyboard.press("Control+f");
	const bar = page.locator(".find-bar");
	await expect(bar).toBeVisible();
	const overlap = await page.evaluate(() => {
		const barEl = document.querySelector(".find-bar") as HTMLElement | null;
		const art = document.querySelector(".messages article") as HTMLElement | null;
		if (!barEl || !art) return null;
		const barBox = barEl.getBoundingClientRect();
		const artBox = art.getBoundingClientRect();
		const barPos = getComputedStyle(barEl).getPropertyValue("position");
		return { barBottom: barBox.bottom, artTop: artBox.top, barPos };
	});
	expect(overlap).not.toBeNull();
	expect(overlap!.barPos).not.toBe("fixed");
	expect(overlap!.artTop).toBeGreaterThanOrEqual(overlap!.barBottom - 1);
});
