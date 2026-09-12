import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

test.beforeEach(async ({ page }) => {
	await seedChat(page, []);
	await page.goto("/");
	await expect(page.locator(".cm-content").first()).toBeVisible({ timeout: 60_000 });
	await page.locator(".cm-content").first().click();
});

/** ```lang + Shift+Enter closes the fence behind a language bar with
per-language highlighting, collapse, and copy. */
test("fence opener plus shift-enter builds a python block", async ({ page }) => {
	// Nested language trees once crashed the highlighter when the bundle
	// held two copies of @lezer/common (see vite.config.js dedupe).
	const crashes: string[] = [];
	page.on("console", (m) => {
		if (m.type() === "error" && m.text().includes("CodeMirror plugin crashed"))
			crashes.push(m.text());
	});
	await page.keyboard.type("```python");
	await page.keyboard.press("Shift+Enter");
	const bar = page.locator(".cm-fence-bar");
	await expect(bar).toBeVisible();
	await expect(bar.locator(".cm-fence-lang")).toHaveText("python");
	// The cursor sits on the empty body line: typed code lands in the block…
	await page.keyboard.type("def hi():");
	// …highlighted as python (async language load gets its own beat): `def`
	// lands in its own span, colored differently from the plain line text.
	// (No tok-* class names: the installed @lezer/highlight renders the
	// default style with generated classes, so assert color, not class.)
	const defSpan = page.locator(".cm-content .cm-line span").filter({ hasText: /^def$/ });
	await expect(defSpan).toBeVisible({ timeout: 10_000 });
	const colors = await defSpan.evaluate((el) => {
		const line = el.closest(".cm-line");
		return { span: getComputedStyle(el).color, line: line ? getComputedStyle(line).color : "" };
	});
	expect(colors.span).not.toBe(colors.line);
	expect(crashes).toEqual([]);
	// …and Shift+Enter stays inside the block as a newline (plain Enter
	// submits the prompt by design).
	await page.keyboard.press("Shift+Enter");
	await page.keyboard.type("    pass");
	const bars = await page.locator(".cm-fence-bar").count();
	expect(bars).toBe(1);
	// Collapse hides the body behind one marker; expand restores it.
	await bar.locator('button[aria-label="Collapse code block"]').click();
	await expect(page.locator(".cm-fence-collapsed")).toBeVisible();
	await expect(defSpan).toHaveCount(0);
	await page.locator(".cm-fence-collapsed").click();
	await expect(defSpan).toBeVisible();
});

/** A second Shift+Enter on the empty body exits past the fence. */
test("shift-enter on an empty body exits the block", async ({ page }) => {
	await page.keyboard.type("```js");
	await page.keyboard.press("Shift+Enter");
	await expect(page.locator(".cm-fence-bar")).toBeVisible();
	await page.keyboard.press("Shift+Enter");
	await page.keyboard.type("hi");
	// Still one fence, and the typed text landed past its closing bar.
	expect(await page.locator(".cm-fence-bar").count()).toBe(1);
	const outside = await page.evaluate(() => {
		const content = document.querySelector(".cm-content");
		if (!content) return false;
		const end = content.querySelector(".cm-fence-end");
		if (!end) return false;
		const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			if (
				node.textContent?.includes("hi") &&
				(end.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
			) {
				return true;
			}
		}
		return false;
	});
	expect(outside).toBe(true);
});

/** An empty fence assumes text: bare ``` still builds the block. */
test("empty fence assumes text", async ({ page }) => {
	await page.keyboard.type("```");
	await page.keyboard.press("Shift+Enter");
	const bar = page.locator(".cm-fence-bar");
	await expect(bar).toBeVisible();
	await expect(bar.locator(".cm-fence-lang")).toHaveText("text");
	// Closer divider renders behind the body.
	await expect(page.locator(".cm-fence-end")).toBeVisible();
});

/** Backticks inside a body never nest: a lang-tagged inner fence stays
body text — one bar, no second block. */
test("inner backticks never nest", async ({ page }) => {
	await page.keyboard.type("```python");
	await page.keyboard.press("Shift+Enter");
	await expect(page.locator(".cm-fence-bar")).toBeVisible();
	await page.keyboard.type("x = 1");
	await page.keyboard.press("Shift+Enter");
	// Typed, never committed: inner backticks change nothing.
	await page.keyboard.type("```note");
	expect(await page.locator(".cm-fence-bar").count()).toBe(1);
	await expect(page.locator(".cm-content")).toContainText("```note");
});

/** Bar buttons are icon-only: glyphs, no text. */
test("fence buttons are icon-only", async ({ page }) => {
	await page.keyboard.type("```js");
	await page.keyboard.press("Shift+Enter");
	const bar = page.locator(".cm-fence-bar");
	await expect(bar).toBeVisible();
	for (const label of ["Collapse code block", "Copy code block"]) {
		const button = bar.locator(`button[aria-label="${label}"]`);
		await expect(button).toBeVisible();
		expect(((await button.innerText()) ?? "").trim()).toBe("");
		expect(await button.locator("svg").count()).toBe(1);
	}
});

/** Copy writes the fence body to the clipboard. */
test("fence copy writes the body", async ({ page, context }) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.keyboard.type("```rust");
	await page.keyboard.press("Shift+Enter");
	await page.keyboard.type("fn main() {}");
	await page.locator('.cm-fence-bar button[aria-label="Copy code block"]').click();
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toContain("fn main()");
});
