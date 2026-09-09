import { test, expect, type Page } from "@playwright/test";

/**
 * Android touch batch: one-line region pills, bottom-sheet chats, the
 * touch selection menu with Speak, two-finger chat steps, three-finger
 * delete, sidebar mutual exclusion, and the theme pin. Same UA-gated
 * branches as android.e2e.ts, S24-class viewport.
 */
test.use({
	userAgent:
		"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
	viewport: { width: 412, height: 915 }
});

async function seedEmpty(page: Page): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-studio-settings-v1", JSON.stringify({}));
		window.localStorage.setItem(
			"ccez-studio-chats-v1",
			JSON.stringify([{ id: "e2e-chat", createdAt: 1, replyLang: null, messages: [] }])
		);
	});
	await page.goto("/");
	await expect(page.locator(".lang-menus")).toBeVisible();
}

async function seedTwoChats(page: Page): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-studio-settings-v1", JSON.stringify({}));
		const msg = (id: string, content: string) => ({ id, role: "assistant", content, usage: null, error: null });
		window.localStorage.setItem(
			"ccez-studio-chats-v1",
			JSON.stringify([
				{ id: "chat-a", createdAt: 1, replyLang: null, messages: [msg("m1", "alpha-aaa")] },
				{ id: "chat-b", createdAt: 2, replyLang: null, messages: [msg("m2", "beta-bbb")] }
			])
		);
	});
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
}

/** Synthetic horizontal swipe (untrusted TouchEvents hit window listeners). */
async function swipeX(page: Page, x0: number, x1: number): Promise<void> {
	await page.evaluate(
		({ x0, x1 }: { x0: number; x1: number }) => {
			const touch = (x: number, y: number) =>
				new Touch({ identifier: 9, target: document.body, clientX: x, clientY: y });
			window.dispatchEvent(
				new TouchEvent("touchstart", { bubbles: true, cancelable: true, composed: true, touches: [touch(x0, 600)] })
			);
			window.dispatchEvent(
				new TouchEvent("touchend", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [],
					changedTouches: [touch(x1, 604)]
				})
			);
		},
		{ x0, x1 }
	);
}

test("region menus share one row on a phone", async ({ page }) => {
	await seedEmpty(page);
	const wrap = await page.locator(".lang-menus").evaluate((el) => getComputedStyle(el).flexWrap);
	expect(wrap).toBe("nowrap");
	const buttons = page.locator(".lang-menus .lang-menu > button");
	expect(await buttons.count()).toBe(4);
	const boxes = [];
	for (let i = 0; i < 4; i++) boxes.push(await buttons.nth(i).boundingBox());
	const ys = new Set(boxes.map((b) => Math.round(b?.y ?? -1)));
	expect(ys.size).toBe(1);
	const right = Math.max(...boxes.map((b) => (b?.x ?? 0) + (b?.width ?? 0)));
	expect(right).toBeLessThanOrEqual(412);
});

test("chats list is a bottom sheet on a phone", async ({ page }) => {
	await seedEmpty(page);
	const aside = page.locator("aside:has(button.new)");
	const radius = await aside.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
	expect(radius).toBe("16px");
	const bottom = await aside.evaluate((el) => getComputedStyle(el).bottom);
	expect(bottom).toBe("0px");
});

test("swipes dismiss before they summon on a phone", async ({ page }) => {
	await seedEmpty(page);
	const aside = page.locator("aside:has(button.new)");
	const panel = page.locator(".settings-panel");
	// Open settings from the right edge; a rightward stroke closes
	// settings instead of summoning chats.
	await swipeX(page, 408, 268);
	await expect(panel).not.toHaveClass(/closed/);
	await swipeX(page, 4, 144);
	await expect(panel).toHaveClass(/closed/);
	await expect(aside).toHaveClass(/collapsed/);
	// Chats still summon from a clean slate; a leftward stroke with
	// the sheet open just closes it, and settings summon after that.
	await swipeX(page, 4, 144);
	await expect(aside).not.toHaveClass(/collapsed/);
	await swipeX(page, 408, 268);
	await expect(aside).toHaveClass(/collapsed/);
	await expect(panel).toHaveClass(/closed/);
	await swipeX(page, 408, 268);
	await expect(panel).not.toHaveClass(/closed/);
});

