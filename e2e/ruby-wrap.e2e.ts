import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Ruby geometry: readings must sit over their own base characters.
 * Two regressions lived here: a multi-kanji furigana base fragmented
 * across a line break (its reading centered against the broken box
 * and drifted right of the kanji), and per-character pinyin
 * syllables longer than one Hanzi colliding into an unreadable row.
 */
test.setTimeout(120_000);

test("a wrapped multi-kanji base keeps its reading centered", async ({ page }) => {
	await page.setViewportSize({ width: 480, height: 800 });
	// One 12-kanji run: at this width it must wrap mid-run.
	await seedChat(page, [{ role: "assistant", content: "国際連合教育科学文化機関の活動について" }]);
	await page.goto("/");
	const actions = page.locator("article.assistant .actions");
	const body = page.locator("article.assistant .rendered");
	await expect(actions).toBeVisible({ timeout: 60_000 });
	await actions.locator('button:has-text("読み仮名")').click();
	await expect(body.locator(".frb").first()).toBeVisible({ timeout: 60_000 });
	// macOS pulls readings further left (Hiragana bearings put the
	// ink right of the kanji at the default offset), so box centers
	// no longer coincide there — ink does. Measure paint truth via
	// Range rects on mac, boxes elsewhere.
	const dataMac = await page.locator(".app").getAttribute("data-mac");
	const drift = await body.evaluate(
		(el, mac) => {
			const rect = (node: Node): { l: number; w: number } => {
				if (!mac) {
					const r = (node as Element).getBoundingClientRect();
					return { l: r.left, w: r.width };
				}
				const rg = document.createRange();
				rg.selectNodeContents(node);
				const r = rg.getBoundingClientRect();
				return { l: r.left, w: r.width };
			};
			let worst = 0;
			for (const base of el.querySelectorAll(".frb")) {
				const reading = base.querySelector(".frt");
				if (!reading?.firstChild || !base.firstChild) continue;
				const b = rect(mac ? base.firstChild : base);
				const r = rect(mac ? reading.firstChild : reading);
				worst = Math.max(worst, Math.abs(b.l + b.w / 2 - (r.l + r.w / 2)));
			}
			return worst;
		},
		dataMac !== null
	);
	expect(drift).toBeLessThan(dataMac !== null ? 2 : 4);
});

test("long pinyin syllables never collide with their neighbors", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "双方创造价值" }]);
	await page.goto("/");
	const actions = page.locator("article.assistant .actions");
	const body = page.locator("article.assistant .rendered");
	await expect(actions).toBeVisible({ timeout: 60_000 });
	await actions.locator('button:has-text("拼音")').click();
	await expect(body.locator("ruby").first()).toBeVisible({ timeout: 60_000 });
	// Paint truth, not layout boxes: Range ink rects decide collisions.
	const overlaps = await body.evaluate((el) => {
		const boxes = [...el.querySelectorAll("rt")]
			.map((r) => {
				const rg = document.createRange();
				rg.selectNodeContents(r);
				return rg.getBoundingClientRect();
			})
			.filter((b) => b.width > 0 && b.height > 0);
		let hits = 0;
		for (let i = 0; i < boxes.length; i++) {
			for (let j = i + 1; j < boxes.length; j++) {
				const a = boxes[i] as DOMRect;
				const b = boxes[j] as DOMRect;
				const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
				const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
				if (x > 1 && y > 1) hits++;
			}
		}
		return { hits, count: boxes.length };
	});
	expect(overlaps.count).toBeGreaterThan(3);
	expect(overlaps.hits).toBe(0);
});

test("furigana stays off Chinese lines", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "漢字を読む\n银行" }]);
	await page.goto("/");
	const actions = page.locator("article.assistant .actions");
	const body = page.locator("article.assistant .rendered");
	await expect(actions).toBeVisible({ timeout: 60_000 });
	await actions.locator('button:has-text("読み仮名")').click();
	await expect(body.locator(".frb").first()).toBeVisible({ timeout: 60_000 });
	// Only the Japanese line converts (漢字 one run, 読 one).
	await expect(body.locator(".frb")).toHaveCount(2);
	await expect(body.locator('.frb:has-text("银")')).toHaveCount(0);
	await expect(body).toContainText("银行");
});

test("pinyin stays off Japanese lines", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "漢字を読む\n银行" }]);
	await page.goto("/");
	const actions = page.locator("article.assistant .actions");
	const body = page.locator("article.assistant .rendered");
	await expect(actions).toBeVisible({ timeout: 60_000 });
	await actions.locator('button:has-text("拼音")').click();
	await expect(body.locator("ruby").first()).toBeVisible({ timeout: 60_000 });
	// Only the Han-only line converts (银, 行).
	await expect(body.locator("ruby")).toHaveCount(2);
	await expect(body.locator('ruby:has-text("漢")')).toHaveCount(0);
	await expect(body).toContainText("漢字を読む");
});

test("pinning an aid keeps Arabic direction", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "مرحبا بالعالم\n你好世界" }]);
	await page.goto("/");
	const actions = page.locator("article.assistant .actions");
	const body = page.locator("article.assistant .rendered");
	await expect(actions).toBeVisible({ timeout: 60_000 });
	await actions.locator('button:has-text("拼音")').click();
	await expect(body.locator("ruby").first()).toBeVisible({ timeout: 60_000 });
	const dir = await body.evaluate((el) => {
		const ps = [...el.querySelectorAll("p")];
		const arabic = ps.find((p) => p.textContent?.includes("مرحبا"));
		if (!arabic) throw new Error("no Arabic paragraph");
		return { attr: arabic.getAttribute("dir"), css: getComputedStyle(arabic).direction };
	});
	expect(dir.attr).toBe("auto");
	expect(dir.css).toBe("rtl");
});

test("pinyin spreads only readings that overflow their Hanzi", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "双方创造价值" }]);
	await page.goto("/");
	const actions = page.locator("article.assistant .actions");
	const body = page.locator("article.assistant .rendered");
	await expect(actions).toBeVisible({ timeout: 60_000 });
	// Natural Hanzi advance from the plain line's text node (6 uniform
	// Hanzi; the <p> itself is a full-width block, so its box lies).
	const plain = await body.evaluate((el) => {
		const p = el.querySelector("p");
		if (!p?.firstChild) throw new Error("no paragraph text");
		const rg = document.createRange();
		rg.selectNodeContents(p.firstChild);
		return rg.getBoundingClientRect().width / 6;
	});
	await actions.locator('button:has-text("拼音")').click();
	await expect(body.locator("ruby").first()).toBeVisible({ timeout: 60_000 });
	const widths = await body.evaluate((el) =>
		[...el.querySelectorAll("ruby")].map((b) => b.getBoundingClientRect().width),
	);
	expect(widths.length).toBe(6);
	const min = Math.min(...widths);
	const max = Math.max(...widths);
	// Fitting readings cost ~nothing; overflowing ones spread.
	expect(Math.abs(min - plain)).toBeLessThan(1.5);
	expect(max - min).toBeGreaterThan(3);
});
