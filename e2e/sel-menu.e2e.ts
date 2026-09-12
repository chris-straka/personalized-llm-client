import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

const SENTENCE = "テストを確認しました。何かお手伝いできることはありますか？";

test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: SENTENCE }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
});

async function selectWord(page: Page): Promise<void> {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	await page.mouse.dblclick(box.x + 20, box.y + box.height / 2);
	await expect(page.locator(".sel-menu")).toBeVisible();
}

/** The dev shell flashes a bridge-error toast on load that overlaps
the menu: real users wait it out (8s), so the clicking tests do too. */
async function waitForToastToFade(page: Page): Promise<void> {
	await page.locator(".toast").waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
}

/** The menu is Annotate alone: the OS bubble owns Copy/Translate,
and whole-message copy/speak live on the action rows. (Character
components come back as a later TODO, after latex/code rendering.) */
test("selection menu offers Annotate alone", async ({ page }) => {
	await selectWord(page);
	const menu = page.locator(".sel-menu");
	await expect(menu.locator("button")).toHaveCount(1);
	await expect(menu.locator('button:has-text("Annotate")')).toBeVisible();
});

/** Annotate opens the comment pill for the quote and stands the
menu down. */
test("Annotate opens the pill for the quote", async ({ page }) => {
	await waitForToastToFade(page);
	await selectWord(page);
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
});

/** The menu floats down and left of the cursor that finished the
gesture (never under it), still above the highlight and clamped to
the viewport. */
test("menu sits down and left of the cursor", async ({ page }) => {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	const cx = box.x + 20;
	await page.mouse.dblclick(cx, box.y + box.height / 2);
	const menu = page.locator(".sel-menu");
	await expect(menu).toBeVisible();
	const menuBox = await menu.boundingBox();
	if (!menuBox) throw new Error("menu has no box");
	const geom = await page.evaluate(() => {
		const r = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
		if (!r) return null;
		return { top: r.top, viewport: window.innerWidth };
	});
	if (!geom) throw new Error("no selection rect");
	// Left edge sits left of the cursor (was clamped exactly to it).
	expect(menuBox.x).toBeLessThan(cx);
	// Below the old above-slot, still hovering clear of the highlight.
	expect(menuBox.y).toBeGreaterThan(geom.top - 47);
	expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(geom.top + 1);
	// Viewport clamping holds on both edges.
	expect(menuBox.x).toBeGreaterThanOrEqual(0);
	expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(geom.viewport);
});

/** Right-clicking empty space never starts audio: nothing speaks and nothing selects. */
test("right-click on empty space stays silent", async ({ page }) => {
	await page.mouse.click(10, 300, { button: "right" });
	await page.waitForTimeout(500);
	await expect(page.locator("article.speaking, article.speaking-sel")).toHaveCount(0);
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("");
});
