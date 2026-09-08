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

/** Triple-click keeps native behavior: the whole paragraph is picked. */
test("triple-click in Japanese selects the paragraph", async ({ page }) => {
	await clickText(page, 3);
	await expect(page.locator(".sel-menu")).toBeVisible();
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("テストを確認しました。何かお手伝いできることはありますか？");
});

/** The paragraph pick holds wherever in it the triple-click lands. */
test("triple-click on the second sentence selects the paragraph", async ({ page }) => {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2, { clickCount: 3 });
	await expect(page.locator(".sel-menu")).toBeVisible();
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("テストを確認しました。何かお手伝いできることはありますか？");
});

/** Plain clicks on blank space drop a stale highlight, never re-summon. */
test("clicking blank space deselects instead of reopening the menu", async ({ page }) => {
	await clickText(page, 2);
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.waitForTimeout(2700);
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

/** Sending files the pending annotations with the message: the composer
pill is gone while the reply is still on its way. */
test("sending clears pending annotations immediately", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.keyboard.type("meaning?");
	await page.keyboard.press("Enter");
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveText("1");
	await page.locator(".cm-content").click();
	await page.keyboard.type("go");
	// The Enter that filed the annotation must not double as a send.
	await page.waitForTimeout(600);
	await page.keyboard.press("Enter");
	// The pill leaves with the send, not with the reply.
	await expect(page.locator("article.user .rendered")).toContainText("go");
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveCount(0);
	await expect(page.locator("article.assistant .rendered").last()).toContainText("Mock reply");
	// The sent message carries the block (folded with its count).
	await expect(page.locator("article.user .ann-refs-pill")).toHaveText("1");
});

/** The pencil edits an own message in place: history stays, no reply. */
test("pencil edits an own message in place", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "helo world" },
		{ role: "assistant", content: "hi" }
	]);
	await page.reload();
	const article = page.locator("article.user");
	await expect(article).toBeVisible();
	await article.hover();
	await article.locator('.actions button[aria-label="Edit this message"]').click();
	// Nothing is deleted; the text is in the composer to fix.
	await expect(page.locator("article.user")).toHaveCount(1);
	await expect(page.locator("article.assistant")).toHaveCount(1);
	await expect(page.locator(".cm-content")).toContainText("helo world");
	// Fix the typo and save: the message rewrites, the reply stands.
	await page.locator(".cm-content").click();
	await page.keyboard.press("Control+a");
	await page.keyboard.type("hello world");
	await page.keyboard.press("Enter");
	await expect(page.locator("article.user .rendered")).toContainText("hello world");
	await expect(page.locator("article.user")).toHaveCount(1);
	await expect(page.locator("article.assistant .rendered")).toContainText("hi");
});

/** Hovering an own message and hitting E starts editing it. */
test("E key edits the hovered own message", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "helo world" }]);
	await page.reload();
	const article = page.locator("article.user");
	await expect(article).toBeVisible();
	await article.hover();
	await page.keyboard.press("e");
	await expect(page.locator(".cm-content")).toContainText("helo world");
	// Esc cancels: history untouched, composer empty.
	await page.keyboard.press("Escape");
	await expect(page.locator(".cm-content")).not.toContainText("helo world");
	await expect(page.locator("article.user .rendered")).toContainText("helo world");
});

/** Clear-all sits at the bottom-right of the review overlay. */
test("clear-all lives at the bottom of the review", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.keyboard.press("Enter");
	await page.locator(".prompt-tools .ann-pill").click();
	const review = page.locator(".prompt-tools .review");
	await expect(review).toBeVisible();
	const tools = review.locator(".review-tools");
	await expect(tools).toContainText("Clear all");
	const reviewBox = await review.boundingBox();
	const toolsBox = await tools.boundingBox();
	if (!reviewBox || !toolsBox) throw new Error("review lost its box");
	// Bottom edge: the tools row ends where the overlay ends.
	expect(reviewBox.y + reviewBox.height - (toolsBox.y + toolsBox.height)).toBeLessThan(24);
	// Right edge: the tools row ends where the overlay ends.
	expect(reviewBox.x + reviewBox.width - (toolsBox.x + toolsBox.width)).toBeLessThan(40);
	await tools.locator("button").click();
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveCount(0);
});
