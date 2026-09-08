import { describe, it, expect } from "vitest";
import { isAndroidUserAgent, isCoarsePointer, edgeSwipeTarget, visibleProviderIds } from "./platform";

const ANDROID_UA =
	"Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const IPHONE_UA =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const MAC_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

describe("isAndroidUserAgent", () => {
	it("matches Android phones and tablets", () => {
		expect(isAndroidUserAgent(ANDROID_UA)).toBe(true);
		expect(
			isAndroidUserAgent("Mozilla/5.0 (Linux; Android 13; Pixel Tablet) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36")
		).toBe(true);
	});
	it("rejects iOS and desktop agents", () => {
		expect(isAndroidUserAgent(IPHONE_UA)).toBe(false);
		expect(isAndroidUserAgent(MAC_UA)).toBe(false);
		expect(isAndroidUserAgent("")).toBe(false);
	});
});

describe("isCoarsePointer", () => {
	it("passes the coarse query through", () => {
		const seen: string[] = [];
		const query = (media: string) => {
			seen.push(media);
			return { matches: true };
		};
		expect(isCoarsePointer(query)).toBe(true);
		expect(seen).toEqual(["(pointer: coarse)"]);
	});
	it("returns false when fine or when the query throws", () => {
		expect(isCoarsePointer(() => ({ matches: false }))).toBe(false);
		expect(
			isCoarsePointer(() => {
				throw new Error("no matchMedia");
			})
		).toBe(false);
	});
});

describe("edgeSwipeTarget", () => {
	const W = 412; // S24-class viewport width
	it("opens chats on a rightward swipe from the left edge", () => {
		expect(edgeSwipeTarget(4, 600, 120, 604, W)).toBe("chats");
	});
	it("opens settings on a leftward swipe from the right edge", () => {
		expect(edgeSwipeTarget(W - 4, 600, W - 120, 596, W)).toBe("settings");
	});
	it("rejects short drags, vertical scrolls, and mid-screen swipes", () => {
		expect(edgeSwipeTarget(4, 600, 30, 600, W)).toBeNull(); // too short
		expect(edgeSwipeTarget(4, 600, 120, 760, W)).toBeNull(); // vertical
		expect(edgeSwipeTarget(150, 600, 260, 604, W)).toBeNull(); // mid-screen
		expect(edgeSwipeTarget(4, 600, 3, 600, W)).toBeNull(); // wrong way
	});
	it("honors custom distance and zone", () => {
		expect(edgeSwipeTarget(30, 0, 100, 0, W, 48, 24)).toBeNull(); // outside zone
		expect(edgeSwipeTarget(30, 0, 100, 0, W, 48, 32)).toBe("chats");
	});
});

describe("visibleProviderIds", () => {
	const CLOUD = ["muse", "deepseek"];
	it("lists everything on desktop, online or not", () => {
		expect(visibleProviderIds(CLOUD, { android: false, online: true, local: false })).toEqual(CLOUD);
		expect(visibleProviderIds(CLOUD, { android: false, online: false, local: false })).toEqual(CLOUD);
	});
	it("hides the local entry where its bridge can't exist", () => {
		const all = [...CLOUD, "local-gemma"];
		expect(visibleProviderIds(all, { android: false, online: true, local: true })).toEqual(CLOUD);
	});
	it("shows local alongside cloud on online Android once bridged", () => {
		const all = [...CLOUD, "local-gemma"];
		expect(visibleProviderIds(all, { android: true, online: true, local: true })).toEqual(all);
		expect(visibleProviderIds(all, { android: true, online: true, local: false })).toEqual(CLOUD);
	});
	it("keeps only local on offline Android", () => {
		const all = [...CLOUD, "local-gemma"];
		expect(visibleProviderIds(all, { android: true, online: false, local: true })).toEqual(["local-gemma"]);
		expect(visibleProviderIds(all, { android: true, online: false, local: false })).toEqual([]);
	});
});
