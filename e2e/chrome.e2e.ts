import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * App chrome + settings (bucket chromesettings). NOT RUN in this
 * bucket (shared dev-server port) — kept as the contract for CI.
 */

async function openWithMessages(
	page: import("@playwright/test").Page,
	messages: { role: "user" | "assistant"; content: string }[]
) {
	await seedChat(page, messages);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
}

async function openSettings(page: import("@playwright/test").Page) {
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
}

/** Top bar shows the app name and keeps double-click-to-zoom. */
test("top bar shows text and survives a double-click", async ({ page }) => {
	await openWithMessages(page, [{ role: "user", content: "hi" }]);
	const title = page.locator("header .app-title");
	await expect(title).toHaveText("Ccez LLM");
	// Browser build has no shell zoom (Tauri-only no-op): the strip
	// stays put and keeps its text. The title itself is click-through
	// (pointer-events none, so the window drag strip wins) — drive the
	// double-click by dispatch, which still runs the zoom path.
	await title.evaluate((el) =>
		el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
	);
	await expect(title).toHaveText("Ccez LLM");
});

/** Idle prompt: hides after the timeout, restores on any input. */
test("prompt slides away when idle and returns on input", async ({ page }) => {
	// Long thread: idle-hide skips content shorter than the viewport,
	// so the timeout path needs an overflowing chat.
	const long = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);
	const turns = [0, 1, 2, 3, 4, 5].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${long}` },
		{ role: "assistant" as const, content: `answer ${n} ${long}` }
	]);
	await seedChat(page, turns);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-studio-settings-v1",
			JSON.stringify({ promptIdleSec: 2 })
		);
	});
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	const prompt = page.locator(".prompt");
	// No input for 2s (+ticker): the idle class lands and the
	// composer fades out of hit-testing.
	await expect(prompt).toHaveClass(/prompt-idle/, { timeout: 15_000 });
	await expect(prompt).toHaveCSS("opacity", "0");
	// Any input restores it instantly.
	await page.mouse.move(400, 300);
	await expect(prompt).not.toHaveClass(/prompt-idle/, { timeout: 5_000 });
});

/** Idle timeout is configurable in settings (2–10s, top tick is never). */
test("idle timeout slider persists", async ({ page }) => {
	await openWithMessages(page, [{ role: "user", content: "hi" }]);
	await openSettings(page);
	const slider = page.locator(
		'.settings-panel input[aria-label="Idle seconds before the prompt hides (top is never)"]'
	);
	await expect(slider).toHaveAttribute("min", "2");
	await expect(slider).toHaveAttribute("max", "11");
	await slider.fill("10");
	await expect
		.poll(() => page.evaluate(() => window.localStorage.getItem("ccez-studio-settings-v1")))
		.toContain('"promptIdleSec":10');
	await slider.fill("11");
	await expect
		.poll(() => page.evaluate(() => window.localStorage.getItem("ccez-studio-settings-v1")))
		.toContain('"promptIdleSec":0');
});

/** Slider drag-up past the top resets to default (text size). */
test("dragging the text slider upward resets to 100 percent", async ({ page }) => {
	await openWithMessages(page, [{ role: "user", content: "hi" }]);
	await openSettings(page);
	const slider = page.locator('.settings-panel input[aria-label="Text size percent"]');
	await slider.fill("250");
	await expect(slider).toHaveValue("250");
	const box = await slider.boundingBox();
	expect(box).toBeTruthy();
	await slider.dispatchEvent("pointerdown", { clientY: box!.y + box!.height / 2 });
	await slider.dispatchEvent("pointerup", { clientY: box!.y + box!.height / 2 - 120 });
	await expect(slider).toHaveValue("100");
});

/** Clicking the slider label never resets (only the inner button + drag-up do). */
test("clicking the chat-width label text keeps the value", async ({ page }) => {
	await openWithMessages(page, [{ role: "user", content: "hi" }]);
	await openSettings(page);
	const slider = page.locator('.settings-panel input[aria-label="Chat width in rem"]');
	await slider.fill("60");
	await expect(slider).toHaveValue("60");
	// NOTE: the inner `has` selector must be relative — an absolute
	// `.settings-panel …` inner selector never matches inside a label.
	const label = page
		.locator(".settings-panel label")
		.filter({ has: page.locator('input[aria-label="Chat width in rem"]') });
	const box = await label.boundingBox();
	expect(box).toBeTruthy();
	// Top-left of the label is the label text row, clear of the
	// slider, readout, and reset button: the value must survive.
	await page.mouse.click(box!.x + 20, box!.y + 10);
	await expect(slider).toHaveValue("60");
	// The inner reset button still restores the default.
	await page.locator(".settings-panel button", { hasText: "(36)" }).click();
	await expect(slider).toHaveValue("36");
});

/** Chat width configures past 80rem. */
test("chat width slider reaches past 80 rem", async ({ page }) => {
	await openWithMessages(page, [{ role: "user", content: "hi" }]);
	await openSettings(page);
	const slider = page.locator('.settings-panel input[aria-label="Chat width in rem"]');
	await expect(slider).toHaveAttribute("max", "120");
	await slider.fill("100");
	await expect(slider).toHaveValue("100");
	await expect
		.poll(() => page.evaluate(() => window.localStorage.getItem("ccez-studio-settings-v1")))
		.toContain('"chatWidth":100');
});

/** Fresh installs: plain user messages, hover-only buttons both roles. */
test("fresh installs default to plain messages and hover-only buttons", async ({ page }) => {
	await openWithMessages(page, [{ role: "user", content: "hi" }]);
	await page.evaluate(() => window.localStorage.setItem("ccez-studio-settings-v1", "{}"));
	await page.reload();
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	const main = page.locator("main");
	await expect(main).toHaveClass(/plain-user/);
	await expect(main).toHaveClass(/hover-user/);
	await expect(main).toHaveClass(/hover-assistant/);
});

/** Message buttons scale with font size only when opted in. */
test("message buttons scale with text size when enabled", async ({ page }) => {
	await openWithMessages(page, [
		{ role: "user", content: "hi" },
		{ role: "assistant", content: "hello there" }
	]);
	await openSettings(page);
	await page.locator('.settings-panel input[aria-label="Text size percent"]').fill("200");
	const button = page.locator("article.assistant .actions button").first();
	const fixed = await button.evaluate((el) => getComputedStyle(el).fontSize);
	await page.locator(".settings-panel").getByText("Scale message buttons with text size").click();
	const scaled = await button.evaluate((el) => getComputedStyle(el).fontSize);
	expect(parseFloat(scaled)).toBeGreaterThan(parseFloat(fixed));
});

/** Language buttons never overlap the hero on an empty chat. */
test("empty-state language buttons sit clear of the hero", async ({ page }) => {
	await openWithMessages(page, []);
	const hero = page.locator(".hero");
	const menus = page.locator(".lang-menus");
	await expect(hero).toBeVisible();
	await expect(menus).toBeVisible();
	const heroBox = await hero.boundingBox();
	const menusBox = await menus.boundingBox();
	expect(heroBox).toBeTruthy();
	expect(menusBox).toBeTruthy();
	expect(menusBox!.y).toBeGreaterThanOrEqual(heroBox!.y + heroBox!.height);
	// Mac desktop additionally nudges the row down and fades it
	// (data-mac); elsewhere it simply rests in flow — either way,
	// no overlap.
});

/** Short threads never idle-hide: nothing to uncover, prompt stays. */
test("short thread keeps the composer past the timeout", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.addInitScript(() => {
		window.localStorage.setItem(
			"ccez-studio-settings-v1",
			JSON.stringify({ promptIdleSec: 2 })
		);
	});
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	await expect(page.locator(".messages")).toBeVisible();
	const fits = await page.evaluate(() => {
		const box = document.querySelector(".messages") as HTMLElement | null;
		return box ? box.scrollHeight <= box.clientHeight : null;
	});
	expect(fits).toBe(true);
	await expect(page.locator(".prompt")).not.toHaveClass(/prompt-idle/, { timeout: 2_000 });
	await page.waitForTimeout(4000);
	await expect(page.locator(".prompt")).not.toHaveClass(/prompt-idle/);
});

/** Thinking block uses the same font size as chat text. */
test("thinking block matches chat text size", async ({ page }) => {
	await openWithMessages(page, [
		{ role: "user", content: "hi" },
		{ role: "assistant", content: "<think>quiet plan</think>Final answer" }
	]);
	const thoughts = page.locator("article.assistant .ccez-thoughts").first();
	await expect(thoughts).toBeVisible();
	const sizes = await thoughts.evaluate((el) => {
		const body = el.closest(".rendered")!;
		return {
			thoughts: getComputedStyle(el).fontSize,
			body: getComputedStyle(body).fontSize
		};
	});
	expect(sizes.thoughts).toBe(sizes.body);
});

/** Shift+Meta+plus/minus widen/narrow the chat column. */
test("shift-meta-plus widens the chat column", async ({ page }) => {
	await openWithMessages(page, [{ role: "user", content: "hi" }]);
	await page.locator(".cm-content").first().click();
	await page.keyboard.down("Shift");
	await page.keyboard.down("Meta");
	await page.keyboard.press("Equal");
	await page.keyboard.up("Meta");
	await page.keyboard.up("Shift");
	// Default 36 + one 2rem step.
	await expect(page.locator(".toast")).toContainText("Chat width 38 rem");
	await expect
		.poll(() => page.evaluate(() => window.localStorage.getItem("ccez-studio-settings-v1")))
		.toContain('"chatWidth":38');
});
