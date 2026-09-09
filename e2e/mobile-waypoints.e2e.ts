import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

test.use({ hasTouch: true, isMobile: true });

function tenTurns(): Array<{ role: "user" | "assistant"; content: string }> {
	return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => [
		{ role: "user" as const, content: `question ${n}` },
		{ role: "assistant" as const, content: `answer ${n}` }
	]);
}

test.beforeEach(async ({ page }) => {
	await seedChat(page, tenTurns());
	await page.goto("/");
	await expect(page.locator(".wp-jump")).toBeVisible({ timeout: 60_000 });
});

test("jump icon replaces ticks, opens a bottom sheet", async ({ page }) => {
	await expect(page.locator(".wp-btn")).toBeHidden();
	const jump = page.locator(".wp-jump");
	await expect(jump).toHaveAttribute("aria-expanded", "false");

	await jump.tap();
	await expect(jump).toHaveAttribute("aria-expanded", "true");
	const menu = page.locator(".wp-menu");
	await expect(menu).toBeVisible();
	await expect(page.locator(".wp-veil")).toBeVisible();
	// Sheet spans the viewport width, pinned near the bottom.
	const box = await menu.boundingBox();
	expect(box).not.toBeNull();
	expect(box!.width).toBeGreaterThan(300);
	expect(box!.y).toBeGreaterThan(300);
});

test("sheet item jumps and closes", async ({ page }) => {
	await page.locator(".wp-jump").tap();
	await page.locator('.wp-menu button[role="menuitem"]').last().tap();
	await expect(page.locator(".wp-menu")).toBeHidden();
	await expect(page.locator(".wp-jump")).toBeVisible();
});

test("long lists scroll inside the sheet", async ({ page }) => {
	await page.locator(".wp-jump").tap();
	const menu = page.locator(".wp-menu");
	await expect(menu).toBeVisible();
	const overflowing = await menu.evaluate(
		(el) => el.scrollHeight > el.clientHeight + 1
	);
	expect(overflowing).toBe(true);
	await expect(menu.locator('button[role="menuitem"]')).toHaveCount(10);
});

test("veil press dismisses the sheet", async ({ page }) => {
	await page.locator(".wp-jump").tap();
	await expect(page.locator(".wp-menu")).toBeVisible();
	await expect(page.locator(".wp-veil")).toBeVisible();
	// The sheet covers the veil's center: press an uncovered point
	// near the top of the screen.
	await page.touchscreen.tap(40, 60);
	await expect(page.locator(".wp-menu")).toBeHidden();
});
