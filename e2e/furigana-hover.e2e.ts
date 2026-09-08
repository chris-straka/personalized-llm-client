import { test, expect } from "@playwright/test";
import { seedChat, rowBoxes, expectBoxesStable } from "./helpers";

const ARTICLE = "article.assistant";

// First run pays the dictionary build (tens of seconds), like furigana.e2e.ts.
test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "漢字を読むテスト" }]);
	await page.goto("/");
	await expect(page.locator(`${ARTICLE} .actions`)).toBeVisible({ timeout: 60_000 });
});

test("hovering furigana fetches nothing; clicking fetches with dots", async ({
	page
}) => {
	const body = page.locator(`${ARTICLE} .rendered`);
	const furiganaBtn = page.locator(
		`${ARTICLE} .actions button[data-tip="Add furigana"]`
	);
	// Dots mount only while busy: an idle aid button is exactly its
	// visible label, so hover and spacing never cover text that isn't
	// there. (The :not(.off) keeps matching — no button carries .off.)
	const dots = page.locator(`${ARTICLE} .actions .tdots:not(.off)`);
	const before = await rowBoxes(page, ARTICLE);
	const beforeHtml = await body.innerHTML();

	// Hover must not start the dictionary load: no lit dots, no ruby,
	// the Japanese untouched, no button nudged.
	await furiganaBtn.hover();
	await page.waitForTimeout(1500);
	await expect(dots).toHaveCount(0);
	expect(await body.innerHTML()).toBe(beforeHtml);
	expect(await body.locator("ruby").count()).toBe(0);
	expectBoxesStable(before, await rowBoxes(page, ARTICLE));

	// Click pins (and fetches): dots while loading, then the pinned
	// button. Conversion itself is unit-tested; e2e stays fast.
	await furiganaBtn.click();
	await expect(dots).toBeVisible({ timeout: 30_000 });
	await expect(
		page.locator(`${ARTICLE} .actions button[data-tip="オリジナルを表示"]`)
	).toBeVisible({ timeout: 60_000 });
});
