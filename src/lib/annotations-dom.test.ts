// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
	quoteFragmentText,
	loadDraftAnnotations,
	saveDraftAnnotations,
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
