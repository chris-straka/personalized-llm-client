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

/** The prompt grows with the draft, then stops and scrolls inside. */
test("long drafts cap the prompt height and scroll", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await page.locator(".cm-content").click();
	for (let i = 0; i < 15; i++) {
		await page.keyboard.type(`draft line ${i + 1}`);
		await page.keyboard.press("Shift+Enter");
	}
	const sizes = await page.evaluate(() => {
		const scroller = document.querySelector(".prompt .cm-scroller");
		if (!(scroller instanceof HTMLElement)) return null;
		return { client: scroller.clientHeight, scroll: scroller.scrollHeight };
	});
	if (!sizes) throw new Error("prompt scroller missing");
	// 12rem cap ≈ 192px at the default root size; stay well under it
	// while the content overflows into a scroll.
	expect(sizes.client).toBeLessThanOrEqual(210);
	expect(sizes.scroll).toBeGreaterThan(sizes.client);
});

/** The prompt review card fades in on hover and out on leave (opacity
and visibility transition, never a display snap). */
test("prompt review card fades in and out", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "fading review card" }]);
	await page.goto("/");
	await page.locator('article .rendered:has-text("fading review card")').first().selectText();
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await page.keyboard.press("Enter");
	const pill = page.locator(".prompt-tools .ann-pill");
	await expect(pill).toBeVisible();
	const card = page.locator(".ann-wrap .review");
	const opacity = () => card.evaluate((el) => getComputedStyle(el).opacity);
	// Closed: invisible but laid out (display fade needs the box).
	expect(await opacity()).toBe("0");
	const box = await pill.boundingBox();
	if (!box) throw new Error("pill has no box");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await expect.poll(opacity, { timeout: 2000 }).toBe("1");
	await page.mouse.move(4, 300);
	await expect.poll(opacity, { timeout: 2000 }).toBe("0");
});

/** The draft text uses the same typeface as the chat messages — the
composer is a message being written, not a code editor. */
test("prompt typeface matches the chat typeface", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "same typeface" }]);
	await page.goto("/");
	// Raw evaluate does not auto-wait like locators do: hold for
	// hydration before reading computed styles.
	await page.locator(".prompt .cm-content").waitFor();
	await page.locator('article[id^="msg-"] .rendered').waitFor();
	const fonts = await page.evaluate(() => {
		const cm = document.querySelector(".prompt .cm-content");
		const msg = document.querySelector('article[id^="msg-"] .rendered');
		if (!(cm instanceof HTMLElement) || !(msg instanceof HTMLElement)) return null;
		return {
			prompt: getComputedStyle(cm).fontFamily,
			message: getComputedStyle(msg).fontFamily,
		};
	});
	if (!fonts) throw new Error("prompt or message node missing");
	expect(fonts.prompt).toBe(fonts.message);
	expect(fonts.prompt).not.toMatch(/fira|mono/i);
});

/** A cleared highlight drops the menu at once — taps elsewhere and
handle collapses never pass through the summon paths, so without a
selectionchange dismiss the menu stranded until the 2.5s timer. */
test("a cleared highlight drops the menu at once", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "prompt halo" }]);
	await page.goto("/");
	await page.locator('article .rendered:has-text("prompt halo")').first().selectText();
	await page.mouse.up();
	const menu = page.locator(".sel-menu");
	await expect(menu).toBeVisible();
	await page.evaluate(() => window.getSelection()?.removeAllRanges());
	await expect(menu).toHaveCount(0, { timeout: 1500 });
});
