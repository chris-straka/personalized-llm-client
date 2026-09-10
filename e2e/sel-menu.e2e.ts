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
and whole-message copy/speak live on the action rows. */
test("selection menu offers only Annotate", async ({ page }) => {
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
