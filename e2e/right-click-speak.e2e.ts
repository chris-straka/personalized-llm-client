import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/**
 * Right-click reads aloud on desktop: a live selection first, else the
 * word under the cursor — and the native menu is never blocked (no
 * preventDefault), so Copy stays available beside speech.
 */
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		(window as unknown as { __spoken: string[] }).__spoken = [];
		(window as unknown as { __menuBlocked: boolean[] }).__menuBlocked = [];
		const synth = window.speechSynthesis;
		if (synth) {
			const origSpeak = synth.speak.bind(synth);
			void origSpeak;
			synth.speak = ((utterance: SpeechSynthesisUtterance) => {
				(window as unknown as { __spoken: string[] }).__spoken.push(utterance.text);
			}) as typeof synth.speak;
		}
		window.addEventListener("contextmenu", (event) => {
			setTimeout(() => {
				(window as unknown as { __menuBlocked: boolean[] }).__menuBlocked.push(
					event.defaultPrevented
				);
			}, 0);
		});
	});
	await seedChat(page, [{ role: "assistant", content: "alpha beta gamma delta" }]);
	await page.goto("/");
	await expect(page.locator("article.assistant .rendered p").first()).toBeVisible({
		timeout: 60_000
	});
});

async function spoken(page: import("@playwright/test").Page): Promise<string[]> {
	return page.evaluate(
		() => (window as unknown as { __spoken: string[] }).__spoken ?? []
	);
}

test("right-click with a selection reads the selection, menu unblocked", async ({
	page
}) => {
	const para = page.locator("article.assistant .rendered p").first();
	await para.dblclick({ position: { x: 10, y: 10 } });
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected.length).toBeGreaterThan(0);
	const box = await para.boundingBox();
	if (!box) throw new Error("missing para box");
	await page.mouse.click(box.x + 10, box.y + 10, { button: "right" });
	await expect.poll(() => spoken(page), { timeout: 10_000 }).toContain(selected);
	const blocked = await page.evaluate(
		() => (window as unknown as { __menuBlocked: boolean[] }).__menuBlocked ?? []
	);
	expect(blocked).toEqual([false]);
});

test("right-click a word with no selection reads the word", async ({ page }) => {
	const para = page.locator("article.assistant .rendered p").first();
	// Aim at the first word's own pixels: the paragraph box is wider
	// than its text, and blank space rightly reads nothing.
	const point = await para.evaluate((el) => {
		const text = el.firstChild;
		if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error("no text node");
		const range = document.createRange();
		range.setStart(text, 0);
		range.setEnd(text, 5);
		const rect = range.getBoundingClientRect();
		return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
	});
	// No selection: the word under the cursor goes out alone.
	await page.mouse.click(point.x, point.y, { button: "right" });
	await expect.poll(() => spoken(page), { timeout: 10_000 }).not.toHaveLength(0);
	const texts = await spoken(page);
	expect(texts.some((t) => /^[A-Za-z]+$/.test(t.trim()))).toBe(true);
});
