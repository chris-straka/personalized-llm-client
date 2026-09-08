import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

const SENTENCE = "テストを確認しました。何かお手伝いできることはありますか？";

test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: SENTENCE }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
});

async function clickText(page: Page, count: 1 | 2 | 3): Promise<void> {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	if (count === 1) await page.mouse.click(box.x + 20, box.y + box.height / 2);
	else if (count === 2) await page.mouse.dblclick(box.x + 20, box.y + box.height / 2);
	else await page.mouse.click(box.x + 20, box.y + box.height / 2, { clickCount: 3 });
}

/** Spaceless scripts have no words to pick: double-click keeps the
native fragment (and still summons the menu). */
test("double-click in Japanese keeps the word pick", async ({ page }) => {
	await clickText(page, 2);
	await expect(page.locator(".sel-menu")).toBeVisible();
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("テスト");
});

/** Triple-click grows the pick to the engine's sentence break. */
test("triple-click in Japanese selects the sentence", async ({ page }) => {
	await clickText(page, 3);
	await expect(page.locator(".sel-menu")).toBeVisible();
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("テストを確認しました。");
});

/** The sentence grows around the click point, not the paragraph start. */
test("triple-click on the second sentence selects it", async ({ page }) => {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2, { clickCount: 3 });
	await expect(page.locator(".sel-menu")).toBeVisible();
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("何かお手伝いできることはありますか？");
});

/** Plain clicks on blank space drop a stale highlight, never re-summon. */
test("clicking blank space deselects instead of reopening the menu", async ({ page }) => {
	await clickText(page, 2);
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.waitForTimeout(2100);
	await expect(page.locator(".sel-menu")).toHaveCount(0);
	await page.mouse.click(10, 300);
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("");
	await expect(page.locator(".sel-menu")).toHaveCount(0);
});

/** Select a quote and open its comment box through the real UI. */
async function openAnnotate(page: Page, quote: string): Promise<void> {
	await page.locator(`article .rendered:has-text("${quote}")`).first().selectText();
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
}

/** File the open comment box (empty comment allowed) and submit it. */
async function submitAnnotation(page: Page): Promise<void> {
	await page.keyboard.press("Enter");
	await page.locator(".cm-content").click();
	await page.keyboard.type("go");
	await page.keyboard.press("Enter");
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1);
}

/** Clicking off an empty draft cancels: no ghost annotation is filed. */
test("clicking off an empty draft cancels the annotation", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.mouse.click(10, 300);
	await expect(page.locator(".ann-pop")).toHaveCount(0);
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveCount(0);
});

/** Enter with no text files the (empty) annotation for submit. */
test("enter with an empty draft files the annotation", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.keyboard.press("Enter");
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveText("1");
});

/** Re-pressing the open badge closes its edit menu like cancel. */
test("badge re-press closes the edit menu", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await submitAnnotation(page);
	const badge = page.locator("button.ccez-ann-badge").first();
	const box = await badge.boundingBox();
	if (!box) throw new Error("badge has no box");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page.locator(".ann-pop")).toHaveCount(0);
});

/** The review popup shows quotes with note: labels, no Selected text. */
test("review popup uses note labels", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.keyboard.type("meaning?");
	await submitAnnotation(page);
	await page.locator(".prompt-tools .ann-pill").click();
	const review = page.locator(".prompt-tools .review");
	await expect(review).toBeVisible();
	await expect(review).toContainText("note:");
	await expect(review).not.toContainText("Selected text");
	await expect(review).not.toContainText("User comment");
});

/** An annotations-only message renders folded with its quotes previewed. */
test("annotations-only message renders folded", async ({ page }) => {
	await seedChat(page, [
		{
			role: "user",
			content: 'Annotated selections:\n1. "風に舞う" — What does this mean?\n2. "夕暮れの公園で" — What does this mean?'
		}
	]);
	await page.reload();
	const article = page.locator("article.user");
	await expect(article).toBeVisible();
	const preview = article.locator(".folded-preview");
	await expect(preview).toContainText("風に舞う");
	await expect(article.locator(".ann-refs-pill")).toBeVisible();
	// Unfolding reveals the full block and drops the pill.
	await article.locator('.actions button[aria-label="Unfold this message"]').click();
	await expect(article.locator(".rendered")).toContainText("Annotated selections:");
	await expect(article.locator(".ann-refs-pill")).toHaveCount(0);
	// Refolding restores the compact view.
	await article.locator('.actions button[aria-label="Fold this message"]').click();
	await expect(article.locator(".folded-preview")).toBeVisible();
});

/** No message row offers an audio download anymore. */
test("message rows have no download button", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "hello" },
		{ role: "assistant", content: "hi there" }
	]);
	await page.reload();
	for (const role of ["user", "assistant"] as const) {
		await page.locator(`article.${role} .rendered`).first().hover();
		await expect(
			page.locator(`article.${role} .actions [aria-label="Download audio for this message"]`)
		).toHaveCount(0);
	}
});
