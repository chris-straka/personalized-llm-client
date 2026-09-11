// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
	quoteFragmentText,
	loadDraftAnnotations,
	saveDraftAnnotations,
	snapSelectionToWordEdges,
	type Annotation
} from "./annotations";

function fragment(html: string): DocumentFragment {
	const template = document.createElement("template");
	template.innerHTML = html;
	return template.content;
}

describe("quoteFragmentText", () => {
	it("drops reading overlays and keeps the base text", () => {
		const text = quoteFragmentText(
			fragment(
				'<p>今日<span class="frb">漢<span class="frt">かん</span></span><span class="frb">字<span class="frt">じ</span></span>を読む</p>'
			)
		);
		expect(text).toBe("今日漢字を読む");
	});

	it("drops annotation badge numbers", () => {
		const text = quoteFragmentText(
			fragment('<p>Kyoto<button data-ann-badge="a1">1</button> in two sentences</p>')
		);
		expect(text).toBe("Kyoto in two sentences");
	});

	it("trims plain selections untouched", () => {
		expect(quoteFragmentText(fragment("<p>  hello world  </p>"))).toBe("hello world");
	});
});

describe("snapSelectionToWordEdges", () => {
	function selectIn(node: Text, start: number, end: number): Selection {
		const sel = window.getSelection();
		if (!sel) throw new Error("no selection");
		sel.setBaseAndExtent(node, start, node, end);
		return sel;
	}

	it("expands a mid-word drag to whole words, preserving direction", () => {
		document.body.innerHTML = "<p>hello world</p>";
		const node = document.querySelector("p")?.firstChild;
		if (!(node instanceof Text)) throw new Error("no text");
		const sel = selectIn(node, 2, 9);
		expect(snapSelectionToWordEdges(sel)).toBe(true);
		expect(sel.toString()).toBe("hello world");
		// Backwards drags keep their direction (anchor stays last).
		sel.setBaseAndExtent(node, 9, node, 2);
		expect(snapSelectionToWordEdges(sel)).toBe(true);
		expect(sel.toString()).toBe("hello world");
		expect(sel.anchorOffset).toBe(11);
		expect(sel.focusOffset).toBe(0);
	});

	it("reports false (and moves nothing) on clean edges and carets", () => {
		document.body.innerHTML = "<p>hello world</p>";
		const node = document.querySelector("p")?.firstChild;
		if (!(node instanceof Text)) throw new Error("no text");
		const sel = selectIn(node, 0, 5);
		expect(snapSelectionToWordEdges(sel)).toBe(false);
		expect(sel.toString()).toBe("hello");
		sel.collapse(node, 3);
		expect(snapSelectionToWordEdges(sel)).toBe(false);
	});

	it("snaps both ends of a multi-node selection", () => {
		document.body.innerHTML = "<p>alpha <b>beta gamma</b></p>";
		const first = document.querySelector("p")?.firstChild;
		const bold = document.querySelector("b")?.firstChild;
		if (!(first instanceof Text) || !(bold instanceof Text)) throw new Error("no text");
		const sel = window.getSelection();
		if (!sel) throw new Error("no selection");
		// "pha beta gam": start cut inside "alpha", end cut inside "gamma".
		sel.setBaseAndExtent(first, 2, bold, 8);
		expect(snapSelectionToWordEdges(sel)).toBe(true);
		expect(sel.toString()).toBe("alpha beta gamma");
	});
});

describe("draft annotation persistence", () => {
	const ann = (over: Partial<Annotation> = {}): Annotation => ({
		id: "a1" as Annotation["id"],
		messageId: "m1" as Annotation["messageId"],
		quote: "散歩",
		comment: "walk",
		at: 0,
		...over
	});

	beforeEach(() => {
		window.localStorage.clear();
	});

	it("round-trips drafts per chat", () => {
		expect(loadDraftAnnotations("c1")).toEqual([]);
		saveDraftAnnotations("c1", [ann()], ["c1"]);
		expect(loadDraftAnnotations("c1")).toEqual([ann()]);
		expect(loadDraftAnnotations("c2")).toEqual([]);
	});

	it("clearing a chat drops its entry, orphans prune on save", () => {
		saveDraftAnnotations("c1", [ann()], ["c1", "c2"]);
		saveDraftAnnotations("c2", [ann({ id: "a2" as Annotation["id"] })], ["c1", "c2"]);
		saveDraftAnnotations("c1", [], ["c1", "c2"]);
		expect(loadDraftAnnotations("c1")).toEqual([]);
		expect(loadDraftAnnotations("c2")).toHaveLength(1);
		// c2's chat deleted: next save prunes its drafts.
		saveDraftAnnotations("c1", [ann()], ["c1"]);
		expect(loadDraftAnnotations("c2")).toEqual([]);
	});

	it("drops corrupt entries and survives corrupt storage", () => {
		window.localStorage.setItem(
			"ccez-studio-annotations-v1",
			JSON.stringify({ c1: [ann(), null, "x", { id: 5 }, { ...ann(), at: "0" }] })
		);
		const loaded = loadDraftAnnotations("c1");
		expect(loaded).toHaveLength(2);
		expect(loaded[1]?.at).toBe(0);
		window.localStorage.setItem("ccez-studio-annotations-v1", "not json{");
		expect(loadDraftAnnotations("c1")).toEqual([]);
	});
});
