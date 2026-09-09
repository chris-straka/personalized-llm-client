import { expect, test, type Page } from "@playwright/test";
import { seedChat } from "./helpers";

const SENTENCE = "テストを確認しました。何かお手伝いできることはありますか？";

test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: SENTENCE }]);
	await page.goto("/");
	await expect(page.locator("article .rendered").first()).toBeVisible();
});

async function clickText(page: Page, count: 1 | 2 | 3 | 4): Promise<void> {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	if (count === 1) await page.mouse.click(box.x + 20, box.y + box.height / 2);
	else if (count === 2) await page.mouse.dblclick(box.x + 20, box.y + box.height / 2);
	else await page.mouse.click(box.x + 20, box.y + box.height / 2, { clickCount: count });
}

/** Spaceless scripts have no words to pick: double-click keeps the
native fragment (and still summons the menu). */
test("double-click in Japanese keeps the word pick", async ({ page }) => {
	await clickText(page, 2);
	await expect(page.locator(".sel-menu")).toBeVisible();
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("テスト");
});

/** Triple-click keeps native behavior: the whole paragraph is picked. */
test("triple-click in Japanese selects the paragraph", async ({ page }) => {
	await clickText(page, 3);
	await expect(page.locator(".sel-menu")).toBeVisible();
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("テストを確認しました。何かお手伝いできることはありますか？");
});

/** The paragraph pick holds wherever in it the triple-click lands. */
test("triple-click on the second sentence selects the paragraph", async ({ page }) => {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	await page.mouse.click(box.x + box.width * 0.7, box.y + box.height / 2, { clickCount: 3 });
	await expect(page.locator(".sel-menu")).toBeVisible();
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("テストを確認しました。何かお手伝いできることはありますか？");
});

/** Plain clicks on blank space drop a stale highlight, never re-summon. */
test("clicking blank space deselects instead of reopening the menu", async ({ page }) => {
	await clickText(page, 2);
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.waitForTimeout(2700);
	await expect(page.locator(".sel-menu")).toHaveCount(0);
	await page.mouse.click(10, 300);
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("");
	await expect(page.locator(".sel-menu")).toHaveCount(0);
});

/** Right-click reads the highlight aloud but keeps it: the text and
its highlight stay put (the menu itself may dismiss). */
test("right-click keeps the highlighted text", async ({ page }) => {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + 10, y);
	await page.mouse.down();
	await page.mouse.move(box.x + 150, y, { steps: 5 });
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.mouse.click(box.x + 60, y, { button: "right" });
	await page.waitForTimeout(400);
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).not.toBe("");
});

/** Clicking inside a live highlight clears the highlight AND the menu —
neither strands the other. */
test("clicking inside the highlight clears it with the menu", async ({ page }) => {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + 10, y);
	await page.mouse.down();
	await page.mouse.move(box.x + 150, y, { steps: 5 });
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.mouse.click(box.x + 60, y);
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("");
	await expect(page.locator(".sel-menu")).toHaveCount(0);
});

/** Clicking a stale highlight (menu already faded) clears it without
re-summoning the menu. */
test("clicking a stale highlight never brings the menu back", async ({ page }) => {
	const body = page.locator("article .rendered").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + 170, y);
	await page.mouse.down();
	await page.mouse.move(box.x + 300, y, { steps: 5 });
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.waitForTimeout(2700);
	await expect(page.locator(".sel-menu")).toHaveCount(0);
	await page.mouse.click(box.x + 200, y);
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("");
	await expect(page.locator(".sel-menu")).toHaveCount(0);
});

/** Four clicks: the paragraph pick comes off again and the menu goes
with it instead of stranding. */
test("fourth click clears the paragraph pick and the menu", async ({ page }) => {
	await clickText(page, 4);
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).toBe("");
	await expect(page.locator(".sel-menu")).toHaveCount(0);
});

