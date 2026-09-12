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

/** Display math renders KaTeX under a label head with Fold and Copy. */
test("display block renders with math chrome", async ({ page }) => {
	const block = page.locator(".ccez-math").first();
	await expect(block.locator(".ccez-math-lang")).toHaveText("math");
	await expect(block.locator('button[data-math-action="fold"]')).toHaveText("Fold");
	await expect(block.locator('button[data-math-action="copy"]')).toHaveText("Copy");
	expect(await block.locator(".katex").count()).toBeGreaterThan(0);
});

/** Fold collapses the rendered math body and unfolds it back. */
test("fold toggles the math body", async ({ page }) => {
	const block = page.locator(".ccez-math").first();
	const fold = block.locator('button[data-math-action="fold"]');
	const body = block.locator(".ccez-math-body");
	await expect(body).toBeVisible();
	await fold.click();
	await expect(body).toBeHidden();
	await expect(fold).toHaveText("Unfold");
	await fold.click();
	await expect(body).toBeVisible();
	await expect(fold).toHaveText("Fold");
});

/** Copy writes the raw TeX (not the delimiters or the rendering). */
test("copy writes raw tex to the clipboard", async ({ page }) => {
	const block = page.locator(".ccez-math").first();
	await block.locator('button[data-math-action="copy"]').click();
	await expect(block.locator('button[data-math-action="copy"]')).toHaveText("Copied", {
		timeout: 10_000
	});
	expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("E_n");
});

/** Inline math renders in place with the same buttons. */
test("inline math renders with fold and copy", async ({ page }) => {
	const inline = page.locator(".ccez-math-inline").first();
	await expect(inline).toBeVisible();
	await expect(inline.locator('button[data-math-action="copy"]')).toBeVisible();
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
