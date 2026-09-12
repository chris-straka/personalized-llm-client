import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Shortcuts-modal pile: the first entry names the modal toggle
 * ("Shortcuts show/hide" + middle-click), the list stays pithy
 * with no parentheticals and no removed right-click speak rows,
 * and middle-click anywhere opens the modal.
 */
test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "hello" },
		{ role: "assistant", content: "hi there" }
	]);
	await page.goto("/");
	await page.locator(".prompt .cm-content").waitFor({ timeout: 60_000 });
});

async function openShortcuts(page): Promise<void> {
	await page.keyboard.press("Control+Shift+Slash");
	await expect(page.locator(".modal", { hasText: "Keyboard shortcuts" })).toBeVisible({
		timeout: 10_000
	});
}

test("first entry toggles the modal; list is pithy with current keys", async ({ page }) => {
	await openShortcuts(page);
	const keys = page.locator(".modal .keys");
	// First entry owns the modal toggle.
	expect(await keys.locator("div > dt").first().innerText()).toBe("Shortcuts show/hide");
	await expect(keys.locator("div").first()).toContainText("middle-click");
	// Newer global keys are folded in.
	for (const name of ["Send message", "New chat", "Edit own message", "Focus composer"]) {
		await expect(keys.locator("div > dt", { hasText: name })).toBeVisible();
	}
	// Removed behavior stays out: right-click never starts audio.
	expect(await keys.locator("div > dt", { hasText: "Speak hovered word" }).count()).toBe(0);
	expect(await keys.locator("div > dt", { hasText: "Speak highlight" }).count()).toBe(0);
	// No paren spam in the entry copy (each dd reads flat).
	const details = await keys.locator("dd").allInnerTexts();
	expect(details.join("\n")).not.toContain("(");
});

test("middle-click opens the shortcuts modal", async ({ page }) => {
	await openShortcuts(page);
	await page.keyboard.press("Escape");
	await expect(page.locator(".modal", { hasText: "Keyboard shortcuts" })).toBeHidden({
		timeout: 10_000
	});
	await page.mouse.click(640, 300, { button: "middle" });
	await expect(page.locator(".modal", { hasText: "Keyboard shortcuts" })).toBeVisible({
		timeout: 10_000
	});
});