test("two-finger swipe down steps to the newer chat", async ({ page }) => {
	await seedTwoChats(page);
	const before = await page.locator("article .rendered").first().innerText();
	await page.evaluate(() => {
		const touch = (id: number, x: number, y: number) =>
			new Touch({ identifier: id, target: document.body, clientX: x, clientY: y });
		const start = [touch(1, 200, 500), touch(2, 240, 500)];
		window.dispatchEvent(
			new TouchEvent("touchstart", { bubbles: true, cancelable: true, composed: true, touches: start })
		);
		window.dispatchEvent(
			new TouchEvent("touchmove", {
				bubbles: true,
				cancelable: true,
				composed: true,
				touches: [touch(1, 200, 660), touch(2, 240, 660)]
			})
		);
		window.dispatchEvent(
			new TouchEvent("touchend", {
				bubbles: true,
				cancelable: true,
				composed: true,
				touches: [],
				changedTouches: [touch(1, 200, 660), touch(2, 240, 660)]
			})
		);
	});
	const after = await page.locator("article .rendered").first().innerText();
	expect(new Set([before, after]).size).toBe(2);
});

test("double three-finger tap deletes the current chat", async ({ page }) => {
	await seedTwoChats(page);
	expect(await page.locator("aside button.side-chat").count()).toBe(2);
	const tap = () =>
		page.evaluate(() => {
			const touch = (id: number) => new Touch({ identifier: id, target: document.body, clientX: 200, clientY: 500 });
			const fingers = [touch(1), touch(2), touch(3)];
			window.dispatchEvent(
				new TouchEvent("touchstart", { bubbles: true, cancelable: true, composed: true, touches: fingers })
			);
			window.dispatchEvent(
				new TouchEvent("touchend", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [],
					changedTouches: fingers
				})
			);
		});
	await tap();
	await tap();
	await expect(page.locator("aside button.side-chat")).toHaveCount(1);
	await expect(page.locator(".toast")).toHaveText("Chat deleted");
});

test("touch selection summons the Annotate menu below the selection", async ({ page }) => {
	await seedTwoChats(page);
	const box = await page.locator("article .rendered").first().boundingBox();
	if (!box) throw new Error("no message box");
	await page.evaluate(
		({ x, y }: { x: number; y: number }) => {
			const touch = (id: number) => new Touch({ identifier: id, target: document.body, clientX: x, clientY: y });
			window.dispatchEvent(
				new TouchEvent("touchstart", { bubbles: true, cancelable: true, composed: true, touches: [touch(1)] })
			);
			const rendered = document.querySelector("article .rendered");
			const sel = window.getSelection();
			sel?.removeAllRanges();
			const range = document.createRange();
			if (rendered) range.selectNodeContents(rendered);
			sel?.addRange(range);
			window.dispatchEvent(
				new TouchEvent("touchend", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [],
					changedTouches: [touch(1)]
				})
			);
		},
		{ x: box.x + box.width / 2, y: box.y + box.height / 2 }
	);
	const menu = page.locator(".sel-menu");
	await expect(menu.locator('button:has-text("Annotate")')).toBeVisible();
	// Speech lives in the OS text toolbar (Read Aloud), never here.
	await expect(menu.locator("button")).toHaveCount(1);
	// Ours docks below the selection, clear of the OS toolbar above it.
	const msgBox = await page.locator("article .rendered").first().boundingBox();
	const menuBox = await menu.boundingBox();
	expect(menuBox?.y ?? 0).toBeGreaterThan((msgBox?.y ?? 0) + (msgBox?.height ?? 0));
});

