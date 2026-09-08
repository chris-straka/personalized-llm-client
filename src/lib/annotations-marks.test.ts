// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
	applyMarks,
	annotationCountLabel,
	WASH_FADE_MS,
	type AnnotationMark,
	type AnnotationId
} from "./annotations";

function rootWith(text: string): HTMLDivElement {
	const root = document.createElement("div");
	root.textContent = text;
	return root;
}

describe("applyMarks badges", () => {
	it("fades only newly stamped badges", () => {
		const marks: AnnotationMark[] = [{ id: "a1" as AnnotationId, number: 1, quote: "hello world" }];
		const root = rootWith("say hello world today");
		applyMarks(root, marks, false, null);
		const first = root.querySelector("[data-ann-badge]");
		expect(first?.classList.contains("fresh")).toBe(true);

		// Re-stamping the same marks (every render does this) keeps the
		// badge but must not replay the mount fade.
		applyMarks(root, marks, false, null);
		const badges = root.querySelectorAll("[data-ann-badge]");
		expect(badges).toHaveLength(1);
		expect(badges[0]?.classList.contains("fresh")).toBe(false);
	});

	it("marks a second quote fresh while the first stays settled", () => {
		const root = rootWith("alpha and beta");
		applyMarks(root, [{ id: "a1" as AnnotationId, number: 1, quote: "alpha" }], false, null);
		applyMarks(
			root,
			[
				{ id: "a1" as AnnotationId, number: 1, quote: "alpha" },
				{ id: "a2" as AnnotationId, number: 2, quote: "beta" }
			],
			false,
			null
		);
		const byId = (id: string) => root.querySelector(`[data-ann-badge="${id}"]`);
		expect(byId("a1")?.classList.contains("fresh")).toBe(false);
		expect(byId("a2")?.classList.contains("fresh")).toBe(true);
	});
});

describe("applyMarks wash fade", () => {
	const one: AnnotationMark[] = [{ id: "a1" as AnnotationId, number: 1, quote: "hello world" }];

	it("fades a newly arrived wash in once, not on re-stamp", () => {
		const root = rootWith("say hello world today");
		applyMarks(root, one, false, "a1");
		expect(root.querySelector("mark.ccez-ann")?.classList.contains("fresh")).toBe(true);

		// Re-stamping a steady wash (every render does this) keeps the
		// marks but must not replay the mount fade.
		applyMarks(root, one, false, "a1");
		const marks = root.querySelectorAll("mark.ccez-ann");
		expect(marks).toHaveLength(1);
		expect(marks[0]?.classList.contains("fresh")).toBe(false);
	});

	it("fades the wash out on clear, then unwraps", () => {
		vi.useFakeTimers();
		try {
			const root = rootWith("say hello world today");
			applyMarks(root, one, false, "a1");
			expect(root.querySelector("mark.ccez-ann")).not.toBeNull();

			applyMarks(root, one, false, null);
			// Still mounted (fading), text intact underneath.
			const leaving = root.querySelector("mark.ccez-ann");
			expect(leaving?.classList.contains("leaving")).toBe(true);
			expect(root.textContent).toContain("hello world");

			vi.advanceTimersByTime(WASH_FADE_MS);
			expect(root.querySelector("mark.ccez-ann")).toBeNull();
			expect(root.textContent).toContain("hello world");
		} finally {
			vi.useRealTimers();
		}
	});

	it("a superseding wash unwraps a fading mark immediately", () => {
		vi.useFakeTimers();
		try {
			const root = rootWith("alpha and beta");
			const two: AnnotationMark[] = [
				{ id: "a1" as AnnotationId, number: 1, quote: "alpha" },
				{ id: "a2" as AnnotationId, number: 2, quote: "beta" }
			];
			applyMarks(root, two, false, "a1");
			applyMarks(root, two, false, null);
			expect(root.querySelector("mark.ccez-ann")?.classList.contains("leaving")).toBe(true);

			applyMarks(root, two, false, "a2");
			const marks = root.querySelectorAll("mark.ccez-ann");
			expect(marks).toHaveLength(1);
			expect(marks[0]?.classList.contains("leaving")).toBe(false);

			// The stale fade-out timer no-ops on the detached node.
			vi.advanceTimersByTime(WASH_FADE_MS * 3);
			expect(root.querySelectorAll("mark.ccez-ann")).toHaveLength(1);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("annotationCountLabel", () => {
	it("shows the number, capped at 99+", () => {
		expect(annotationCountLabel(0)).toBe("0");
		expect(annotationCountLabel(1)).toBe("1");
		expect(annotationCountLabel(99)).toBe("99");
		expect(annotationCountLabel(100)).toBe("99+");
		expect(annotationCountLabel(1234)).toBe("99+");
	});
});
