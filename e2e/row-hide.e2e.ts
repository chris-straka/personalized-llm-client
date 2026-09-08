import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

test.beforeEach(async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "hello there" },
		{ role: "assistant", content: "hi back at you" }
	]);
	await page.goto("/");
	await expect(page.locator("article.user .actions")).toBeVisible({ timeout: 60_000 });
});

for (const role of ["user", "assistant"] as const) {
	test(`${role} row hides moving to its own body`, async ({ page }) => {
		const row = page.locator(`article.${role} .actions`);
		const body = page.locator(`article.${role} .rendered`);
		await expect(row).toHaveCSS("opacity", "0");
		await row.hover();
		await expect(row).toHaveCSS("opacity", "1");
		// Slide onto the message body (same article): row-only reveal
		// means the row must go back to hidden.
		await body.hover();
		await expect(row).toHaveCSS("opacity", "0");
	});

	test(`${role} row hides after clicking a button`, async ({ page }) => {
		const row = page.locator(`article.${role} .actions`);
		const body = page.locator(`article.${role} .rendered`);
		await row.hover();
		await expect(row).toHaveCSS("opacity", "1");
		await page.locator(`article.${role} .actions button[title="Copy as plain text"]`).click();
		await body.hover();
		await expect(row).toHaveCSS("opacity", "0");
	});
}

test("assistant row hides after fold jumps the layout", async ({ page }) => {
	const row = page.locator("article.assistant .actions");
	await row.hover();
	await expect(row).toHaveCSS("opacity", "1");
	await page.locator('article.assistant .actions button[title="Fold this message"]').click();
	// The collapse moves the row: focus must not trap it visible.
	await page.mouse.move(2, 2);
	await expect(row).toHaveCSS("opacity", "0");
});

test("assistant row hides after speak click", async ({ page }) => {
	const row = page.locator("article.assistant .actions");
	const body = page.locator("article.assistant .rendered");
	await row.hover();
	await expect(row).toHaveCSS("opacity", "1");
	await page.locator("article.assistant .actions button").nth(3).click();
	await body.hover();
	await expect(row).toHaveCSS("opacity", "0");
});

test("row stays visible while its button holds keyboard focus", async ({ page }) => {
	// No mouse involved: tab-focus must keep its row readable, and
	// releasing focus hides it again. This is the one state where
	// buttons legitimately outlast hovering.
	const row = page.locator("article.assistant .actions");
	const btn = page.locator('article.assistant .actions button[title="Copy as plain text"]');
	await expect(row).toHaveCSS("opacity", "0");
	await btn.focus();
	await expect(row).toHaveCSS("opacity", "1");
	await page.evaluate(() => {
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
	});
	await expect(row).toHaveCSS("opacity", "0");
});