test("a long chat scrolls inside the list, never squeezing the prompt", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-studio-settings-v1", JSON.stringify({}));
		const messages = [];
		for (let i = 0; i < 20; i++) {
			messages.push({ id: `u${i}`, role: "user", content: `question ${i}`, usage: null, error: null });
			messages.push({ id: `a${i}`, role: "assistant", content: `answer ${i}`, usage: null, error: null });
		}
		window.localStorage.setItem(
			"ccez-studio-chats-v1",
			JSON.stringify([{ id: "chat-a", createdAt: 1, replyLang: null, messages }])
		);
	});
	await page.goto("/");
	await page.locator("article").first().waitFor();
	const metrics = await page.evaluate(() => {
		const list = document.querySelector(".messages") as HTMLElement;
		const prompt = document.querySelector(".prompt") as HTMLElement;
		list.scrollTop = list.scrollHeight;
		const promptBox = prompt.getBoundingClientRect();
		return { scrollHeight: list.scrollHeight, clientHeight: list.clientHeight, promptHeight: promptBox.height };
	});
	expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
	expect(metrics.promptHeight).toBeGreaterThanOrEqual(90);
});

test("page never scrolls sideways on a phone", async ({ page }) => {
	await seedTwoChats(page);
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	expect(overflow).toBeLessThanOrEqual(0);
});

test("hide-messages mode reveals one message per tap", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-studio-settings-v1", JSON.stringify({ hideMessages: true }));
		const msg = (id: string, role: string, content: string) => ({ id, role, content, usage: null, error: null });
		window.localStorage.setItem(
			"ccez-studio-chats-v1",
			JSON.stringify([
				{ id: "chat-a", createdAt: 1, replyLang: null, messages: [msg("m1", "assistant", "hello-hidden")] }
			])
		);
	});
	await page.goto("/");
	await page.locator("article").first().waitFor();
	const body = page.locator("article .rendered").first();
	await expect(body).toBeHidden();
	await page.evaluate(() => {
		document.querySelector("article")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	await expect(body).toBeVisible();
	await expect(body).toBeHidden({ timeout: 5000 });
});

test("rerun tooltip is just Rerun", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-studio-settings-v1", JSON.stringify({}));
		const msg = (id: string, role: string, content: string) => ({ id, role, content, usage: null, error: null });
		window.localStorage.setItem(
			"ccez-studio-chats-v1",
			JSON.stringify([
				{ id: "chat-a", createdAt: 1, replyLang: null, messages: [msg("m1", "user", "do it")] }
			])
		);
	});
	await page.goto("/");
	await page.locator("article").first().waitFor();
	const rerun = page.locator('article .actions button[data-tip="Rerun"]').first();
	await expect(rerun).toBeVisible();
	expect(await rerun.getAttribute("aria-label")).toBe("Rerun");
});

test("drawers slide on transform, never pop", async ({ page }) => {
	await seedEmpty(page);
	const sheet = await page.locator("aside:has(button.new)").evaluate((el) => getComputedStyle(el).transition);
	expect(sheet).toContain("transform");
	await swipeX(page, 408, 268);
	const panel = page.locator(".settings-panel");
	await expect(panel).not.toHaveClass(/closed/);
	const transition = await panel.evaluate((el) => getComputedStyle(el).transition);
	expect(transition).toContain("transform");
});

test("settings sheet spans the phone and offers touch toggles", async ({ page }) => {
	await seedEmpty(page);
	await swipeX(page, 408, 268);
	const panel = page.locator(".settings-panel");
	await expect(panel).not.toHaveClass(/closed/);
	const box = await panel.boundingBox();
	expect(box?.width ?? 0).toBeCloseTo(412, 0);
	await expect(panel.locator('legend:has-text("Voice engine")')).toHaveCount(0);
	// Phones never auto-read selections: no toggle, no behavior.
	await expect(panel.locator('label:has-text("Read selections aloud on release")')).toHaveCount(0);
	await expect(panel.locator('h2:has-text("Touch gestures")')).toBeVisible();
});

