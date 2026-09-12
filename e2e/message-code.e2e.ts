import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

const ASSISTANT = `<think>Let me think about what hello.py needs.</think>

Here is the file \`hello.py\` you asked for:

\`\`\`python
def hi():
    print("hi")
\`\`\`

Run it with \`python hello.py\`.`;

test.beforeEach(async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await seedChat(page, [
		{ role: "user", content: "give me python" },
		{ role: "assistant", content: ASSISTANT }
	]);
	await page.goto("/");
	await expect(page.locator(".ccez-code").first()).toBeVisible({ timeout: 60_000 });
	// Shiki enhancement is async: wait for highlighted spans.
	await expect(page.locator(".ccez-code .shiki span").first()).toBeVisible({ timeout: 20_000 });
});

/** AI fenced code renders highlighted, and short blocks hug the code. */
test("assistant python block is highlighted and narrow", async ({ page }) => {
	expect(await page.locator(".ccez-code .shiki span").count()).toBeGreaterThan(0);
	const sizes = await page.evaluate(() => {
		const block = document.querySelector(".ccez-code") as HTMLElement;
		return { block: block.offsetWidth, column: block.parentElement?.offsetWidth ?? 0 };
	});
	expect(sizes.column).toBeGreaterThan(0);
	expect(sizes.block).toBeLessThan(sizes.column);
});

/** Dark theme keeps filenames and code text readable (never white-on-white). */
test("dark code stays contrasted", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "dark" });
	await page.reload();
	await expect(page.locator(".ccez-code .shiki span").first()).toBeVisible({ timeout: 20_000 });
	const ratio = await page.evaluate(() => {
		const lum = (rgb: string): number => {
			const [r, g, b] = rgb
				.replace(/[^\d,]/g, "")
				.split(",")
				.map(Number) as [number, number, number];
			const f = (c: number): number => {
				const s = (c ?? 0) / 255;
				return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
			};
			return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
		};
		const contrast = (fg: string, bg: string): number => {
			const [a, z] = [lum(fg), lum(bg)].sort((x, y) => y - x) as [number, number];
			return (a + 0.05) / (z + 0.05);
		};
		const cs = (el: Element, p: string): string => getComputedStyle(el as HTMLElement).getPropertyValue(p);
		const inline = document.querySelector(".rendered :not(pre) > code") as HTMLElement;
		const pre = document.querySelector(".ccez-code pre") as HTMLElement;
		// Token spans carry the Shiki colors (the code element itself
		// merely inherits body text, so measuring it passes while
		// tokens stay dark-on-dark — the actual dark-theme bug).
		const tokens = Array.from(document.querySelectorAll(".ccez-code .shiki span")) as HTMLElement[];
		const preBg = cs(pre, "background-color");
		const worst = Math.min(...tokens.map((t) => contrast(cs(t, "color"), preBg)));
		return {
			theme: document.documentElement.getAttribute("data-theme"),
			inline: contrast(cs(inline, "color"), cs(inline, "background-color")),
			tokens: tokens.length,
			worstToken: worst
		};
	});
	expect(ratio.theme).toBe("dark");
	expect(ratio.inline).toBeGreaterThanOrEqual(4.5);
	expect(ratio.tokens).toBeGreaterThan(0);
	expect(ratio.worstToken).toBeGreaterThanOrEqual(4.5);
});

/** AI code blocks carry a language-label fold bar and no buttons. */
test("assistant code block has a label bar with no buttons", async ({ page }) => {
	const block = page.locator(".ccez-code").first();
	await expect(block.locator(".ccez-code-lang")).toHaveText("python");
	await expect(block.locator("button[data-code-action]")).toHaveCount(0);
	expect(await block.locator("button.ccez-code-head").count()).toBeGreaterThan(0);
});

/** Bar-click folds the code body and unfolds it back. */
test("code bar click folds the body", async ({ page }) => {
	const block = page.locator(".ccez-code").first();
	const bar = block.locator(".ccez-code-head");
	const pre = block.locator("pre");
	await expect(pre).toBeVisible();
	await bar.click();
	await expect(pre).toBeHidden();
	await expect(block).toHaveAttribute("data-folded", "1");
	await bar.click();
	await expect(pre).toBeVisible();
});

/** Body-click copies the code with a toast. */
test("code body click copies with a toast", async ({ page }) => {
	const block = page.locator(".ccez-code").first();
	await block.locator("pre").click();
	await expect(page.locator(".toast")).toHaveText("Copied", { timeout: 10_000 });
	expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('print("hi")');
});

/** Thoughts grow with the message font scale instead of stranding at 0.8rem. */
test("thoughts scale with font size", async ({ page }) => {
	const base = await page.evaluate(() =>
		getComputedStyle(document.querySelector(".ccez-thoughts") as HTMLElement).fontSize
	);
	await page.evaluate(() => {
		(document.querySelector(".app") as HTMLElement).style.setProperty("--font-scale", "2");
	});
	const scaled = await page.evaluate(() =>
		getComputedStyle(document.querySelector(".ccez-thoughts") as HTMLElement).fontSize
	);
	expect(parseFloat(base)).toBeGreaterThan(0);
	expect(parseFloat(scaled)).toBeCloseTo(parseFloat(base) * 2, 0);
});
