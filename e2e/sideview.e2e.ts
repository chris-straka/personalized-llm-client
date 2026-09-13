import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/** Browser side panel contract (browser fallback: no Tauri shell
here, so Cmd+T embeds the single tab as a viewport instead of a
second OS webview — same open state, address-bar resolve, and Esc
behavior; the shell-only webview dock is hand-verified in
`tauri dev`). Shortcut-only: no toggle button exists. */
test("meta+t toggles the browser, enter navigates, esc closes", async ({ page }) => {
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

	// Fresh tab shows the start page; the external link points home.
	const frame = panel.locator('iframe[title="Browser view"]');
	const openLink = panel.getByRole("link", { name: "Open in new tab" });
	await expect(panel.getByText("Type an address or a search in the bar above")).toBeVisible();
	await expect(frame).toHaveCount(0);
	await expect(openLink).toHaveAttribute("href", "https://duckduckgo.com/");

	// Typing alone never navigates (a browser commits on Enter).
	await address.fill("example.com");
	await expect(frame).toHaveCount(0);
	await expect(openLink).toHaveAttribute("href", "https://duckduckgo.com/");

	// A bare host resolves to https and commits to the viewport.
	await address.press("Enter");
	await expect(frame).toHaveAttribute("src", "https://example.com/");
	await expect(openLink).toHaveAttribute("href", "https://example.com/");

	// A phrase becomes a search commit.
	await address.fill("cats and dogs");
	await address.press("Enter");
	await expect(frame).toHaveAttribute(
		"src",
		"https://duckduckgo.com/?q=cats%20and%20dogs"
	);

	// Back/forward step through committed pages only.
	const back = panel.getByRole("button", { name: "Back" });
	const forward = panel.getByRole("button", { name: "Forward" });
	await expect(back).toBeEnabled();
	await back.click();
	await expect(frame).toHaveAttribute("src", "https://example.com/");
	await expect(forward).toBeEnabled();
	await forward.click();
	await expect(frame).toHaveAttribute(
		"src",
		"https://duckduckgo.com/?q=cats%20and%20dogs"
	);

	// Reload keeps the committed page.
	await panel.getByRole("button", { name: "Reload" }).click();
	await expect(frame).toHaveAttribute(
		"src",
		"https://duckduckgo.com/?q=cats%20and%20dogs"
	);

	// A second Cmd+T closes the tab it opened (toggle).
	await page.locator('header[aria-label="App"]').click({ position: { x: 5, y: 5 } });
	await page.keyboard.press("Meta+t");
	await expect(panel).toHaveCount(0);

	// Esc closes from anywhere; reopening never duplicates the strip.
	await page.keyboard.press("Meta+t");
	await expect(panel).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(panel).toHaveCount(0);
	await page.keyboard.press("Meta+t");
	await page.keyboard.press("Meta+t");
	await page.keyboard.press("Meta+t");
	await expect(page.locator(".sideview-fallback")).toHaveCount(1);

	// Reopening keeps the tab's page (no reset to the start page).
	await expect(frame).toHaveAttribute(
		"src",
		"https://duckduckgo.com/?q=cats%20and%20dogs"
	);

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