test("theme pin holds dark under a light OS", async ({ page }) => {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-studio-settings-v1", JSON.stringify({ theme: "dark" }));
		window.localStorage.setItem(
			"ccez-studio-chats-v1",
			JSON.stringify([{ id: "e2e-chat", createdAt: 1, replyLang: null, messages: [] }])
		);
	});
	await page.goto("/");
	await expect(page.locator(".lang-menus")).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
	const bg = await page.locator(".app").evaluate((el) => getComputedStyle(el).backgroundColor);
	expect(bg).toBe("rgb(23, 23, 26)");
});

test.describe("dark phone", () => {
	test.use({ viewport: { width: 360, height: 740 }, colorScheme: "dark", hasTouch: true });

	/** The chat list keeps readable contrast in dark: phone WebViews
	that "help" by darkening light text blank the sheet otherwise. */
	test("chat list text keeps contrast in dark", async ({ page }) => {
		await seedTwoChats(page);
		const report = await page.evaluate(() => {
			const lum = (rgb: string): number => {
				const m = rgb.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
				const f = (v: number): number => {
					const s = v / 255;
					return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
				};
				return 0.2126 * f(m[0] ?? 0) + 0.7152 * f(m[1] ?? 0) + 0.0722 * f(m[2] ?? 0);
			};
			const ratio = (fg: string, bg: string): number => {
				const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
				return (a + 0.05) / (b + 0.05);
			};
			const cs = (sel: string): { fg: string; bg: string } => {
				const el = document.querySelector(sel);
				if (!(el instanceof HTMLElement)) throw new Error(`${sel} missing`);
				const s = getComputedStyle(el);
				return { fg: s.color, bg: s.backgroundColor };
			};
			const aside = cs("aside");
			const chat = cs("aside ul button.side-chat");
			const del = cs("aside li .del");
			return {
				theme: document.documentElement.dataset.theme,
				scheme: getComputedStyle(document.documentElement).colorScheme,
				chat: ratio(chat.fg, aside.bg),
				del: ratio(del.fg, aside.bg)
			};
		});
		expect(report.theme).toBe("dark");
		// Root opt-out of algorithmic darkening, so the WebView paints
		// our dark theme as-is instead of darkening light text away.
		expect(report.scheme).toBe("dark");
		expect(report.chat).toBeGreaterThanOrEqual(4.5);
		expect(report.del).toBeGreaterThanOrEqual(4.5);
	});

	/** The two-column gestures grid overflows a 360px phone, clipping
	the teaching text — single column fits, in a reading typeface. */
	test("gestures list fits a 360px screen", async ({ page }) => {
		await seedTwoChats(page);
		await swipeX(page, 356, 216);
		await page.locator(".settings-panel").waitFor();
		await page.locator('button:has-text("Show all gestures")').click();
		await page.locator("#shortcuts-heading").waitFor();
		const fit = await page.evaluate(() => {
			const keys = document.querySelector(".keys");
			const dd = document.querySelector(".keys dd");
			if (!(keys instanceof HTMLElement) || !(dd instanceof HTMLElement)) throw new Error("keys missing");
			return {
				overflow: keys.scrollWidth - keys.clientWidth,
				columns: getComputedStyle(keys).gridTemplateColumns.split(" ").length,
				font: getComputedStyle(dd).fontFamily
			};
		});
		expect(fit.overflow).toBeLessThanOrEqual(0);
		expect(fit.columns).toBe(1);
		expect(fit.font).not.toMatch(/mono/i);
	});

	/** A tap on Annotate opens the comment box: taps near a selection
	handle are swallowed as handle nudges (no click ever arrives), so
	the button runs off touchend instead of waiting for onclick. */
	test("a tap on Annotate opens the comment box", async ({ page }) => {
		await seedTwoChats(page);
		const box = await page.locator("article .rendered").first().boundingBox();
		if (!box) throw new Error("no message box");
		await page.evaluate(
			({ x, y }: { x: number; y: number }) => {
				const touch = (id: number) => new Touch({ identifier: id, target: document.body, clientX: x, clientY: y });
				window.dispatchEvent(
					new TouchEvent("touchstart", { bubbles: true, cancelable: true, composed: true, touches: [touch(1)] })
				);
				const rendered = document.querySelector("article .rendered");
				const sel = window.getSelection();
				sel?.removeAllRanges();
				const range = document.createRange();
				if (rendered) range.selectNodeContents(rendered);
				sel?.addRange(range);
				window.dispatchEvent(
					new TouchEvent("touchend", {
						bubbles: true,
						cancelable: true,
						composed: true,
						touches: [],
						changedTouches: [touch(1)]
					})
				);
			},
			{ x: box.x + box.width / 2, y: box.y + box.height / 2 }
		);
		const btn = page.locator('.sel-menu button:has-text("Annotate")');
		await expect(btn).toBeVisible();
		// A real tap on the button: on-device the handle eats the click,
		// so the comment box must open off the touch sequence itself.
		// (Synthetic TouchEvents don't reach Svelte's touch handlers —
		// only trusted taps exercise this path.)
		const btnBox = await btn.boundingBox();
		if (!btnBox) throw new Error("no annotate box");
		await page.touchscreen.tap(btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2);
		await expect(page.locator(".ann-pop")).toBeVisible();
	});
});