/** Repeats anchor where selected: annotating the last "c" in "ccc"
stamps the badge on the last "c", not the first. */
test("annotating a repeated character anchors the selected repeat", async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "ccc" }]);
	await page.goto("/");
	const body = page.locator("article .rendered").first();
	await expect(body).toBeVisible();
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	const y = box.y + box.height / 2;
	// Real press to normalize the click guard, then a real range over
	// the last "c" before the matching mouseup summons the menu.
	await page.mouse.click(box.x + 10, y);
	await page.mouse.move(box.x + box.width - 2, y);
	await page.mouse.down();
	await page.evaluate(() => {
		const text = document.querySelector("article .rendered p")?.firstChild;
		if (!(text instanceof Text)) throw new Error("no message text");
		window.getSelection()?.setBaseAndExtent(text, 2, text, 3);
	});
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.keyboard.press("Enter");
	const offset = await page.evaluate(() => {
		const badge = document.querySelector("article .rendered [data-ann-badge]");
		const anchor = badge?.parentElement;
		const host = anchor?.closest("p") ?? undefined;
		if (!anchor || !host) return -1;
		let n = 0;
		const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (anchor.contains(node)) return n;
			n += node.textContent?.length ?? 0;
		}
		return -1;
	});
	expect(offset).toBe(2);
});

/** The prompt's review card grows up and to the left of its pill —
never right over the send button's airspace — and opens covering the
pill, so the cursor is already inside it. */
test("prompt review card opens up and to the left", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.keyboard.press("Enter");
	await hoverPromptPill(page);
	const card = page.locator(".ann-wrap .review");
	await expect(card).toBeVisible();
	const boxes = await page.evaluate(() => {
		const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
		const r = rect(".ann-wrap .review");
		const w = rect(".ann-wrap");
		const p = rect(".prompt-tools .ann-pill");
		if (!r || !w || !p) return null;
		return {
			cardRight: r.right,
			cardTop: r.y,
			wrapRight: w.right,
			wrapTop: w.top,
			pillCX: p.x + p.width / 2,
			pillCY: p.y + p.height / 2,
			card: { x: r.x, y: r.y, w: r.width, h: r.height }
		};
	});
	if (!boxes) throw new Error("review card missing boxes");
	// Grows upward from the pill, right-aligned with it.
	expect(boxes.cardTop).toBeLessThan(boxes.wrapTop);
	expect(Math.abs(boxes.cardRight - boxes.wrapRight)).toBeLessThanOrEqual(2);
	// The pill's center sits inside the open card (zero travel gap).
	expect(boxes.pillCX).toBeGreaterThanOrEqual(boxes.card.x);
	expect(boxes.pillCX).toBeLessThanOrEqual(boxes.card.x + boxes.card.w);
	expect(boxes.pillCY).toBeGreaterThanOrEqual(boxes.card.y);
	expect(boxes.pillCY).toBeLessThanOrEqual(boxes.card.y + boxes.card.h);
});

/** The sent message's refs card opens covering its number pill. */
test("message refs card opens over its number", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.keyboard.type("meaning?");
	await page.keyboard.press("Enter");
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveText("1");
	await page.locator(".cm-content").click();
	await page.keyboard.type("go");
	await page.waitForTimeout(600);
	await page.keyboard.press("Enter");
	const pill = page.locator("article.user .ann-refs-pill");
	await expect(pill).toHaveText("1");
	const pillBox = await pill.boundingBox();
	if (!pillBox) throw new Error("pill has no box");
	await page.mouse.move(pillBox.x + pillBox.width / 2, pillBox.y + pillBox.height / 2);
	const card = page.locator("article.user .ann-refs-pop");
	await expect(card).toBeVisible();
	const inside = await page.evaluate(() => {
		const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
		const c = rect("article.user .ann-refs-pop");
		const p = rect("article.user .ann-refs-pill");
		if (!c || !p) return null;
		const cx = p.x + p.width / 2;
		const cy = p.y + p.height / 2;
		return cx >= c.x && cx <= c.x + c.width && cy >= c.y && cy <= c.y + c.height;
	});
	expect(inside).toBe(true);
});

