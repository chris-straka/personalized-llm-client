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

/** Display math renders KaTeX under a chevron bar with a TeX preview — no labels, no buttons. */
test("display block renders with buttonless chrome", async ({ page }) => {
	const block = page.locator(".ccez-math").first();
	await expect(block.locator(".ccez-math-chev")).toBeVisible();
	await expect(block.locator(".ccez-math-tex")).toContainText("E_n");
	await expect(block.locator(".ccez-math-lang")).toHaveCount(0);
	await expect(block.locator("button[data-math-action]")).toHaveCount(0);
	expect(await block.locator(".katex").count()).toBeGreaterThan(0);
});

/** Bar-click folds the rendered math body and unfolds it back. */
test("bar click folds the math body", async ({ page }) => {
	const block = page.locator(".ccez-math").first();
	const bar = block.locator(".ccez-math-head");
	const body = block.locator(".ccez-math-body");
	await expect(body).toBeVisible();
	await bar.click();
	await expect(body).toBeHidden();
	await expect(block).toHaveAttribute("data-folded", "1");
	await bar.click();
	await expect(body).toBeVisible();
	await expect(block).not.toHaveAttribute("data-folded", "1");
});

/** Body-click copies the raw TeX (not the delimiters or the rendering) plus a toast. */
test("body click copies raw tex with a toast", async ({ page }) => {
	const block = page.locator(".ccez-math").first();
	await block.locator(".ccez-math-body").click();
	await expect(page.locator(".toast")).toHaveText("Copied", { timeout: 10_000 });
	expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("E_n");
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

/** Right-clicking the fold bar never starts audio: nothing speaks and the live highlight keeps. */
test("right-click on the math fold bar stays silent", async ({ page }) => {
	const para = page.locator("article .rendered p").first();
	const box = await para.boundingBox();
	if (!box) throw new Error("paragraph has no box");
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + 10, y);
	await page.mouse.down();
	await page.mouse.move(box.x + 120, y, { steps: 5 });
	await page.mouse.up();
	const bar = page.locator(".ccez-math-head").first();
	await bar.click({ button: "right" });
	await page.waitForTimeout(500);
	await expect(page.locator("article.speaking, article.speaking-sel")).toHaveCount(0);
	const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
	expect(selected).not.toBe("");
});
