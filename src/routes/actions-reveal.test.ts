import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Stylesheet invariants for the hover-only message action rows.
 *
 * These assert on +page.svelte's <style> source because the behavior they
 * guard — compositor-layer promotion during the opacity fade — is invisible
 * to jsdom (no layout, no layers). The row must fade with opacity only
 * (never transform/translate/animation, or the buttons visibly shift
 * mid-fade) and must carry will-change so the layer exists before the fade
 * starts. will-change looks like removable dead weight; it is not.
 */
function pageStyle(): string {
	const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	// Strip CSS comments so prose can't trip the assertions below.
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
}

function pageSource(): string {
	return readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
}

describe("hover-only message actions", () => {
	it("reveals when the message is hovered, not just the button row", () => {
		const css = pageStyle();
		expect(css).toContain("article.user:hover .actions");
		expect(css).toContain("article.assistant:hover .actions");
	});

	it("keeps the row up while its message is speaking", () => {
		const css = pageStyle();
		expect(css).toContain("article.user.speaking .actions");
		expect(css).toContain("article.assistant.speaking .actions");
	});

	it("keeps the row up while an aid loads", () => {
		const css = pageStyle();
		expect(css).toContain("article.user.aid-loading .actions");
		expect(css).toContain("article.assistant.aid-loading .actions");
	});

	it("holds the touch row while aids load or audio runs", () => {
		const source = pageSource();
		const timer = source.match(/function armActionsTimer\(id: ChatMsgId\): void \{([\s\S]*?)\n\t\}/);
		expect(timer, "armActionsTimer is gone or reshaped — move the busy hold with it").toBeTruthy();
		const body = timer![1]!;
		// Every in-flight state that owns the row must re-arm, never close.
		for (const state of ["aidBusy.has(id)", "vocalizing.has(id)", "speakingId === id", "speakingSelection === id"]) {
			expect(body).toContain(state);
		}
		expect(body).toContain("armActionsTimer(id)");
	});

	it("stops speech from the composer button without flipping the setting", () => {
		const source = pageSource();
		const toggle = source.match(/function toggleVoice\(\): void \{([\s\S]*?)\n\t\}/);
		expect(toggle, "toggleVoice is gone or reshaped — keep the global stop in it").toBeTruthy();
		const body = toggle![1]!;
		expect(body).toContain("speakingId !== null");
		expect(body).toContain("stopVoice()");
		// The stop path returns before the setting toggle.
		expect(body.indexOf("stopVoice()")).toBeLessThan(body.indexOf("setVoiceEnabled"));
	});

	it("keeps will-change on the hover-hidden rows", () => {
		const css = pageStyle();
		const block = css.match(
			/main\.hover-user article\.user \.actions,\s*main\.hover-assistant article\.assistant \.actions\s*\{([^}]*)\}/
		);
		expect(
			block,
			"hover-hidden .actions rule is gone or restyled — move will-change with it, don't drop it"
		).toBeTruthy();
		expect(block![1]).toMatch(/opacity\s*:\s*0\s*;/);
		expect(block![1]).toMatch(/will-change\s*:\s*opacity\s*;/);
	});

	it("never moves the buttons with transform, translate, or animation", () => {
		const css = pageStyle();
		// The tooltip bubble (::after) intentionally rises; everything else
		// touching .actions must be motion-free so the fade can't shift.
		const offenders = css
			.split("\n")
			.filter((line) => line.includes(".actions"))
			.filter((line) => !line.includes("::after"))
			.filter((line) => /(transform|translate|animation)\s*:/.test(line));
		expect(offenders).toEqual([]);
	});
});