/** Hover the prompt pill via coordinates: the open card covers the
pill by design, so locator.hover() can't hit-target it afterwards. */
async function hoverPromptPill(page: Page): Promise<void> {
	const pill = page.locator(".prompt-tools .ann-pill");
	await expect(pill).toBeVisible();
	const box = await pill.boundingBox();
	if (!box) throw new Error("pill has no box");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page.locator(".prompt-tools .review")).toBeVisible();
}

/** Select a quote and open its comment box through the real UI. */
async function openAnnotate(page: Page, quote: string): Promise<void> {
	await page.locator(`article .rendered:has-text("${quote}")`).first().selectText();
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
}

/** File the open comment box (empty comment allowed) and submit it. */
async function submitAnnotation(page: Page): Promise<void> {
	await page.keyboard.press("Enter");
	await page.locator(".cm-content").click();
	await page.keyboard.type("go");
	await page.keyboard.press("Enter");
	await expect(page.locator("button.ccez-ann-badge")).toHaveCount(1);
}

/** Clicking off an empty draft cancels: no ghost annotation is filed. */
test("clicking off an empty draft cancels the annotation", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.mouse.click(10, 300);
	await expect(page.locator(".ann-pop")).toHaveCount(0);
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveCount(0);
});

/** Enter with no text files the (empty) annotation for submit. */
test("enter with an empty draft files the annotation", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.keyboard.press("Enter");
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveText("1");
});

/** Re-pressing the open badge closes its edit menu like cancel. */
test("badge re-press closes the edit menu", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await submitAnnotation(page);
	const badge = page.locator("button.ccez-ann-badge").first();
	const box = await badge.boundingBox();
	if (!box) throw new Error("badge has no box");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await expect(page.locator(".ann-pop")).toHaveCount(0);
});

/** The review popup shows quotes with note: labels, no Selected text. */
test("review popup uses note labels", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.keyboard.type("meaning?");
	await submitAnnotation(page);
	await hoverPromptPill(page);
	const review = page.locator(".prompt-tools .review");
	await expect(review).toContainText("note:");
	await expect(review).not.toContainText("Selected text");
	await expect(review).not.toContainText("User comment");
});

/** An annotations-only message renders folded with its quotes previewed. */
test("annotations-only message renders folded", async ({ page }) => {
	await seedChat(page, [
		{
			role: "user",
			content: 'Annotated selections:\n1. "風に舞う" — What does this mean?\n2. "夕暮れの公園で" — What does this mean?'
		}
	]);
	await page.reload();
	const article = page.locator("article.user");
	await expect(article).toBeVisible();
	const preview = article.locator(".folded-preview");
	await expect(preview).toContainText("風に舞う");
	await expect(article.locator(".ann-refs-pill")).toBeVisible();
	// Unfolding reveals the full block and drops the pill.
	await article.locator('.actions button[aria-label="Unfold this message"]').click();
	await expect(article.locator(".rendered")).toContainText("Annotated selections:");
	await expect(article.locator(".ann-refs-pill")).toHaveCount(0);
	// Refolding restores the compact view.
	await article.locator('.actions button[aria-label="Fold this message"]').click();
	await expect(article.locator(".folded-preview")).toBeVisible();
});

/** No message row offers an audio download anymore. */
test("message rows have no download button", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "hello" },
		{ role: "assistant", content: "hi there" }
	]);
	await page.reload();
	for (const role of ["user", "assistant"] as const) {
		await page.locator(`article.${role} .rendered`).first().hover();
		await expect(
			page.locator(`article.${role} .actions [aria-label="Download audio for this message"]`)
		).toHaveCount(0);
	}
});

/** Sending files the pending annotations with the message: the composer
pill is gone while the reply is still on its way. */
test("sending clears pending annotations immediately", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.keyboard.type("meaning?");
	await page.keyboard.press("Enter");
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveText("1");
	await page.locator(".cm-content").click();
	await page.keyboard.type("go");
	// The Enter that filed the annotation must not double as a send.
	await page.waitForTimeout(600);
	await page.keyboard.press("Enter");
	// The pill leaves with the send, not with the reply.
	await expect(page.locator("article.user .rendered")).toContainText("go");
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveCount(0);
	await expect(page.locator("article.assistant .rendered").last()).toContainText("Mock reply");
	// The sent message carries the block (folded with its count).
	await expect(page.locator("article.user .ann-refs-pill")).toHaveText("1");
});

