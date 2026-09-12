import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

const ASSISTANT = `The energy levels:

$$E_n = -\\frac{13.6\\text{ eV}}{n^2}$$

where \\(n = 1, 2, \\dots\\) counts the level.

Not math, just a price: $$totally broken \\sqrt{.

\`\`\`tex
$$E = mc^2$$
\`\`\``;

test.beforeEach(async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await seedChat(page, [
		{ role: "user", content: "show me the levels" },
		{ role: "assistant", content: ASSISTANT }
	]);
	await page.goto("/");
	await expect(page.locator(".ccez-math").first()).toBeVisible({ timeout: 60_000 });
});

/** Display math renders KaTeX in a headless body-only block: no fold bar, no buttons. */
test("display block renders headless with KaTeX", async ({ page }) => {
	const block = page.locator(".ccez-math").first();
	await expect(block.locator(".ccez-math-head")).toHaveCount(0);
	await expect(block.locator("button")).toHaveCount(0);
	await expect(block.locator(".ccez-math-body")).toBeVisible();
	expect(await block.locator(".katex").count()).toBeGreaterThan(0);
});

/** Body-click copies the TeX wrapped in $$ delimiters (a paste re-renders as display math) plus a toast. */
test("body click copies tex with delimiters plus a toast", async ({ page }) => {
	const block = page.locator(".ccez-math").first();
	await block.locator(".ccez-math-body").click();
	await expect(page.locator(".toast")).toHaveText("Copied", { timeout: 10_000 });
	const clip = await page.evaluate(() => navigator.clipboard.readText());
	expect(clip).toContain("E_n");
	expect(clip.trim().startsWith("$$")).toBe(true);
	expect(clip.trim().endsWith("$$")).toBe(true);
});

/** Inline math renders bare with no chrome at all. */
test("inline math renders with no chrome", async ({ page }) => {
	const inline = page.locator(".ccez-math-inline").first();
	await expect(inline).toBeVisible();
	await expect(inline.locator(".ccez-math-head")).toHaveCount(0);
	await expect(inline.locator("button")).toHaveCount(0);
	expect(await inline.locator(".katex").count()).toBeGreaterThan(0);
});

/** Single-dollar inline math renders with KaTeX; prices stay plain text. */
test("single-dollar inline math renders, prices stay plain", async ({ page }) => {
	await seedChat(page, [
		{ role: "user", content: "quadratic?" },
		{ role: "assistant", content: "Roots are $x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$ but it costs $5 and $10." }
	]);
	await page.goto("/");
	const inline = page.locator(".ccez-math-inline").first();
	await expect(inline).toBeVisible({ timeout: 60_000 });
	expect(await inline.locator(".katex").count()).toBeGreaterThan(0);
	await expect(page.locator(".ccez-math-inline")).toHaveCount(1);
	await expect(page.locator(".rendered").last()).toContainText("$5 and $10");
});

/** Invalid math and fenced $$ stay plain text, never fatal. */
test("invalid math and code fences stay plain", async ({ page }) => {
	const body = page.locator(".rendered").last();
	await expect(body).toContainText("totally broken");
	await expect(body).toContainText("E = mc^2");
	// One display block + one inline span; the broken $$ and the fence add none.
	await expect(page.locator(".ccez-math")).toHaveCount(1);
	await expect(page.locator(".ccez-math-inline")).toHaveCount(1);
});

/** The composer prompt never renders math: typed $$ stays plain text. */
test("composer does not render latex", async ({ page }) => {
	const composer = page.locator(".cm-content").first();
	await composer.click();
	await page.keyboard.type("$$x^2$$");
	await expect(composer.locator(".ccez-math")).toHaveCount(0);
	await expect(composer.locator(".ccez-math-inline")).toHaveCount(0);
});

/** Right-clicking the math block toggles the fold and never starts audio: zero speaking classes and the live highlight keeps. */
test("right-click on the math block toggles the fold and stays silent", async ({
	page
}) => {
	const para = page.locator("article .rendered p").first();
	const box = await para.boundingBox();
	if (!box) throw new Error("paragraph has no box");
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + 10, y);
	await page.mouse.down();
	await page.mouse.move(box.x + 120, y, { steps: 5 });
	await page.mouse.up();
	const block = page.locator(".ccez-math").first();
	const body = block.locator(".ccez-math-body");
	await expect(body).toBeVisible();
	await body.click({ button: "right" });
	await expect(block).toHaveAttribute("data-folded", "1");
	await expect(body).toBeHidden();
	await page.waitForTimeout(500);
	await expect(page.locator("article.speaking, article.speaking-sel")).toHaveCount(0);
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).not.toBe("");
	await block.click({ button: "right" });
	await expect(body).toBeVisible();
});

/** Equation granularity decision: a partial pick inside one equation
snaps to the whole equation (a glyph shard never re-matches, so the
entry point expands the range before quoting). Stale-highlight and
double-highlight rendering stay with the annotation/render lanes. */
test("partial equation pick snaps to the whole equation", async ({ page }) => {
	const body = page.locator(".ccez-math-body").first();
	const box = await body.boundingBox();
	if (!box) throw new Error("math body has no box");
	const y = box.y + box.height / 2;
	// A short drag covering only the left part of the equation.
	await page.mouse.move(box.x + 8, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.4, y, { steps: 5 });
	await page.mouse.up();
	const full = await body.evaluate((el) => el.textContent ?? "");
	expect(full.trim().length).toBeGreaterThan(0);
	// KaTeX splits glyphs across layout spans, so raw strings differ
	// in whitespace — compare whitespace-stripped: the snap must have
	// expanded the partial drag over the whole body.
	const flat = (s: string) => s.replace(/\s+/g, "");
	await expect
		.poll(
			() => page.evaluate(() => window.getSelection()?.toString() ?? "").then((s) => flat(s)),
			{ timeout: 8000 }
		)
		.toBe(flat(full));
});
