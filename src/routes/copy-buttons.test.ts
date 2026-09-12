import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * Copy-button sweep: every copy control renders the shared message-button
 * copy glyph with no text label of its own.
 *
 * Asserts on +page.svelte source because icon-vs-text is a markup fact,
 * not runtime behavior. Fence copy buttons (editor.ts widgets) and the
 * buttonless render.ts code/math chrome are covered by their own
 * contracts; this file pins the Svelte half.
 */
function pageSource(): string {
	return readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");
}

/** Inner markup of every <button>…</button> in source order. */
function buttonBodies(source: string): string[] {
	const bodies: string[] = [];
	const re = /<button(\s[^>]*)?>([\s\S]*?)<\/button>/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(source)) !== null) bodies.push(match[2]!);
	return bodies;
}

describe("icon-only copy buttons", () => {
	it("leaves no button with a bare Copy text label", () => {
		const offenders = buttonBodies(pageSource()).filter(
			(body) => body.replace(/<[^>]*>/g, "").trim() === "Copy"
		);
		expect(offenders).toEqual([]);
	});

	it("gives the translation copy the shared glyph plus an accessible name", () => {
		const source = pageSource();
		const button = source.match(
			/<button[^>]*aria-label="Copy translation"[^>]*>([\s\S]*?)<\/button>/
		);
		expect(button, "Copy translation button is gone or reshaped").toBeTruthy();
		expect(button![1]).toContain('<ActionIcon kind="copy" />');
		expect(button![1]).not.toContain("Copy\n");
	});

	it("keeps the icon-copy treatment ghosted, not pilled", () => {
		const match = pageSource().match(/<style>([\s\S]*)<\/style>/);
		if (!match) throw new Error("+page.svelte has no <style> block");
		const css = match[1]!.replace(/\/\*[\s\S]*?\*\//g, "");
		const rule = css.match(/\.review-edit-actions button\.icon-copy\s*\{([^}]*)\}/);
		expect(rule, "icon-copy rule is gone — move it with the button").toBeTruthy();
		expect(rule![1]).toMatch(/background\s*:\s*none/);
	});
});