/** The pencil edits an own message, then resends it: the message
rewrites and the stale reply is replaced by a fresh one. */
test("pencil edit saves and resends", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "helo world" },
		{ role: "assistant", content: "hi" }
	]);
	await page.reload();
	const article = page.locator("article.user");
	await expect(article).toBeVisible();
	await article.hover();
	await article.locator('.actions button[aria-label="Edit this message"]').click();
	// Nothing is deleted; the text is in the composer to fix.
	await expect(page.locator("article.user")).toHaveCount(1);
	await expect(page.locator("article.assistant")).toHaveCount(1);
	await expect(page.locator(".cm-content")).toContainText("helo world");
	// Fix the typo and save: the message rewrites, the stale reply is
	// replaced by a fresh answer to the edit.
	await page.locator(".cm-content").click();
	await page.keyboard.press("Control+a");
	await page.keyboard.type("hello world");
	await page.keyboard.press("Enter");
	await expect(page.locator("article.user .rendered")).toContainText("hello world");
	await expect(page.locator("article.user")).toHaveCount(1);
	await expect(page.locator("article.assistant")).toHaveCount(1);
	await expect(page.locator("article.assistant .rendered")).toContainText("Mock reply");
});

/** Hovering an own message and hitting E starts editing it. */
test("E key edits the hovered own message", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "helo world" }]);
	await page.reload();
	const article = page.locator("article.user");
	await expect(article).toBeVisible();
	// Click first: focus starts in the prompt, which owns keystrokes.
	await article.locator(".rendered").click();
	await article.hover();
	await page.keyboard.press("e");
	await expect(page.locator(".cm-content")).toContainText("helo world");
	// Esc cancels: history untouched, composer empty.
	await page.keyboard.press("Escape");
	await expect(page.locator(".cm-content")).not.toContainText("helo world");
	await expect(page.locator("article.user .rendered")).toContainText("helo world");
});

/** Clear-all sits at the bottom-right of the review overlay. */
test("clear-all lives at the bottom of the review", async ({ page }) => {
	await openAnnotate(page, "確認しました");
	await page.keyboard.press("Enter");
	await hoverPromptPill(page);
	const review = page.locator(".prompt-tools .review");
	const tools = review.locator(".review-tools");
	await expect(tools).toContainText("Clear all");
	const reviewBox = await review.boundingBox();
	const toolsBox = await tools.boundingBox();
	if (!reviewBox || !toolsBox) throw new Error("review lost its box");
	// Bottom edge: the tools row ends where the overlay ends.
	expect(reviewBox.y + reviewBox.height - (toolsBox.y + toolsBox.height)).toBeLessThan(24);
	// Right edge: the tools row ends where the overlay ends.
	expect(reviewBox.x + reviewBox.width - (toolsBox.x + toolsBox.width)).toBeLessThan(40);
	await tools.locator("button").click();
	await expect(page.locator(".prompt-tools .ann-pill")).toHaveCount(0);
});

