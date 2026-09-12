import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

const ASSISTANT = `Here is a script:

\`\`\`python
print("hi")
\`\`\`

And one nobody can run:

\`\`\`haskell
main = return ()
\`\`\``;

test.beforeEach(async ({ page }) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await seedChat(page, [
		{ role: "user", content: "give me code" },
		{ role: "assistant", content: ASSISTANT }
	]);
	await page.goto("/");
	await expect(page.locator(".ccez-code").first()).toBeVisible({ timeout: 60_000 });
});

/** Every fenced block carries a Run button next to the copy icon. */
test("assistant code blocks have a Run button", async ({ page }) => {
	const blocks = page.locator(".ccez-code");
	await expect(blocks).toHaveCount(2);
	for (let i = 0; i < 2; i++) {
		const run = blocks.nth(i).locator("button.ccez-code-run");
		await expect(run).toHaveCount(1);
		await expect(run).toHaveAttribute("aria-label", "Run code block");
		await expect(blocks.nth(i).locator("button.ccez-code-copy")).toHaveCount(1);
	}
});

/** Browser preview has no shell: Run stamps the disabled reason, never a throw. */
test("Run without a backend shows the disabled note", async ({ page }) => {
	const block = page.locator(".ccez-code").first();
	await block.locator("button.ccez-code-run").click();
	const output = block.locator(".ccez-code-output");
	await expect(output).toBeVisible({ timeout: 10_000 });
	await expect(output).toContainText("desktop app");
});

/** Unknown fence labels get the honest no-runner note, not a guess. */
test("Run on an unrunnable language says so", async ({ page }) => {
	const block = page.locator(".ccez-code").nth(1);
	await block.locator("button.ccez-code-run").click();
	const output = block.locator(".ccez-code-output");
	await expect(output).toBeVisible({ timeout: 10_000 });
	await expect(output).toContainText("No local runner");
});

/** Run never folds the block, never copies, and stays silent. */
test("Run leaves fold, clipboard, and toasts alone", async ({ page }) => {
	await page.evaluate(() => navigator.clipboard.writeText("SENTINEL"));
	const block = page.locator(".ccez-code").first();
	await block.locator("button.ccez-code-run").click();
	await expect(block.locator(".ccez-code-output")).toBeVisible({ timeout: 10_000 });
	await expect(block).not.toHaveAttribute("data-folded", "1");
	await expect(block.locator("pre")).toBeVisible();
	await expect(page.locator(".toast", { hasText: "Copied" })).toHaveCount(0);
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("SENTINEL");
});
