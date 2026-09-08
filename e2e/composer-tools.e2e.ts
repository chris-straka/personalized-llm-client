import { test, expect, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "alpha beta gamma delta" }]);
	await page.goto("/");
	await expect(page.locator("article.assistant .rendered")).toBeVisible({
		timeout: 60_000
	});
});

/** Select a word and save it as an annotation; resolves with the badge. */
async function addAnnotation(page: Page) {
	await page.locator("article.assistant .rendered").dblclick();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await page.keyboard.press("Enter");
	const badge = page.locator(".prompt-tools .ann-pill");
	await expect(badge).toHaveText("1");
	return badge;
}

test("voice toggle is an icon with no text", async ({ page }) => {
	const voice = page.locator(".prompt-tools .voice-float");
	await expect(voice).toBeVisible();
	expect((await voice.innerText()).trim()).toBe("");
	expect(await voice.locator("svg").count()).toBe(1);
});

test("annotation tracker is a count badge left of the paperclip", async ({
	page
}) => {
	const badge = await addAnnotation(page);
	const badgeBox = await badge.boundingBox();
	const attachBox = await page.locator(".prompt-tools .attach-btn").boundingBox();
	if (!badgeBox || !attachBox) throw new Error("missing tool boxes");
	expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(attachBox.x);
	// The word "annotations" appears nowhere visible in the tools.
	expect(await page.locator(".prompt-tools").innerText()).not.toContain("nnotation");
});

test("popup touches the badge and clear-all lives inside it", async ({ page }) => {
	const badge = await addAnnotation(page);

	// Hover the badge: the popup opens flush against it, so the
	// pointer reaches it without crossing dead hover space.
	await badge.hover();
	const review = page.locator(".prompt-tools .review");
	await expect(review).toBeVisible();
	const reviewBox = await review.boundingBox();
	const wrapBox = await page.locator(".prompt-tools .ann-wrap").boundingBox();
	if (!reviewBox || !wrapBox) throw new Error("missing popup boxes");
	expect(reviewBox.y + reviewBox.height).toBeGreaterThanOrEqual(wrapBox.y - 1);

	// Clear-all is inside the popup now, not beside the badge.
	await expect(page.locator(".prompt-tools .ann-clear")).toHaveCount(0);
	await page.locator(".review-tools button").click();
	await expect(badge).toHaveCount(0);
});
