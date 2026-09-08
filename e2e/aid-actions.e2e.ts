import { test, expect } from "@playwright/test";
import { seedChat, rowBoxes, expectBoxesStable } from "./helpers";

const ARTICLE = "article.assistant";
const AID_TITLE = "Add tashkeel (uses the active model)";

test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "مرحبا بالعالم" }]);
	await page.goto("/");
	await expect(page.locator(`${ARTICLE} .actions`)).toBeVisible({ timeout: 60_000 });
});

test("hovering the action row moves no button and leaves no stuck hover", async ({
	page
}) => {
	const row = page.locator(`${ARTICLE} .actions`);
	const aidBtn = page.locator(`${ARTICLE} .actions button[data-tip="${AID_TITLE}"]`);

	// Hover-reveal is on: the row starts hidden.
	await expect(row).toHaveCSS("opacity", "0");
	const before = await rowBoxes(page, ARTICLE);

	// Hover the aid button: the row fades in and the button takes its
	// hover color, but no box anywhere in the row may shift.
	await aidBtn.hover();
	await expect(row).toHaveCSS("opacity", "1");
	await expect(aidBtn).toHaveCSS("color", "rgb(28, 28, 30)");
	expectBoxesStable(before, await rowBoxes(page, ARTICLE));

	// Move away: the row hides again and the button color returns to
	// base — a stuck :hover fails this.
	await page.mouse.move(2, 2);
	await expect(row).toHaveCSS("opacity", "0");
	await expect(aidBtn).toHaveCSS("color", "rgb(110, 110, 115)");
	expectBoxesStable(before, await rowBoxes(page, ARTICLE));
});

test("clicking tashkeel pins it, and show-original restores the text", async ({
	page
}) => {
	const body = page.locator(`${ARTICLE} .rendered`);
	const aidBtn = page.locator(`${ARTICLE} .actions button[data-tip="${AID_TITLE}"]`);

	await aidBtn.hover();
	await aidBtn.click();
	// The mock provider resolves immediately: the aid pins, and the
	// revert control reads in Arabic, not generic English.
	const showOriginal = page.locator(
		`${ARTICLE} .actions button[data-tip="Back to the original text"]`
	);
	await expect(showOriginal).toHaveText("إبداعي");
	await expect(body).toContainText("Mock reply to:");

	await showOriginal.click();
	await expect(aidBtn).toBeVisible();
	await expect(body).toContainText("مرحبا");
});

/** Arabic+Japanese+Chinese offers all three aids side by side. */
test("a trilingual message offers tashkeel, furigana, and pinyin", async ({
	page
}) => {
	await seedChat(page, [
		{ role: "assistant", content: "مرحبا بالعالم\nこんにちは！\n你好！" }
	]);
	await page.goto("/");
	const actions = page.locator(`${ARTICLE} .actions`);
	await expect(actions).toBeVisible({ timeout: 60_000 });
	await expect(actions.locator(`button[data-tip="${AID_TITLE}"]`)).toBeVisible();
	await expect(actions.locator('button:has-text("読み仮名")')).toBeVisible();
	await expect(actions.locator('button:has-text("拼音")')).toBeVisible();
});
