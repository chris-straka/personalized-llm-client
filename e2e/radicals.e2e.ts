import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

const SENTENCE = "日本語を確認しました。何かお手伝いできることはありますか？";

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

/** A Radicals button sits next to Annotate in the selection menu. */
test("selection menu offers Radicals next to Annotate", async ({ page }) => {
	await selectWord(page);
	const menu = page.locator(".sel-menu");
	await expect(menu.locator('button:has-text("Annotate")')).toBeVisible();
	await expect(menu.locator('button:has-text("Radicals")')).toBeVisible();
});

/** Radicals opens the components overlay over the selection; the
overlay reuses the annotation card styling and closes on demand. */
test("Radicals opens the components overlay and it closes", async ({ page }) => {
	await waitForToastToFade(page);
	await selectWord(page);
	await page.locator('.sel-menu button:has-text("Radicals")').click();
	const overlay = page.locator("#radicals-overlay");
	await expect(overlay).toBeVisible();
	await expect(overlay).toHaveAttribute("role", "dialog");
	// Overlay reuses the annotation pop card class (no redesign).
	await expect(overlay).toHaveClass(/ann-pop/);
	await overlay.locator('button:has-text("Close")').click();
	await expect(overlay).toBeHidden();
});