/** Multi-paragraph quotes wash without painting the paragraph gaps: no
whitespace-only marks, no layout growth while the wash is on, and a
live highlight survives hovering the badge on and off. */
test("multi-paragraph wash paints no gaps and keeps the highlight", async ({ page }) => {
	await seedChat(page, [
		{ role: "assistant", content: "First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here." }
	]);
	await page.goto("/");
	const body = page.locator("article .rendered").first();
	await expect(body).toBeVisible();
	// Selectable text nodes: skip badge chrome and inter-block gaps.
	const selectAcross = (from: number, to: number) =>
		page.evaluate(
			([a, b]: number[]) => {
				const texts: Text[] = [];
				const walker = document.createTreeWalker(
					document.querySelector("article .rendered"),
					NodeFilter.SHOW_TEXT
				);
				while (walker.nextNode()) {
					const node = walker.currentNode;
					const parent = node.parentNode;
					if (parent instanceof Element && parent.closest("[data-ann-badge]")) continue;
					if (node instanceof Text && /\S/.test(node.textContent ?? "")) texts.push(node);
				}
				const first = texts[0];
				const last = texts[texts.length - 1];
				if (!first || !last || a === undefined || b === undefined) throw new Error("no text");
				window.getSelection()?.setBaseAndExtent(first, a, last, b);
				return window.getSelection()?.toString() ?? "";
			},
			[from, to] as [number, number]
		);
	expect(await selectAcross(6, 5)).toBe("paragraph here.\n\nSecond paragraph here.\n\nThird");
	await page.mouse.up();
	await expect(page.locator(".sel-menu")).toBeVisible();
	await page.locator('.sel-menu button:has-text("Annotate")').click();
	await expect(page.locator(".ann-pop")).toBeVisible();
	await page.keyboard.press("Enter");
	const badge = page.locator("button.ccez-ann-badge");
	await expect(badge).toHaveCount(1);
	const snapshot = () =>
		page.evaluate(() => {
			const root = document.querySelector("article .rendered");
			const marks = [...(root?.querySelectorAll("mark.ccez-ann") ?? [])].map((m) => m.textContent);
			const box = root?.querySelector("button.ccez-ann-badge")?.getBoundingClientRect();
			return {
				blankMarks: marks.filter((text) => !/\S/.test(text ?? "")).length,
				badgeY: box ? Math.round(box.y) : -1,
				height: root?.getBoundingClientRect().height
			};
		});
	const washed = await snapshot();
	expect(washed.blankMarks).toBe(0);
	// A live highlight inside the washed region survives hover on/off.
	// (The preview wash split the paragraphs at the first selection's
	// edges, so re-anchor by content, not by node order.)
	const reselected = await page.evaluate(() => {
		const texts: Text[] = [];
		const walker = document.createTreeWalker(
			document.querySelector("article .rendered"),
			NodeFilter.SHOW_TEXT
		);
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (node instanceof Text && node.textContent === "paragraph here.") texts.push(node);
		}
		const target = texts[0];
		if (!target) throw new Error("no target");
		window.getSelection()?.setBaseAndExtent(target, 0, target, 9);
		return window.getSelection()?.toString() ?? "";
	});
	expect(reselected).toBe("paragraph");
	const box = await badge.boundingBox();
	if (!box) throw new Error("badge has no box");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.waitForTimeout(300);
	const hovered = await snapshot();
	expect(hovered.blankMarks).toBe(0);
	expect(hovered.height).toBe(washed.height);
	expect(hovered.badgeY).toBe(washed.badgeY);
	expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("paragraph");
	await page.mouse.move(4, 4);
	await page.waitForTimeout(400);
	const left = await snapshot();
	expect(left.height).toBe(washed.height);
	expect(left.badgeY).toBe(washed.badgeY);
	expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("paragraph");
});

/** RTL paragraphs lay out right-to-left (dir=auto), so a top-right to
bottom drag starts at the text's start instead of mid-text. */
test("rtl drag from the top-right selects the whole paragraph", async ({ page }) => {
	const para =
		"القط السمين يجلس على السجادة القديمة في غرفة المعيشة المشمسة. الكلب الصغير يركض بسرعة في الحديقة الخضراء الواسعة. الطائر الأزرق يغرد بصوت عال فوق الأشجار العالية.";
	await seedChat(page, [{ role: "assistant", content: para }]);
	await page.goto("/");
	const body = page.locator("article .rendered").first();
	await expect(body).toBeVisible();
	await expect(body.locator("p").first()).toHaveAttribute("dir", "auto");
	const box = await body.boundingBox();
	if (!box) throw new Error("message has no box");
	await page.mouse.move(box.x + box.width - 4, box.y + 8);
	await page.mouse.down();
	await page.mouse.move(box.x + 4, box.y + box.height - 4, { steps: 15 });
	await page.mouse.up();
	const sel = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	// Was 47 of 162 before per-block direction: the first sentence dropped.
	expect(sel.length).toBeGreaterThan(150);
	await expect(page.locator(".sel-menu")).toBeVisible();
});
