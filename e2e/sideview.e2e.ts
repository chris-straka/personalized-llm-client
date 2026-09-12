import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/** Browser side panel contract (browser fallback: no Tauri shell
here, so Cmd+T docks a DOM strip with an external link instead of a
second OS webview — same open state, address-bar resolve, and Esc
behavior; the shell-only webview dock is hand-verified in
`tauri dev`). Shortcut-only: no toggle button exists. */
test("meta+t opens the browser, address resolves, esc closes", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await page.locator(".cm-content").first().waitFor({ timeout: 60_000 });

	const panel = page.getByRole("complementary", { name: "Browser panel" });
	const address = page.getByLabel("Browser address");

	// Closed at launch, and shortcut-only means no toggle button.
	await expect(panel).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Toggle research panel" })).toHaveCount(0);
	await expect(address).toHaveCount(0);

	// The composer autofocuses on load, which correctly swallows the
	// chord: click neutral chrome first so the press starts outside
	// the prompt (far left of the bar, away from its buttons).
	await page.locator('header[aria-label="App"]').click({ position: { x: 5, y: 5 } });
	await page.keyboard.press("Meta+t");
	await expect(panel).toBeVisible();
	await expect(page.locator(".sideview-fallback")).toHaveCount(1);
	// Cmd+T lands focus in the address bar, out of the prompt.
	await expect(address).toBeFocused();

	// Empty address links home.
	const openLink = panel.getByRole("link");
	await expect(openLink).toHaveAttribute("href", "https://duckduckgo.com/");

	// A bare host resolves to https; a phrase becomes a search.
	await address.fill("example.com");
	await expect(openLink).toHaveAttribute("href", "https://example.com/");
	await address.fill("cats and dogs");
	await address.press("Enter");
	await expect(openLink).toHaveAttribute(
		"href",
		"https://duckduckgo.com/?q=cats%20and%20dogs"
	);

	// Esc closes from anywhere; reopening never duplicates the strip.
	await page.keyboard.press("Escape");
	await expect(panel).toHaveCount(0);
	await page.keyboard.press("Meta+t");
	await page.keyboard.press("Meta+t");
	await page.keyboard.press("Meta+t");
	await expect(page.locator(".sideview-fallback")).toHaveCount(1);

	// The × button closes too.
	await page.getByRole("button", { name: "Close browser panel" }).click();
	await expect(panel).toHaveCount(0);
});

/** Cmd+T from inside the prompt opens the browser and moves focus
to its address bar (the prompt keeps no half-typed loss: opening
never touches the draft). */
test("meta+t from the prompt unfocuses into the browser address bar", async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	const editor = page.locator(".cm-content").first();
	await editor.waitFor({ timeout: 60_000 });
	await editor.click();
	await page.keyboard.press("Meta+t");
	await expect(page.getByRole("complementary", { name: "Browser panel" })).toBeVisible();
	await expect(page.getByLabel("Browser address")).toBeFocused();
	await page.keyboard.press("Escape");
});
