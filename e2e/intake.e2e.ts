import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

test.beforeEach(async ({ page }) => {
	await seedChat(page, [{ role: "assistant", content: "alpha beta gamma delta" }]);
	// Force the download-blob export path: a native save picker cannot
	// be driven headless, so the picker must read as unavailable here.
	await page.addInitScript(() => {
		Object.defineProperty(window, "showSaveFilePicker", {
			value: undefined,
			configurable: true
		});
	});
	await page.goto("/");
	await expect(page.locator("article.assistant .rendered")).toBeVisible({
		timeout: 60_000
	});
});

test("composer accepts dropped files into the attachments path", async ({ page }) => {
	// A .md drop lands as a text attachment pill under the composer.
	// The event is dispatched in-page: DataTransfer is not serializable
	// across the protocol, so dispatchEvent cannot carry it.
	await page.evaluate(() => {
		const transfer = new DataTransfer();
		transfer.items.add(new File(["# hello"], "notes.md", { type: "text/markdown" }));
		const target = document.querySelector(".prompt");
		if (!target) throw new Error("missing composer");
		target.dispatchEvent(
			new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer })
		);
	});
	await expect(page.locator(".attachments .name")).toHaveText("notes.md", {
		timeout: 15_000
	});
});

test("export button downloads the chat as markdown", async ({ page }) => {
	const downloadPromise = page.waitForEvent("download", { timeout: 15_000 });
	await page.locator('header button[aria-label="Export chat as Markdown"]').click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(/^chat-\d{4}-\d{2}-\d{2}\.md$/);
	const path = await download.path();
	expect(path).toBeTruthy();
});

test("screenshot button renders where screen capture is supported", async ({ page }) => {
	const supported = await page.evaluate(
		() => typeof navigator.mediaDevices?.getDisplayMedia === "function"
	);
	const shot = page.locator('.prompt-tools button[aria-label="Capture a screenshot into the chat"]');
	if (supported) {
		// Present and idle: clicking opens the OS picker, which e2e
		// cannot drive, so presence plus the labelled control is the
		// assertion. Dismissing the picker must not error.
		await expect(shot).toBeVisible();
	} else {
		// Permission-gated: no capture API, no button, no dead control.
		await expect(shot).toHaveCount(0);
	}
});
