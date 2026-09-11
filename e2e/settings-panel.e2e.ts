import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/** Settings panel: five thinking pills share one row, labels stay terse. */
test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
});

test("thinking pills fit on one line", async ({ page }) => {
	const pills = page
		.locator('.settings-panel .segmented[aria-label="Thinking level"] button');
	await expect(pills).toHaveCount(5);
	const tops = await pills.evaluateAll((els) =>
		els.map((el) => Math.round(el.getBoundingClientRect().top))
	);
	expect(new Set(tops).size).toBe(1);
});

test("own-bubble toggle reads as Enable background on my messages", async ({ page }) => {
	await expect(page.locator(".settings-panel").getByText("Enable background on my messages")).toBeVisible();
});

/** Desktop text size caps at 400% (phones keep 200%). */
test("desktop text slider caps at 400 percent", async ({ page }) => {
	await expect(page.locator('.settings-panel input[aria-label="Text size percent"]')).toHaveAttribute(
		"max",
		"400"
	);
});

/** Bubble toggle sits below the hover row on desktop. */
test("own-bubble checkbox follows the hover row", async ({ page }) => {
	const panel = page.locator(".settings-panel");
	const tops = await panel.evaluate((el) => {
		const find = (text: string): number | null => {
			for (const node of el.querySelectorAll("fieldset.hover-row legend, label.check")) {
				if (node.textContent?.includes(text)) return node.getBoundingClientRect().top;
			}
			return null;
		};
		return { hover: find("Message buttons only on hover"), bubble: find("Enable background on my messages") };
	});
	expect(tops.hover).not.toBeNull();
	expect(tops.bubble).not.toBeNull();
	expect(tops.bubble! - tops.hover!).toBeGreaterThan(0);
});

/** macOS always uses system voices: no engine picker bubble. */
test("no System/Web engine picker on desktop", async ({ page }) => {
	const panel = page.locator(".settings-panel");
	await expect(panel.getByRole("button", { name: "System voices" })).toHaveCount(0);
	await expect(panel.getByRole("button", { name: "Web voices" })).toHaveCount(0);
});

/** Chat-width slider resizes the column live and persists the value. */
test("chat width slider narrows the column and persists", async ({ page }) => {
	const slider = page.locator('.settings-panel input[aria-label="Chat width in rem"]');
	await expect(slider).toBeVisible();
	await expect(slider).toHaveAttribute("min", "28");
	await expect(slider).toHaveAttribute("max", "80");
	const rootPx = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
	// The composer shares the column cap (own articles shrink-wrap, so
	// their computed max stays a min() expression — the prompt resolves).
	const promptMax = () =>
		page.locator(".prompt").evaluate((el) => getComputedStyle(el).maxWidth);
	expect(await promptMax()).toBe(`${46 * rootPx}px`);
	await slider.fill("32");
	await expect(slider).toHaveValue("32");
	expect(await promptMax()).toBe(`${32 * rootPx}px`);
	// Persisted to storage (the seeded init script rewrites settings on
	// every navigation, so reload-round-trip is covered by the unit
	// test's loadSettings clamp instead).
	await expect
		.poll(() =>
			page.evaluate(() => window.localStorage.getItem("ccez-studio-settings-v1"))
		)
		.toContain('"chatWidth":32');
});

/** Gutter double-click reads the live column: wide ignores, narrow opens. */
test("gutter double-click recomputes from the live width", async ({ page }) => {
	// A full-width assistant reply marks the column edges (a lone short
	// user message docks right and leaves no left edge to compare).
	await seedChat(page, [
		{ role: "user", content: "hi" },
		{ role: "assistant", content: "hello there, this is a reply" }
	]);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	await page.keyboard.press("Meta+,");
	const slider = page.locator('.settings-panel input[aria-label="Chat width in rem"]');
	const sidebar = page.locator("aside:not(.settings-panel)");
	const promptMax = () =>
		page.locator(".prompt").evaluate((el) => getComputedStyle(el).maxWidth);
	const rootPx = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
	// Closing the panel pulses root pointer-events (cursor re-hit-test);
	// wait for the restore so the gutter clicks below genuinely land.
	const waitHitTestable = () =>
		expect
			.poll(() => page.evaluate(() => document.documentElement.style.pointerEvents))
			.toBe("");
	await expect(sidebar).toHaveClass(/collapsed/);
	// Full-bleed column: x=100 lands inside it (the 19px messages
	// padding stays gutter), so nothing opens.
	await slider.fill("80");
	expect(await promptMax()).toBe(`${80 * rootPx}px`);
	await page.locator(".settings-panel .panel-head").click();
	await waitHitTestable();
	await page.mouse.dblclick(100, 400);
	await expect(sidebar).toHaveClass(/collapsed/);
	// Narrow column: x=100 is gutter, so the chats list opens.
	await page.keyboard.press("Meta+,");
	await page.locator('.settings-panel input[aria-label="Chat width in rem"]').fill("28");
	expect(await promptMax()).toBe(`${28 * rootPx}px`);
	await page.locator(".settings-panel .panel-head").click();
	await waitHitTestable();
	await page.mouse.dblclick(100, 400);
	await expect(sidebar).not.toHaveClass(/collapsed/);
});

/** Tap-to-show is a touch idiom: desktops never see its checkbox. */
test("no hide-buttons checkbox on desktop", async ({ page }) => {
	await expect(page.locator(".settings-panel").getByText("Hide message buttons until tapped")).toHaveCount(0);
});

/** The shortcuts entry is a one-line "Shortcuts" button with no
inline kbd chip; the chord stays documented inside the modal. */
test("shortcuts entry is a one-line button, chord lives in the modal", async ({ page }) => {
	const btn = page.locator(".settings-panel button", { hasText: "Shortcuts" });
	await expect(btn).toHaveText("Shortcuts");
	await expect(page.locator(".settings-panel .key-hint")).toHaveCount(0);
	const single = await btn.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
	expect(single).toBe(true);
	await btn.click();
	const modal = page.locator(".modal-veil .modal");
	await expect(modal).toBeVisible();
	await expect(modal.locator("dl.keys")).toContainText("Shortcuts show/hide");
	await page.keyboard.press("Escape");
	await expect(modal).toHaveCount(0);
});

/** Bubble background is decor only: turning it off never changes the
message alignment (left, right-docked, both ways). */
test("own-bubble off keeps left alignment, drops background", async ({ page }) => {
	const bubble = page.locator("article.user .bubble");
	await expect(bubble).toHaveCSS("background-color", "rgb(241, 241, 244)");
	await expect(bubble).toHaveCSS("text-align", "left");
	await page.locator(".settings-panel").getByText("Enable background on my messages").click();
	await expect(bubble).toHaveCSS("text-align", "left");
	const bg = await bubble.evaluate((el) => getComputedStyle(el).backgroundColor);
	expect(bg).toBe("rgba(0, 0, 0, 0)");
});
