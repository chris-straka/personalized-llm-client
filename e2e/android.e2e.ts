import { test, expect, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

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

test.describe("gestures", () => {
	/**
	 * Android milestone (S24 Galaxy): key chords don't exist on a phone, so
	 * the shortcuts modal teaches touch gestures. Since the gesture
	 * redesign, rightward strokes never summon the chats sheet (two-finger
	 * double-tap owns it) — they only dismiss settings. These specs pin the
	 * UA-gated branches that ship on desktop today.
	 */
	test.beforeEach(async ({ page }) => {
		await seedChat(page, [{ role: "assistant", content: "hello" }]);
		await page.goto("/");
		await expect(page.locator("article .rendered").first()).toBeVisible();
	});

	/** Synthetic right-edge swipe: the phone gesture that opens settings. */
	async function swipeFromRightEdge(page: Page): Promise<void> {
		const width = await page.evaluate(() => window.innerWidth);
		await page.evaluate((w: number) => {
			const touch = (x: number, y: number) =>
				new Touch({ identifier: 9, target: document.body, clientX: x, clientY: y });
			window.dispatchEvent(
				new TouchEvent("touchstart", { bubbles: true, cancelable: true, composed: true, touches: [touch(w - 4, 600)] })
			);
			window.dispatchEvent(
				new TouchEvent("touchend", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [],
					changedTouches: [touch(w - 140, 604)]
				})
			);
		}, width);
	}

	test("shortcuts modal teaches touch gestures on Android", async ({ page }) => {
		await swipeFromRightEdge(page);
		await page.locator('button:has-text("Show all gestures")').click();
		await expect(page.locator("#shortcuts-heading")).toBeVisible();
		await expect(page.locator("#shortcuts-heading")).toHaveText("Touch gestures");
		const modal = page.locator(".modal-veil");
		await expect(modal.locator('dt:has-text("Chats list")')).toBeVisible();
		await expect(modal.locator('dd:has-text("Two-finger double-tap")')).toBeVisible();
		await expect(modal.locator('dt:has-text("Chats sidebar")')).toHaveCount(0);
		await expect(modal.locator('dt:has-text("Newer / older chat")')).toBeVisible();
		await expect(modal.locator('dd:has-text("Two-finger swipe right / left")')).toBeVisible();
		await expect(modal.locator('dt:has-text("Delete current chat")')).toBeVisible();
		await expect(modal.locator('dd:has-text("Double three-finger tap")')).toBeVisible();
	});

	/** Synthetic edge swipe (untrusted TouchEvents still hit window listeners). */
	async function swipeFromLeftEdge(page: Page): Promise<void> {
		await page.evaluate(() => {
			const touch = (x: number, y: number) =>
				new Touch({ identifier: 7, target: document.body, clientX: x, clientY: y });
			window.dispatchEvent(
				new TouchEvent("touchstart", { bubbles: true, cancelable: true, composed: true, touches: [touch(4, 600)] })
			);
			window.dispatchEvent(
				new TouchEvent("touchend", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [],
					changedTouches: [touch(140, 604)]
				})
			);
		});
	}

	test("edge swipe from the left toggles the chat sidebar", async ({ page }) => {
		const aside = page.locator("aside:has(button.side-chat)");
		const panel = page.locator(".settings-panel");
		// State varies by persisted settings; read it, then prove the
		// stroke toggles it — closed opens (onto the search box), open
		// dismisses — and the same stroke toggles it back.
		const startedOpen = !(await aside.getAttribute("class"))?.includes("collapsed");
		await swipeFromLeftEdge(page);
		if (startedOpen) await expect(aside).toHaveClass(/collapsed/);
		else await expect(aside).not.toHaveClass(/collapsed/);
		await swipeFromLeftEdge(page);
		if (startedOpen) await expect(aside).not.toHaveClass(/collapsed/);
		else await expect(aside).toHaveClass(/collapsed/);
		// Normalize shut: the settings half needs the sheet closed.
		if (startedOpen) await swipeFromLeftEdge(page);
		// Dismiss half still works: open settings from the right edge,
		// then watch a rightward stroke close them (sheet stays shut).
		await swipeFromRightEdge(page);
		await expect(panel).not.toHaveClass(/closed/);
		await swipeFromLeftEdge(page);
		await expect(panel).toHaveClass(/closed/);
		await expect(aside).toHaveClass(/collapsed/);
	});

	/** Synthetic mid-screen swipe (same untrusted-event path as edges). */
	async function swipeMidScreen(page: Page, x0: number, x1: number): Promise<void> {
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

	test("mid-screen swipe right toggles the chat sidebar", async ({ page }) => {
		const aside = page.locator("aside:has(button.side-chat)");
		const panel = page.locator(".settings-panel");
		// Same ownership as the edge rule: the stroke toggles the sheet
		// in either state, and still dismisses an open settings.
		const startedOpen = !(await aside.getAttribute("class"))?.includes("collapsed");
		await swipeMidScreen(page, 150, 260);
		if (startedOpen) await expect(aside).toHaveClass(/collapsed/);
		else await expect(aside).not.toHaveClass(/collapsed/);
		await swipeMidScreen(page, 150, 260);
		if (startedOpen) await expect(aside).not.toHaveClass(/collapsed/);
		else await expect(aside).toHaveClass(/collapsed/);
		// Normalize shut: the settings half needs the sheet closed.
		if (startedOpen) await swipeMidScreen(page, 150, 260);
		await swipeFromRightEdge(page);
		await expect(panel).not.toHaveClass(/closed/);
		await swipeMidScreen(page, 150, 260);
		await expect(panel).toHaveClass(/closed/);
		await expect(aside).toHaveClass(/collapsed/);
	});

	test("mid-screen swipe left toggles the settings panel", async ({ page }) => {
		const panel = page.locator(".settings-panel");
		const startedOpen = !(await panel.getAttribute("class"))?.includes("closed");
		await swipeMidScreen(page, 260, 150);
		if (startedOpen) await expect(panel).toHaveClass(/closed/);
		else await expect(panel).not.toHaveClass(/closed/);
	});
});

