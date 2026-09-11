import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/** Research side panel toggle contract (browser fallback: no Tauri
shell here, so Cmd+T docks a DOM strip with an external link instead
of a second OS webview — same toggle state, engine switcher, and
Esc behavior; the shell-only webview dock is hand-verified in
`tauri dev`). */
test("research toggle opens, switches engine, and closes", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await page.locator(".cm-content").first().waitFor({ timeout: 60_000 });

	const toggle = page.getByRole("button", { name: "Toggle research panel" });
	const panel = page.getByRole("complementary", { name: "Research panel" });

	// Closed at launch.
	await expect(panel).toHaveCount(0);
	await expect(toggle).toHaveAttribute("aria-expanded", "false");

	// Toggle button opens the single fallback strip.
	await toggle.click();
	await expect(panel).toBeVisible();
	await expect(toggle).toHaveAttribute("aria-expanded", "true");
	await expect(page.locator(".sideview-fallback")).toHaveCount(1);

	// Engine switcher defaults to Google Translate; Bing updates
	// the external link (Translate bot-blocks embedded contexts,
	// which is why the switcher exists).
	const engine = page.getByLabel("Research engine");
	await expect(engine).toHaveValue("google");
	const openLink = panel.getByRole("link");
	await expect(openLink).toHaveAttribute("href", "https://translate.google.com/");
	await engine.selectOption("bing");
	await expect(openLink).toHaveAttribute("href", "https://www.bing.com/translator");

	// Esc closes from anywhere; reopening never duplicates the strip.
	await page.keyboard.press("Escape");
	await expect(panel).toHaveCount(0);
	await expect(toggle).toHaveAttribute("aria-expanded", "false");
	await toggle.click();
	await toggle.click();
	await toggle.click();
	await expect(page.locator(".sideview-fallback")).toHaveCount(1);
	await expect(toggle).toHaveAttribute("aria-expanded", "true");

	// The × button closes too.
	await page.getByRole("button", { name: "Close research panel" }).click();
	await expect(panel).toHaveCount(0);
});

/** Cmd+T outside message text toggles the panel (Meta reaches the
page on Linux Chromium; Ctrl+T is the browser's own new-tab chord
and never arrives — the shell owns the combo there instead). */
test("meta+t toggles the research panel", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await page.locator(".cm-content").first().waitFor({ timeout: 60_000 });

	const panel = page.getByRole("complementary", { name: "Research panel" });
	await page.keyboard.press("Meta+t");
	await expect(panel).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(panel).toHaveCount(0);
});
