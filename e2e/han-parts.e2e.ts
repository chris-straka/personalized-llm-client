import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Character components (Parts) overlay.
 *
 * Gating: the Parts button appears next to Annotate only when the
 * settings checkbox is on AND the highlight holds more than one
 * character with at least one Han character in it. Single Han
 * characters belong to Inspect; the two never crowd each other.
 * The overlay is never named "Radicals": it shows immediate
 * component splits. Han-only text defaults to Chinese with a small
 * JP/中文 toggle; kana present reads as Japanese with no toggle.
 */

/** Seed a chat, then merge the Inspect toggle into stored settings. */
async function seedWithParts(page: Page, enabled: boolean, content: string): Promise<void> {
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

/** Triple-click selects the whole paragraph (multi-char by construction). */
async function selectParagraph(page: Page): Promise<void> {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	await page.mouse.click(box.x + 20, box.y + box.height / 2, { clickCount: 3 });
	await expect(page.locator(".sel-menu")).toBeVisible();
}

test("no Parts button anywhere when the setting is off", async ({ page }) => {
	await seedWithParts(page, false, "漢語");
	await selectParagraph(page);
	const menu = page.locator(".sel-menu");
	await expect(menu.locator("button")).toHaveCount(1);
	await expect(menu.locator('button:has-text("Annotate")')).toBeVisible();
	await expect(menu.locator('button:has-text("Parts")')).toHaveCount(0);
});

test("multi-character Han highlight gains Parts next to Annotate (no Inspect)", async ({
	page
}) => {
	await seedWithParts(page, true, "漢語");
	await selectParagraph(page);
	const menu = page.locator(".sel-menu");
	await expect(menu.locator('button:has-text("Annotate")')).toBeVisible();
	await expect(menu.locator('button:has-text("Parts")')).toBeVisible();
	await expect(menu.locator('button:has-text("Inspect")')).toHaveCount(0);
});

test("Parts opens the components overlay with a JP/中文 toggle", async ({ page }) => {
	await seedWithParts(page, true, "漢語");
	await selectParagraph(page);
	await page.locator('.sel-menu button:has-text("Parts")').click();
	const overlay = page.locator("#han-parts-overlay");
	await expect(overlay).toBeVisible();
	await expect(overlay).toContainText("Character components");
	await expect(overlay).not.toContainText("Radical");
	await expect(overlay).toContainText("漢");
	await expect(overlay).toContainText("氵");
	// Han-only text defaults to Chinese with a toggle to flip it.
	const toggle = overlay.locator(".hp-toggle");
	await expect(toggle).toBeVisible();
	await expect(overlay.locator(".hp-char").first()).toHaveAttribute("lang", "zh-CN");
	await toggle.locator('button:has-text("JP")').click();
	await expect(overlay.locator(".hp-char").first()).toHaveAttribute("lang", "ja-JP");
	// Esc closes the overlay.
	await page.keyboard.press("Escape");
	await expect(overlay).toHaveCount(0);
});

test("kana-mixed highlight reads Japanese with no toggle", async ({ page }) => {
	await seedWithParts(page, true, "漢字を読む");
	await selectParagraph(page);
	await expect(page.locator('.sel-menu button:has-text("Parts")')).toBeVisible();
	await page.locator('.sel-menu button:has-text("Parts")').click();
	const overlay = page.locator("#han-parts-overlay");
	await expect(overlay).toBeVisible();
	await expect(overlay.locator(".hp-toggle")).toHaveCount(0);
	await expect(overlay.locator(".hp-char").first()).toHaveAttribute("lang", "ja-JP");
});

test("single Han character still shows Inspect, not Parts", async ({ page }) => {
	await seedWithParts(page, true, "語");
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	await page.mouse.dblclick(box.x + 20, box.y + box.height / 2);
	const menu = page.locator(".sel-menu");
	await expect(menu).toBeVisible();
	await expect(menu.locator('button:has-text("Inspect")')).toBeVisible();
	await expect(menu.locator('button:has-text("Parts")')).toHaveCount(0);
});