test.describe("share", () => {
	/**
	 * Share-into-chat (Android ACTION_SEND): the system Share sheet lists
	 * the app via the MainActivity SEND filter, MainActivity forwards
	 * EXTRA_TEXT through the annotate-external bridge, and the frontend
	 * prefills the composer (see MainActivity.handleSend and the
	 * annotate-external listener in +page.svelte). The native intent half
	 * is device-only and NOT covered here — no Android toolchain runs in
	 * this harness, so verify on a real device/CI with: share a URL from
	 * Chrome into the app cold (killed) and warm (running), and confirm
	 * the composer prefills exactly once each time. These specs pin the
	 * user-visible end state the bridge produces, through the
	 * web-reachable equivalent: shared text arriving in the phone
	 * composer lands verbatim, stays editable, and sends as a message.
	 */
	/** Android composes in a plain textarea, not CodeMirror. */
	const SHARE = "Look at this\nhttps://example.com/menu";

	test("shared text lands verbatim in an empty phone composer", async ({ page }) => {
		await seedEmpty(page);
		// The bridge prefills an empty draft with the share as-is.
		const box = page.locator(".prompt .ta-input");
		await box.click();
		await box.fill(SHARE);
		await expect(box).toHaveValue(SHARE);
		// Still editable: the user can add a question above the share.
		await box.evaluate((el) => {
			if (el instanceof HTMLTextAreaElement) el.setSelectionRange(0, 0);
		});
		await page.keyboard.type("what is this? ");
		await expect(box).toHaveValue(`what is this? ${SHARE}`);
	});

	test("a share into an empty app sends as the first message", async ({ page }) => {
		await seedEmpty(page);
		// Cold-start share outcome: the app opens on a chat whose first
		// user message carries the shared text.
		const box = page.locator(".prompt .ta-input");
		await box.click();
		await box.fill(SHARE);
		await page.locator(".send-btn").click();
		const sent = page.locator("article.user").filter({ hasText: "example.com/menu" });
		await expect(sent).toBeVisible({ timeout: 15000 });
	});
});

