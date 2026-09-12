import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Streaming integrity on the mock provider: the reply lands exactly
 * once with its full text, and the visible text only ever grows (no
 * truncation flicker, no duplicated chunks).
 */

test("stream renders exactly one reply with the full text", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	await page.locator(".cm-content").click();
	await page.keyboard.type("integrity check");
	await page.keyboard.press("Enter");
	const body = page.locator("article.assistant .rendered");
	await expect(body).toContainText("Mock reply to: integrity check", { timeout: 15_000 });
	await expect(page.locator("article.assistant")).toHaveCount(1);
	await expect(body).toHaveText("Mock reply to: integrity check");
});

test("visible stream text grows monotonically, never flickers", async ({ page }) => {
	await seedChat(page, []);
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-word-ms", "60");
	});
	await page.goto("/");
	await expect(page.locator(".hero")).toBeVisible({ timeout: 60_000 });
	await page.locator(".cm-content").click();
	await page.keyboard.type("monotonic stream sampling probe");
	await page.keyboard.press("Enter");
	const body = page.locator("article.assistant .rendered");
	await expect(body).toBeVisible({ timeout: 15_000 });
	const samples: string[] = [];
	for (let i = 0; i < 8; i++) {
		samples.push(((await body.textContent()) ?? "").trim());
		await page.waitForTimeout(150);
	}
	await expect(body).toContainText("Mock reply to: monotonic stream sampling probe", {
		timeout: 15_000
	});
	const final = (((await body.textContent()) ?? "").trim());
	// Every mid-stream sample is a prefix of the final text: tokens only
	// append (map + accumulator), the DOM never rewinds or restates.
	for (const sample of samples) {
		expect(final.startsWith(sample)).toBe(true);
	}
	expect(final).toBe("Mock reply to: monotonic stream sampling probe");
	await expect(page.locator("article.assistant")).toHaveCount(1);
});
