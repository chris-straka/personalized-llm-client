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
	const source = readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
	const match = source.match(/<style>([\s\S]*)<\/style>/);
	if (!match) throw new Error("+page.svelte has no <style> block");
	// Strip CSS comments so prose can't trip the assertions below.
	return match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
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