test.describe("touch", () => {
	/**
	 * Android touch batch: one-line region pills, bottom-sheet chats, the
	 * touch selection menu with Speak, two-finger chat steps, three-finger
	 * delete, sidebar mutual exclusion, and the theme pin. Same UA-gated
	 * branches as android.e2e.ts, S24-class viewport.
	 */
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

	/** Synthetic two-finger double-tap (owns the chats sidebar on Android). */
	async function doubleTapTwoFinger(page: Page): Promise<void> {
		for (let tap = 0; tap < 2; tap++) {
			await page.evaluate(() => {
				const touch = (id: number, x: number, y: number) =>
					new Touch({ identifier: id, target: document.body, clientX: x, clientY: y });
				window.dispatchEvent(
					new TouchEvent("touchstart", {
						bubbles: true,
						cancelable: true,
						composed: true,
						touches: [touch(1, 200, 500), touch(2, 240, 500)]
					})
				);
				window.dispatchEvent(
					new TouchEvent("touchend", {
						bubbles: true,
						cancelable: true,
						composed: true,
						touches: [],
						changedTouches: [touch(1, 200, 500), touch(2, 240, 500)]
					})
				);
			});
			if (tap === 0) await page.waitForTimeout(120);
		}
	}

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
		// Since the toggle redesign, a rightward stroke with everything
		// shut summons chats (and the same stroke dismisses them); a
		// leftward stroke with the sheet open just closes it, and
		// settings summon after that.
		await swipeX(page, 4, 144);
		await expect(aside).not.toHaveClass(/collapsed/);
		await swipeX(page, 4, 144);
		await expect(aside).toHaveClass(/collapsed/);
		// Two-finger double-tap still summons the sidebar too.
		await doubleTapTwoFinger(page);
		await expect(aside).not.toHaveClass(/collapsed/);
		await swipeX(page, 408, 268);
		await expect(aside).toHaveClass(/collapsed/);
		await expect(panel).toHaveClass(/closed/);
		await swipeX(page, 408, 268);
		await expect(panel).not.toHaveClass(/closed/);
	});

	test("two-finger swipe right steps to the newer chat", async ({ page }) => {
		await seedTwoChats(page);
		const before = await page.locator("article .rendered").first().innerText();
		// Since the gesture redesign, chat steps glide horizontally (the
		// vertical stroke belongs to scrolling); right steps newer.
		await page.evaluate(() => {
			const touch = (id: number, x: number, y: number) =>
				new Touch({ identifier: id, target: document.body, clientX: x, clientY: y });
			const start = [touch(1, 150, 500), touch(2, 190, 500)];
			window.dispatchEvent(
				new TouchEvent("touchstart", { bubbles: true, cancelable: true, composed: true, touches: start })
			);
			window.dispatchEvent(
				new TouchEvent("touchmove", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [touch(1, 310, 500), touch(2, 350, 500)]
				})
			);
			window.dispatchEvent(
				new TouchEvent("touchend", {
					bubbles: true,
					cancelable: true,
					composed: true,
					touches: [],
					changedTouches: [touch(1, 310, 500), touch(2, 350, 500)]
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

	test("touch selection docks Annotate in the composer, never floating", async ({ page }) => {
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
		// The floating menu is desktop-only now: nothing near the text.
		await expect(page.locator(".sel-menu")).toHaveCount(0);
		// The dock button lives in the composer tools, below the message.
		const dock = page.locator(".ann-dock");
		await expect(dock).toHaveText("Annotate");
		await expect(dock).toBeVisible();
		const msgBox = await page.locator("article .rendered").first().boundingBox();
		const dockBox = await dock.boundingBox();
		expect(dockBox?.y ?? 0).toBeGreaterThan((msgBox?.y ?? 0) + (msgBox?.height ?? 0));
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
		// Collapsed rows reserve no space, so the hidden article is
		// zero-height — wait for attachment, not visibility.
		await page.locator("article").first().waitFor({ state: "attached" });
		const body = page.locator("article .rendered").first();
		await expect(body).toBeHidden();
		await page.evaluate(() => {
			document.querySelector("article")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});
		await expect(body).toBeVisible();
		await expect(body).toBeHidden({ timeout: 5000 });
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

		/** A tap on the docked Annotate opens the comment box: taps near a
		selection handle are swallowed as handle nudges (no click ever
		arrives), so the button runs off touchend instead of waiting for
		onclick. */
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
			const btn = page.locator('.ann-dock:has-text("Annotate")');
			await expect(btn).toBeVisible();
			// A real tap on the button: on-device the handle eats the click,
			// so the comment box must open off the touch sequence itself.
			// (Synthetic TouchEvents don't reach Svelte's touch handlers —
			// only trusted taps exercise this path.)
			const btnBox = await btn.boundingBox();
			if (!btnBox) throw new Error("no annotate box");
			await page.touchscreen.tap(btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2);
			await expect(page.locator(".ann-pop")).toBeVisible();
			// The composer gets out of the way while the box owns the
			// keyboard, and comes back when the box closes.
			await expect(page.locator(".prompt")).toHaveClass(/prompt-hidden/);
			await expect(page.locator(".prompt")).not.toBeVisible();
			await page.keyboard.press("Escape");
			await expect(page.locator(".ann-pop")).toHaveCount(0);
			await expect(page.locator(".prompt")).toBeVisible();
		});

		/** Double-tapping a message taller than the screen scrolls its
		action row into view: phones have no hover to reveal it. Rows
		already visible never move. */
		test("double-tapping a tall message reveals its action row", async ({ page }) => {
			const long = Array.from({ length: 60 }, (_, i) => `line ${i} of a very tall message`).join("\n");
			await page.addInitScript((content: string) => {
				window.localStorage.setItem("ccez-mock-provider", "1");
				window.localStorage.setItem("ccez-studio-settings-v1", JSON.stringify({}));
				window.localStorage.setItem(
					"ccez-studio-chats-v1",
					JSON.stringify([
						{
							id: "e2e-chat",
							createdAt: 1,
							replyLang: null,
							messages: [{ id: "e2e-m0", role: "assistant", content, usage: null, error: null }]
						}
					])
				);
			}, long);
			await page.goto("/");
			const article = page.locator("article.assistant").first();
			await expect(article).toBeVisible({ timeout: 60_000 });
			const actions = article.locator(".actions");
			// Park at the top so the action row starts below the fold.
			await article.evaluate((el) => el.scrollIntoView({ block: "start" }));
			await page.waitForTimeout(800);
			const below = await actions.boundingBox();
			expect(below?.y ?? 0).toBeGreaterThan(915);
			await article.locator(".rendered").first().dblclick();
			await expect
				.poll(async () => (await actions.boundingBox())?.y ?? 9999, { timeout: 10_000 })
				.toBeLessThan(915);
		});
	});

	/** Sending in a new chat leaves a one-line composer: the reply's layout
	churn (and the keyboard's viewport churn on phones) must never strand
	the emptied editor at zero height until the next keystroke heals it. */
	test("composer holds one line after the reply lands", async ({ page }) => {
		await seedEmpty(page);
		// Android composes in a plain textarea, not CodeMirror.
		const box = page.locator(".prompt .ta-input");
		await box.click();
		await page.keyboard.type("hello world");
		await page.keyboard.press("Enter");
		await expect(page.locator('article .rendered:has-text("Mock reply to:")')).toBeVisible({ timeout: 15000 });
		const heights = await page.evaluate(() => {
			const el = document.querySelector(".prompt .ta-input");
			return el instanceof HTMLElement ? el.getBoundingClientRect().height : -1;
		});
		// One empty line plus the field's vertical padding (~40px): the
		// stranded state measured ~0 here with no placeholder at all.
		expect(heights).toBeGreaterThan(30);
		expect(await box.getAttribute("placeholder")).toBeTruthy();
		// A keyboard transition settles through the same re-measure path
		// without disturbing the healthy composer.
		await page.evaluate(() => window.visualViewport?.dispatchEvent(new Event("resize")));
		await page.waitForTimeout(500);
		const after = await page.evaluate(() => {
			const el = document.querySelector(".prompt .ta-input");
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

	/** A press inside an open row owns it: holding a button past the 3s
	mark must not watch the row vanish mid-press. Release happens off the
	button so no action fires; the cleared timer stays cleared. */
	test("holding a row button outlives the auto-dismiss", async ({ page }) => {
		await seedTwoChats(page);
		const row = page.locator("article.assistant .actions").first();
		const body = page.locator("article.assistant .rendered").first();
		await expect(body).toBeVisible();
		await body.click();
		await expect(row).toHaveCSS("opacity", "1");
		const btn = row.locator("button").first();
		const box = await btn.boundingBox();
		if (!box) throw new Error("row button lost its box");
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.waitForTimeout(3500);
		await expect(row).toHaveCSS("opacity", "1");
		await page.mouse.move(4, 300);
		await page.mouse.up();
		await expect(row).toHaveCSS("opacity", "1");
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
});
