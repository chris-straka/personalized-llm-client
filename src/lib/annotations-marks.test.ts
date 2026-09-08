// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
	applyMarks,
	annotationCountLabel,
	lockSelectionToMessage,
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

describe("applyMarks badges over ruby", () => {
	function rubyBody(): HTMLDivElement {
		const root = document.createElement("div");
		root.innerHTML = "<p><ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>を読む</p>";
		return root;
	}

	/** Base text only: badges and readings are overlay, never content. */
	function baseText(root: Element): string {
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		const parts: string[] = [];
		while (walker.nextNode()) {
			const node = walker.currentNode;
			const parent = node.parentNode;
			if (
				parent instanceof Element &&
				parent.closest("[data-ann-badge], rt, rp")
			) {
				continue;
			}
			parts.push(node.textContent ?? "");
		}
		return parts.join("");
	}

	const one: AnnotationMark[] = [{ id: "a1" as AnnotationId, number: 1, quote: "漢字を読む" }];

	it("floats the badge on an anchor instead of inline text", () => {
		const root = rubyBody();
		applyMarks(root, one, false, null);
		const badge = root.querySelector("[data-ann-badge]");
		expect(badge?.textContent).toBe("1");
		// The badge never lands inside ruby (which shoved readings
		// aside); it rides a positioned anchor at the quote's end.
		expect(badge?.closest("ruby")).toBeNull();
		expect(badge?.parentElement?.classList.contains("ccez-ann-anchor")).toBe(true);
		// Stamping moved nothing: base text and readings intact.
		expect(baseText(root)).toBe("漢字を読む");
		expect(root.querySelector("rt")?.textContent).toBe("かんじ");
	});

	it("washes a preview without stamping its badge", () => {
		const root = rootWith("say hello world today");
		const preview: AnnotationMark[] = [
			{ id: "a1" as AnnotationId, number: 1, quote: "hello world", preview: true }
		];
		// Open (wash id matches): the quote highlights, no badge yet.
		applyMarks(root, preview, false, "a1");
		expect(root.querySelector("mark.ccez-ann")).not.toBeNull();
		expect(root.querySelector("[data-ann-badge]")).toBeNull();
		// Not open: the wash fades out, still no badge.
		applyMarks(root, preview, false, null);
		expect(root.querySelector("mark.ccez-ann.leaving")).not.toBeNull();
		expect(root.querySelector("[data-ann-badge]")).toBeNull();
		expect(root.textContent).toBe("say hello world today");
	});

	it("never matches a reading as message text", () => {
		const root = rubyBody();
		applyMarks(root, [{ id: "a1" as AnnotationId, number: 1, quote: "かんじ" }], false, null);
		expect(root.querySelector("[data-ann-badge]")).toBeNull();
		expect(root.querySelector("rt")?.textContent).toBe("かんじ");
	});

	it("re-stamping unwraps anchors without accumulating", () => {
		const root = rubyBody();
		applyMarks(root, one, false, null);
		applyMarks(root, one, false, null);
		expect(root.querySelectorAll("[data-ann-badge]")).toHaveLength(1);
		expect(root.querySelectorAll(".ccez-ann-anchor")).toHaveLength(1);
		expect(baseText(root)).toBe("漢字を読む");
	});

	it("anchors inside the wash region over ruby", () => {
		const root = rubyBody();
		applyMarks(root, one, false, "a1");
		const badge = root.querySelector("[data-ann-badge]");
		// Same end-char anchor as the unwashed state (hovering the wash
		// on and off never moves the badge); nested in the wash marks.
		expect(badge?.parentElement?.tagName).toBe("SPAN");
		expect(badge?.parentElement?.classList.contains("ccez-ann-anchor")).toBe(true);
		expect(badge?.closest("mark.ccez-ann")).not.toBeNull();
		expect(baseText(root)).toBe("漢字を読む");
		expect(root.querySelector("rt")?.textContent).toBe("かんじ");
	});
});

describe("lockSelectionToMessage", () => {
	function twoArticles(): HTMLElement {
		const root = document.createElement("div");
		root.innerHTML =
			'<article id="msg-0"><p>first message here</p></article>' +
			'<article id="msg-1"><p>second message here</p></article>';
		document.body.append(root);
		return root;
	}

	const articleOf = (node: Node | null): Element | null => {
		const el = node instanceof Element ? node : node?.parentElement;
		return el?.closest("article") ?? null;
	};

	it("trims a drag crossing into the next message", () => {
		const root = twoArticles();
		try {
			const sel = document.getSelection();
			if (!sel) throw new Error("no selection");
			const first = root.querySelector("#msg-0 p")?.firstChild;
			const second = root.querySelector("#msg-1 p")?.firstChild;
			if (!first || !second) throw new Error("no text nodes");
			sel.setBaseAndExtent(first, 0, second, 6);
			expect(lockSelectionToMessage(sel, articleOf)).toBe(true);
			expect(sel.focusNode === first || first.contains(sel.focusNode)).toBe(true);
			expect(sel.toString()).toBe("first message here");
		} finally {
			root.remove();
			document.getSelection()?.removeAllRanges();
		}
	});

	it("trims a drag reaching up into the previous message", () => {
		const root = twoArticles();
		try {
			const sel = document.getSelection();
			if (!sel) throw new Error("no selection");
			const first = root.querySelector("#msg-0 p")?.firstChild;
			const second = root.querySelector("#msg-1 p")?.firstChild;
			if (!first || !second) throw new Error("no text nodes");
			sel.setBaseAndExtent(second, 6, first, 0);
			expect(lockSelectionToMessage(sel, articleOf)).toBe(true);
			expect(sel.toString()).toBe("second");
		} finally {
			root.remove();
			document.getSelection()?.removeAllRanges();
		}
	});

	it("leaves collapsed and single-message selections alone", () => {
		const root = twoArticles();
		try {
			const sel = document.getSelection();
			if (!sel) throw new Error("no selection");
			const first = root.querySelector("#msg-0 p")?.firstChild;
			if (!first) throw new Error("no text nodes");
			sel.setBaseAndExtent(first, 0, first, 0);
			expect(lockSelectionToMessage(sel, articleOf)).toBe(false);
			sel.setBaseAndExtent(first, 0, first, 5);
			expect(lockSelectionToMessage(sel, articleOf)).toBe(false);
			expect(sel.toString()).toBe("first");
		} finally {
			root.remove();
			document.getSelection()?.removeAllRanges();
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
