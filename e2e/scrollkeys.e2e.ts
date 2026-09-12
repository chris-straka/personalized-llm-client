import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Scrollkeys bucket (desktop, nothing selected): bare j/k
 * smooth-scroll the chat, d/u fast smooth-scroll, gg goes to top,
 * G to the bottom, and z/Z land the hovered message's top/bottom.
 * Holds glide at the scrollkeys.ts velocities (j/k 720px/s, d/u
 * 2520px/s — d/u deliberately faster); a tap of Escape still
 * dismisses overlays exactly as today, and an Escape HOLD keeps the
 * dismiss path (exiting fullscreen needs a real window chrome,
 * which playwright cannot cover: see the unverified-on-device note
 * on exitFullscreenFromHold in +page.svelte).
 *
 * Editor selector note: desktop composes in CodeMirror
 * (`.cm-content`); the plain textarea (`.ta-input`,
 * textarea-editor.ts) is androidUI-only, so this desktop spec must
 * wait for `.cm-content`, never `.ta-input`.
 */
test.setTimeout(90_000);

const LONG = "lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(40);

function turns(): Array<{ role: "user" | "assistant"; content: string }> {
	return [0, 1, 2, 3, 4, 5].flatMap((n) => [
		{ role: "user" as const, content: `question ${n} ${LONG}` },
		{ role: "assistant" as const, content: `answer ${n} ${LONG}` }
	]);
}

async function scrollTop(page): Promise<number> {
	return page.evaluate(() => (document.querySelector(".messages") as HTMLElement | null)?.scrollTop ?? -1);
}

async function deselectToBody(page): Promise<void> {
	// Single click on the right gutter: no message, no control, so
	// focus lands on the body with nothing selected (edit mode,
	// selectedIdx -1). Double-click would open sidebars; a single
	// click only drops focus.
	await page.mouse.click(1240, 400);
	await page.waitForFunction(() => document.activeElement === document.body, { timeout: 10_000 });
}

test.beforeEach(async ({ page }) => {
	await seedChat(page, turns());
	await page.goto("/");
	// Desktop composer is CodeMirror — `.ta-input` only exists on
	// androidUI (see the editor branch in +page.svelte).
	await page.locator(".prompt .cm-content").waitFor({ timeout: 60_000 });
	await page.waitForFunction(
		() => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			return box !== null && box.scrollHeight > box.clientHeight + 500;
		},
		{ timeout: 15_000 }
	);
	await deselectToBody(page);
});

test("j/k smooth-scroll down and back up with nothing selected", async ({ page }) => {
	const before = await scrollTop(page);
	await page.keyboard.press("j");
	await page.waitForFunction((prev) => {
		const box = document.querySelector(".messages") as HTMLElement | null;
		return box !== null && box.scrollTop > prev;
	}, before, { timeout: 10_000 });
	const down = await scrollTop(page);
	expect(down).toBeGreaterThan(before);
	await page.keyboard.press("k");
	await page.waitForFunction((prev) => {
		const box = document.querySelector(".messages") as HTMLElement | null;
		return box !== null && box.scrollTop < prev;
	}, down, { timeout: 10_000 });
	expect(await scrollTop(page)).toBeLessThan(down);
});

test("d fast-scrolls further than j, u climbs back", async ({ page }) => {
	const before = await scrollTop(page);
	await page.keyboard.press("j");
	await page.waitForFunction((prev) => {
		const box = document.querySelector(".messages") as HTMLElement | null;
		return box !== null && box.scrollTop > prev;
	}, before, { timeout: 10_000 });
	const stepped = (await scrollTop(page)) - before;
	await page.keyboard.press("d");
	await page.waitForFunction(
		({ prev, step }) => {
			const box = document.querySelector(".messages") as HTMLElement | null;
			return box !== null && box.scrollTop - prev > step * 2;
		},
		{ prev: before, step: stepped },
		{ timeout: 10_000 }
	);
	const fast = await scrollTop(page);
	expect(fast - before).toBeGreaterThan(stepped * 2);
	await page.keyboard.press("u");
	await page.waitForFunction((prev) => {
		const box = document.querySelector(".messages") as HTMLElement | null;
		return box !== null && box.scrollTop < prev;
	}, fast, { timeout: 10_000 });
});

test("j hold glides near SCROLLKEY_JK_VELOCITY_PX_S with no discrete jump", async ({ page }) => {
	const HOLD_MS = 500;
	const before = await scrollTop(page);
	expect(before).toBeLessThanOrEqual(8);
	await page.keyboard.down("j");
	await page.waitForTimeout(HOLD_MS);
	await page.keyboard.up("j");
	// The glide accrues per rAF from the first frame (no restart
	// stutter, no initial tiny jump); the release lands no discrete
	// step for a hold past SCROLL_HOLD_TAP_MS. 720px/s * 0.5s =
	// ~360px — bounds stay wide for headless rAF pacing.
	await page.waitForTimeout(400);
	const dist = (await scrollTop(page)) - before;
	expect(dist).toBeGreaterThan(120);
	expect(dist).toBeLessThan(720);
});

