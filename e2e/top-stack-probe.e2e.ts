import { devices, expect, test } from "@playwright/test";
import { seedChat } from "./helpers";

test.use({ ...devices["iPhone 15"] });

test("top stack metrics", async ({ page }) => {
	await seedChat(page, [{ role: "user", content: "Test" }]);
	await page.goto("/");
	await expect(page.locator("article.user").first()).toBeVisible({ timeout: 60_000 });
	const info = await page.evaluate(() => {
		const header = document.querySelector(".app > header, .app header") as HTMLElement | null;
		const main = document.querySelector("main") as HTMLElement;
		const list = document.querySelector(".messages") as HTMLElement;
		const art = document.querySelector("article.user") as HTMLElement;
		const hb = header?.getBoundingClientRect();
		const cs = (el: HTMLElement, p: string) => getComputedStyle(el).getPropertyValue(p);
		const probe = document.createElement("div");
		probe.style.position = "fixed";
		probe.style.top = "env(safe-area-inset-top, 0px)";
		document.body.appendChild(probe);
		const envTop = probe.getBoundingClientRect().top;
		probe.remove();
		return {
			headerH: hb ? Math.round(hb.height) : null,
			headerY: hb ? Math.round(hb.y) : null,
			headerPadTop: header ? cs(header, "padding-top") : null,
			mainPadTop: cs(main, "padding-top"),
			listPadTop: cs(list, "padding-top"),
			artY: Math.round(art.getBoundingClientRect().y),
			envTop: Math.round(envTop * 10) / 10,
			innerH: window.innerHeight
		};
	});
	console.log("TOP " + JSON.stringify(info));
});
