import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Scrollkeys bucket (desktop, nothing selected): bare j/k
 * smooth-scroll the chat, d/u fast smooth-scroll, gg goes to top,
 * G to the bottom, and z/Z land the hovered message's top/bottom.
 * A tap of Escape still dismisses overlays exactly as today —
 * exiting fullscreen needs a HOLD, which playwright cannot cover
 * (window chrome): see the unverified-on-device note on
 * exitFullscreenFromHold in +page.svelte.
 *
 * NOTE: not run in this bucket (shared dev-server port) — kept as
 * the spec for a later e2e pass.
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
	await page.locator(".ta-input").waitFor({ timeout: 60_000 });
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