/** Sending in a new chat leaves a one-line composer: the reply's layout
churn (and the keyboard's viewport churn on phones) must never strand
the emptied editor at zero height until the next keystroke heals it. */
test("composer holds one line after the reply lands", async ({ page }) => {
	await seedEmpty(page);
	await page.locator(".cm-content").click();
	await page.keyboard.type("hello world");
	await page.keyboard.press("Enter");
	await expect(page.locator('article .rendered:has-text("Mock reply to:")')).toBeVisible({ timeout: 15000 });
	const heights = await page.evaluate(() => {
		const h = (sel: string): number => {
			const el = document.querySelector(sel);
			return el instanceof HTMLElement ? el.getBoundingClientRect().height : -1;
		};
		return { content: h(".prompt .cm-content"), placeholder: h(".prompt .cm-placeholder") };
	});
	// One empty line plus the editor's vertical padding (~40px): the
	// stranded state measured ~0 here with no placeholder at all.
	expect(heights.content).toBeGreaterThan(30);
	expect(heights.placeholder).toBeGreaterThan(10);
	// A keyboard transition settles through the same re-measure path
	// without disturbing the healthy composer.
	await page.evaluate(() => window.visualViewport?.dispatchEvent(new Event("resize")));
	await page.waitForTimeout(500);
	const after = await page.evaluate(() => {
		const el = document.querySelector(".prompt .cm-content");
		return el instanceof HTMLElement ? el.getBoundingClientRect().height : -1;
	});
	expect(after).toBeGreaterThan(30);
});

/** Buttons hide by default on phones: tap reveals one row, bodies stay
visible throughout (only the text-hiding opt-in hides those), and the
row drops on its own after ~3s. */
test("message buttons hide until tapped", async ({ page }) => {
	await seedTwoChats(page);
	const row = page.locator("article.assistant .actions").first();
	const body = page.locator("article.assistant .rendered").first();
	await expect(row).toHaveCSS("opacity", "0");
	await expect(body).toBeVisible();
	// Tapping the message (not a control) opens its row...
	await body.click();
	await expect(row).toHaveCSS("opacity", "1");
	// ...and it closes itself after ~3s.
	await expect(row).toHaveCSS("opacity", "0", { timeout: 5000 });
});

/** The buttons checkbox ships checked: hiding rows is the default,
unchecking is the opt-out. */
test("buttons checkbox is checked by default", async ({ page }) => {
	await seedEmpty(page);
	await swipeX(page, 408, 268);
	await page.locator(".settings-panel").waitFor();
	const box = page.locator('label.check:has-text("Hide message buttons until tapped") input');
	await expect(box).toBeChecked();
});