test("d hold glides near SCROLLKEY_DU_VELOCITY_PX_S, well past j", async ({ page }) => {
	const HOLD_MS = 400;
	// j leg first, from the top, so both legs share one page.
	const top = await scrollTop(page);
	await page.keyboard.down("j");
	await page.waitForTimeout(HOLD_MS);
	await page.keyboard.up("j");
	await page.waitForTimeout(400);
	const jDist = (await scrollTop(page)) - top;
	expect(jDist).toBeGreaterThan(0);
	// d leg from wherever j parked (far from the bottom: 12 long
	// messages, ~1k px of travel total).
	const mid = await scrollTop(page);
	await page.keyboard.down("d");
	await page.waitForTimeout(HOLD_MS);
	await page.keyboard.up("d");
	await page.waitForTimeout(400);
	const dDist = (await scrollTop(page)) - mid;
	// 2520px/s vs 720px/s over equal holds: 3.5x expected; 2x
	// absorbs headless rAF slop without hiding a velocity swap.
	expect(dDist).toBeGreaterThan(jDist * 2);
});

test("gg goes to top, G to the bottom", async ({ page }) => {
	await page.keyboard.press("G");
	await page.waitForFunction(() => {
		const box = document.querySelector(".messages") as HTMLElement | null;
		return box !== null && box.scrollHeight - box.scrollTop - box.clientHeight <= 8;
	}, undefined, { timeout: 10_000 });
	await page.keyboard.press("g");
	await page.keyboard.press("g");
	await page.waitForFunction(() => {
		const box = document.querySelector(".messages") as HTMLElement | null;
		return box !== null && box.scrollTop <= 8;
	}, undefined, { timeout: 10_000 });
	expect(await scrollTop(page)).toBeLessThanOrEqual(8);
});

test("z/Z land the hovered message top/bottom", async ({ page }) => {
	// Hovering never moves focus, so the body focus from beforeEach
	// survives: each press re-hovers first (leaving the article
	// clears hoveredIdx, and the z scroll itself can slide another
	// message under the stationary cursor).
	await page.locator("article#msg-3").scrollIntoViewIfNeeded();
	await page.locator("article#msg-3").hover();
	const box = await page.evaluate(() => {
		const el = document.querySelector(".messages") as HTMLElement | null;
		return el ? { top: el.getBoundingClientRect().top, viewH: el.clientHeight } : null;
	});
	expect(box).not.toBeNull();
	await page.keyboard.press("z");
	await page.waitForFunction(
		({ top }) => {
			const msg = document.querySelector("article#msg-3") as HTMLElement | null;
			if (!msg) return false;
			return Math.abs(msg.getBoundingClientRect().top - top - 16) <= 24;
		},
		{ top: box!.top },
		{ timeout: 10_000 }
	);
	await page.locator("article#msg-3").hover();
	await page.keyboard.press("Z");
	await page.waitForFunction(
		({ top, viewH }) => {
			const msg = document.querySelector("article#msg-3") as HTMLElement | null;
			if (!msg) return false;
			const r = msg.getBoundingClientRect();
			return Math.abs(r.bottom - (top + viewH) + 16) <= 32;
		},
		{ top: box!.top, viewH: box!.viewH },
		{ timeout: 10_000 }
	);
});

test("tap Escape still dismisses the shortcuts overlay", async ({ page }) => {
	await page.keyboard.press("Control+Shift+Slash");
	await expect(page.locator(".modal", { hasText: "Keyboard shortcuts" })).toBeVisible({ timeout: 10_000 });
	// A quick tap (well under the fullscreen-hold threshold) keeps
	// today's dismiss path and exits no fullscreen.
	await page.keyboard.press("Escape");
	await expect(page.locator(".modal", { hasText: "Keyboard shortcuts" })).toBeHidden({ timeout: 10_000 });
});

test("held Escape past ESCAPE_HOLD_MS still dismisses overlays", async ({ page }) => {
	await page.keyboard.press("Control+Shift+Slash");
	await expect(page.locator(".modal", { hasText: "Keyboard shortcuts" })).toBeVisible({ timeout: 10_000 });
	// A hold (past the 500ms fullscreen threshold) must not break
	// the dismiss path: keyup still dismisses exactly like a tap.
	// Fullscreen exit itself needs real window chrome (device-only).
	await page.keyboard.down("Escape");
	await page.waitForTimeout(700);
	await page.keyboard.up("Escape");
	await expect(page.locator(".modal", { hasText: "Keyboard shortcuts" })).toBeHidden({ timeout: 10_000 });
});
