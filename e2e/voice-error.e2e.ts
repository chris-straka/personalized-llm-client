import { test, expect } from "@playwright/test";
import { seedChat } from "./helpers";

/** Lab speech never fails at runtime (utterances queue silently), so these
specs stub `speak` to throw: `speakMultilingual` catches it and reports
false, which deterministically drives the unavailable-voice paths. */
async function throwingSpeak(page: Parameters<typeof seedChat>[0]): Promise<void> {
	await page.addInitScript(() => {
		const synth = window.speechSynthesis;
		if (!synth) return;
		Object.defineProperty(synth, "speak", {
			value: () => {
				throw new Error("stubbed speech failure");
			},
			configurable: true
		});
	});
}

async function webEngine(page: Parameters<typeof seedChat>[0]): Promise<void> {
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		window.localStorage.setItem("ccez-studio-settings-v1", JSON.stringify({ voiceEngine: "web" }));
	});
}

test("explicit speak failure banners, then expires", async ({ page }) => {
	await throwingSpeak(page);
	await webEngine(page);
	await seedChat(page, [{ role: "assistant", content: "hello there" }]);
	await page.goto("/");
	const article = page.locator("article.assistant");
	await expect(article).toBeVisible({ timeout: 60_000 });
	await article.hover();
	await article.locator('button[aria-label="Read this message aloud"]').click();
	const toast = page.locator(".voice-error");
	await expect(toast).toBeVisible();
	await expect(toast).toBeHidden({ timeout: 20_000 });
});

test("background readback failure stays silent", async ({ page }) => {
	await throwingSpeak(page);
	await page.addInitScript(() => {
		window.localStorage.setItem("ccez-mock-provider", "1");
		// NOTE: voice itself can't be seeded — every boot resets it to
		// false by design, so the test enables it post-boot below. Only
		// the engine survives seeding.
		window.localStorage.setItem("ccez-studio-settings-v1", JSON.stringify({ voiceEngine: "web" }));
		// Count every banner appearance: the failure banner auto-expires,
		// so a final absence proves nothing — only "never shown" does.
		// Deferred past document readiness (init scripts can run before
		// documentElement exists); the spec asserts the ready flag.
		window.voiceToastSeen = 0;
		window.voiceToastWatching = false;
		const watch = (): void => {
			if (!document.documentElement) {
				requestAnimationFrame(watch);
				return;
			}
			new MutationObserver((mutations) => {
				for (const m of mutations) {
					for (const n of m.addedNodes) {
						if (n instanceof Element && n.classList.contains("voice-error")) {
							window.voiceToastSeen++;
						}
					}
				}
			}).observe(document.documentElement, { childList: true, subtree: true });
			window.voiceToastWatching = true;
		};
		watch();
	});
	await page.goto("/");
	// Readback on, through the same toggle a user would press.
	await expect
		.poll(
			async () =>
				page.evaluate(
					() => window.voiceToastWatching === true
				),
			{ timeout: 10_000 }
		)
		.toBe(true);
	// Readback on, through the same toggle a user would press.
	await page.locator(".prompt-tools .voice-float").click();
	await expect(page.locator(".prompt-tools .voice-float")).toHaveAttribute("aria-pressed", "true");
	await page.locator(".prompt .cm-content").click();
	await page.keyboard.type("say hi");
	await page.keyboard.press("Enter");
	await expect(page.locator("article.assistant .rendered")).toBeVisible({ timeout: 60_000 });
	// Past the reply and any failure banner's full auto-expiry.
	await page.waitForTimeout(12_000);
	const seen = await page.evaluate(
		() => window.voiceToastSeen ?? -1
	);
	expect(seen).toBe(0);
});
