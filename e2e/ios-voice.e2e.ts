import { expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

/** iPhone Safari UA: rides the same phone UI as Android (see isIOSUserAgent). */
const IPHONE_UA =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

/** iOS-side inventory has no premium/enhanced tiers (all quality ≤ 1). */
const IOS_VOICES = [
	{ id: "com.apple.ttsbundle.Samantha-compact", name: "Samantha", lang: "en-US", quality: 1 },
	{ id: "com.apple.ttsbundle.Daniel-compact", name: "Daniel", lang: "en-GB", quality: 1 },
	{ id: "com.apple.ttsbundle.Marie-compact", name: "Marie", lang: "fr-FR", quality: 1 }
];

test.use({
	userAgent: IPHONE_UA,
	hasTouch: true,
	isMobile: true,
	viewport: { width: 390, height: 844 }
});

/** Stub the Tauri bridge: native engine present, everything else absent. */
async function iosBridge(page: Parameters<typeof seedChat>[0]): Promise<void> {
	await page.addInitScript((voices: typeof IOS_VOICES) => {
		(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
			invoke: async (cmd: string) => {
				if (cmd === "tts_supported") return true;
				if (cmd === "tts_voices") return voices;
				throw new Error(`unmocked command: ${cmd}`);
			}
		};
	}, IOS_VOICES);
}

test.beforeEach(async ({ page }) => {
	await iosBridge(page);
	await seedChat(page, [{ role: "user", content: "hi" }]);
	await page.goto("/");
	await expect(page.locator("article.user")).toBeVisible({ timeout: 60_000 });
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
});

/** iPhone UA activates the phone UI (textarea composer, no hover row). */
test("iphone rides the phone ui", async ({ page }) => {
	await expect(page.locator("[data-android]")).toHaveCount(1);
	await expect(
		page.locator(".settings-panel").getByText("Hide message buttons until tapped")
	).toBeVisible();
});

/** Both message checkboxes share one Messages box (no awkward gap). */
test("message toggles grouped in one fieldset", async ({ page }) => {
	const box = page.locator(".settings-panel fieldset", { hasText: "Hide message buttons" });
	await expect(box.locator("legend")).toHaveText("Messages");
	await expect(box.getByText("Hide message buttons until tapped")).toBeVisible();
	await expect(box.getByText("Enable background on my messages")).toBeVisible();
});

/** The voice picker lists every installed voice (no quality gate on iOS). */
test("ios voice picker lists installed voices", async ({ page }) => {
	const pick = page.locator(".settings-panel .voice-pick");
	await expect(pick.getByText("System voice (en-US)")).toBeVisible();
	const select = pick.locator("select");
	await expect(select.locator("option").nth(1)).toHaveText("Samantha");
	await expect(select.locator("option").nth(2)).toHaveText("Daniel · en-GB");
});

/** A picked voice is saved (debounced) and restored on boot. */
test("ios voice pick persists", async ({ page }) => {
	const select = page.locator(".settings-panel .voice-pick select");
	await select.selectOption("com.apple.ttsbundle.Daniel-compact");
	// Settings autosave debounces: let the pick land, then prove the save.
	await page.waitForTimeout(700);
	const saved = await page.evaluate(() =>
		window.localStorage.getItem("ccez-studio-settings-v1")
	);
	expect(saved).toContain("com.apple.ttsbundle.Daniel-compact");
	// Reload with a stored pick (addInitScript re-seeds every navigation,
	// so plain reload would wipe it like a fresh install): the picker
	// restores it instead of resetting to Auto.
	await page.addInitScript(() => {
		const raw = window.localStorage.getItem("ccez-studio-settings-v1") ?? "{}";
		const settings = JSON.parse(raw) as Record<string, unknown>;
		settings.nativeVoiceId = "com.apple.ttsbundle.Daniel-compact";
		window.localStorage.setItem("ccez-studio-settings-v1", JSON.stringify(settings));
	});
	await page.reload();
	await expect(page.locator("article.user")).toBeVisible({ timeout: 60_000 });
	await page.keyboard.press("Meta+,");
	await expect(page.locator(".settings-panel")).not.toHaveClass(/closed/);
	await expect(page.locator(".settings-panel .voice-pick select")).toHaveValue(
		"com.apple.ttsbundle.Daniel-compact"
	);
});
