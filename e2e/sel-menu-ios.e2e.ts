import { devices, expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

test.use({ ...devices["iPhone 15"] });

/** iOS selection dock: the Annotate control lives in the composer
tools while a highlight is up — no floating menu over the text (the
native callout owns that space), so nothing fights it or the thumb. */
test("ios docks Annotate in the composer, nothing floating", async ({ page }) => {
	const filler =
		"秋が近づくと空が高くなり紅葉が美しく色づきます温かいお茶を飲みながらゆっくりと読書をしたり散歩を楽しんだりするのにぴったりの季節です";
	await seedChat(page, [
		{ role: "user", content: "first" },
		{ role: "assistant", content: filler },
		{ role: "assistant", content: "漢字を読む" },
		{ role: "assistant", content: filler },
		{ role: "assistant", content: filler }
	]);
	await page.goto("/");
	await expect(page.locator("article .rendered").nth(2)).toBeVisible({ timeout: 60_000 });
	await expect
		.poll(
			async () =>
				page.evaluate(() => {
					const app = document.querySelector(".app");
					if (!app?.hasAttribute("data-ios")) return "no-flag";
					if (app.hasAttribute("data-native-callout")) return "stale-flag";
					const css = Array.from(document.querySelectorAll("style"))
						.map((t) => t.textContent ?? "")
						.join("\n");
					return /-webkit-touch-callout\s*:\s*none/.test(css) ? "suppressed" : "ok";
				}),
			{ timeout: 30_000 }
		)
		.toBe("ok");
	// A word pick summons the Annotate-only menu above the highlight.
	// Touch emulation performs no native word pick, so the highlight
	// is set programmatically and the same window dblclick summons it.
	const picked = await page.evaluate(() => {
		const roots = document.querySelectorAll("article .rendered");
		const root = roots[2];
		if (!root) return null;
		if (!root) return null;
		// Mid-viewport, so the menu takes its usual above slot (the
		// list scrolls smooth, so jump instantly before measuring).
		root.scrollIntoView({ block: "center", behavior: "instant" });
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let target: Text | null = null;
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (node instanceof Text && (node.textContent ?? "").trim().length >= 4) {
				target = node;
				break;
			}
		}
		if (!target) return null;
		const text = target.textContent ?? "";
		const start = text.search(/\S/);
		const range = document.createRange();
		range.setStart(target, start < 0 ? 0 : start);
		range.setEnd(target, (start < 0 ? 0 : start) + 2);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(range);
		const r = range.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	});
	if (!picked) throw new Error("no word to highlight");
	// Dispatch on the prose element itself: the selection's midpoint
	// can sit under an overlay button, which the click guards (rightly)
	// reject. Coordinates still ride along for menu docking.
	await page.evaluate(({ x, y }) => {
		const el = document.querySelectorAll("article .rendered")[2];
		el?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: x, clientY: y }));
	}, picked);
	// No floating menu on iOS: the docked composer button stands in.
	await expect(page.locator(".sel-menu")).toHaveCount(0);
	const dock = page.locator(".prompt-tools .ann-dock");
	await expect(dock).toBeVisible();
	await expect(dock).toHaveText("Annotate");
	// The dock files the annotation: the comment box opens off it.
	await dock.click();
	const pop = page.locator(".ann-pop");
	await expect(pop).toBeVisible();
	// The composer fits the viewport: border-box keeps its padding
	// inside the rem/vw bounds (it spilled past the right edge).
	const popBox = await pop.boundingBox();
	const vw = await page.evaluate(() => window.innerWidth);
	expect(popBox, "pop has a box").not.toBeNull();
	expect(popBox!.x).toBeGreaterThanOrEqual(0);
	expect(popBox!.x + popBox!.width).toBeLessThanOrEqual(vw);
});

/** The dock holds past its timer while the highlight lives: on iOS it
tracks the native bubble, not the clock (collapsing the selection
still clears it at once). */
test("ios dock holds while the highlight lives", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "漢字を読むテストです" }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({ timeout: 60_000 });
	await page.locator("article .rendered").first().selectText();
	await page.mouse.up();
	const dock = page.locator(".prompt-tools .ann-dock");
	await expect(dock).toBeVisible();
	// Past the 4.5s touch timer with the highlight still live.
	await page.waitForTimeout(6000);
	await expect(dock).toBeVisible();
});

/** Tapping an annotation's marker opens its edit menu: the tap's
compatibility mousedown opens it, and the trailing compatibility
click must not toggle it straight back shut (desktop Chrome eats
that click via mousedown's preventDefault; iOS Safari fires it). */
test("tapping a badge opens its edit menu", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "漢字を読むテストです" }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible({ timeout: 60_000 });
	// File an annotation through the composer's docked button.
	await page.locator("article .rendered").first().selectText();
	await page.mouse.up();
	await page.locator(".prompt-tools .ann-dock").click();
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.locator(".ann-pop textarea").fill("go");
	await page.keyboard.press("Enter");
	const badge = page.locator("button.ccez-ann-badge").first();
	await expect(badge).toHaveCount(1);
	// The iOS Safari tap sequence, dispatched verbatim: touch events
	// plus the compatibility mouse events Safari sends after them.
	// Unlike desktop Chrome, Safari fires the click even though the
	// badge's mousedown preventDefaults — touchscreen.tap can't show
	// that (Chromium suppresses it either way), so the sequence below
	// is the regression, not the tap helper.
	await badge.evaluate((el) => {
		const r = el.getBoundingClientRect();
		const x = r.x + r.width / 2;
		const y = r.y + r.height / 2;
		const at = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y };
		// No Touch objects: the Touch constructor is unavailable under
		// iPhone emulation, and explicit empty touch lists throw there
		// too — so the lists are omitted (defaulting empty). That
		// no-ops the app's swipe tracking (no stroke, no fold) exactly
		// like a real tap with no movement does; the regression lives
		// in the mouse events below.
		el.dispatchEvent(new TouchEvent("touchstart", { ...at }));
		el.dispatchEvent(new TouchEvent("touchend", { ...at }));
		el.dispatchEvent(new MouseEvent("mousedown", { ...at, button: 0 }));
		el.dispatchEvent(new MouseEvent("mouseup", { ...at, button: 0 }));
		el.dispatchEvent(new MouseEvent("click", { ...at, button: 0 }));
	});
	await expect(page.locator(".ann-pop")).toBeVisible();
	// Closing is a 160ms fade-out (still "visible" mid-fade), so a
	// toggle-shut pop only fails the assertion after it unmounts.
	await page.waitForTimeout(400);
	const open = page.locator(".ann-pop");
	await expect(open).toBeVisible();
	// The edit card (24rem) fits the viewport too: with content-box
	// its padding stacked outside the vw clamp and it spilled right.
	const openBox = await open.boundingBox();
	const openVw = await page.evaluate(() => window.innerWidth);
	expect(openBox, "edit pop has a box").not.toBeNull();
	expect(openBox!.x).toBeGreaterThanOrEqual(0);
	expect(openBox!.x + openBox!.width).toBeLessThanOrEqual(openVw);
});
