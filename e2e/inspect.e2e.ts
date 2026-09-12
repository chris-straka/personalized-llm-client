import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Character Inspect.
 *
 * Gating: the Inspect button appears next to Annotate only when the
 * settings checkbox is on AND the highlight is a single Han
 * character. It opens a modal-veil/modal overlay (same pattern as the
 * shortcuts overlay) with radicals, stroke count, and definition.
 */

/** Seed a chat, then merge the Inspect toggle into stored settings. */
async function seedWithInspect(page: Page, enabled: boolean, content: string): Promise<void> {
	await seedChat(page, [{ role: "assistant", content }]);
	await page.addInitScript((on: boolean) => {
		try {
			const raw = window.localStorage.getItem("ccez-studio-settings-v1");
			const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
			parsed["inspectEnabled"] = on;
			window.localStorage.setItem("ccez-studio-settings-v1", JSON.stringify(parsed));
		} catch {
			// Seed-order failure surfaces as a missing toggle below.
		}
	}, enabled);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
}

async function selectWord(page: Page): Promise<void> {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	await page.mouse.dblclick(box.x + 20, box.y + box.height / 2);
	await expect(page.locator(".sel-menu")).toBeVisible();
}

test("no Inspect button anywhere when the setting is off", async ({ page }) => {
	await seedWithInspect(page, false, "語");
	await selectWord(page);
	const menu = page.locator(".sel-menu");
	await expect(menu.locator("button")).toHaveCount(1);
	await expect(menu.locator('button:has-text("Annotate")')).toBeVisible();
	await expect(menu.locator('button:has-text("Inspect")')).toHaveCount(0);
});

test("single Han character gains an Inspect button next to Annotate", async ({ page }) => {
	await seedWithInspect(page, true, "語");
	await selectWord(page);
	const menu = page.locator(".sel-menu");
	await expect(menu.locator("button")).toHaveCount(2);
	await expect(menu.locator('button:has-text("Annotate")')).toBeVisible();
	await expect(menu.locator('button:has-text("Inspect")')).toBeVisible();
});

test("Inspect opens the overlay with radicals, strokes, and definition", async ({
	page
}) => {
	await seedWithInspect(page, true, "語");
	await selectWord(page);
	await page.locator('.sel-menu button:has-text("Inspect")').click();
	const modal = page.locator(".inspect-modal");
	await expect(modal).toBeVisible();
	await expect(modal).toContainText("語");
	await expect(modal).toContainText("言");
	await expect(modal).toContainText("14");
	await expect(modal).toContainText("language");
	await expect(page.locator(".modal-veil")).toBeVisible();
	// Esc closes the overlay (same contract as the shortcuts modal).
	await page.keyboard.press("Escape");
	await expect(modal).toHaveCount(0);
});

test("multi-character highlight shows Parts instead of Inspect", async ({ page }) => {
	await seedWithInspect(page, true, "漢字のテストを確認しました");
	// Triple-click selects the whole paragraph (multi-char by construction).
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	await page.mouse.click(box.x + 20, box.y + box.height / 2, { clickCount: 3 });
	const menu = page.locator(".sel-menu");
	await expect(menu).toBeVisible();
	await expect(menu.locator("button")).toHaveCount(2);
	await expect(menu.locator('button:has-text("Inspect")')).toHaveCount(0);
	await expect(menu.locator('button:has-text("Parts")')).toBeVisible();
});

test("settings panel gates the feature behind a checkbox", async ({ page }) => {
	await seedWithInspect(page, false, "語");
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
	const box = page.locator(".settings-panel").getByText("Show Inspect for single kanji/hanzi highlights");
	await expect(box).toBeVisible();
});
