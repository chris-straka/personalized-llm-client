import { sanitize } from "./render";

/**
 * Japanese furigana via kuroshiro + kuromoji. The 17MB dictionary is fetched
 * lazily on first use (never at startup) and conversions are cached.
 */

type KuroshiroInstance = {
	init(analyzer: unknown): Promise<void>;
	convert(text: string, options?: Record<string, unknown>): Promise<string>;
};

let ready: Promise<KuroshiroInstance> | null = null;
const cache = new Map<string, string>();

function dictPath(): string {
	// Vitest (node or jsdom) runs from the repo root; the browser serves /kuromoji/.
	const userAgent =
		typeof window !== "undefined" ? (window.navigator?.userAgent ?? "") : "";
	if (typeof window === "undefined" || /jsdom/i.test(userAgent)) {
		return "node_modules/kuromoji/dict/";
	}
	const base = import.meta.env.BASE_URL || "/";
	return `${base.replace(/\/$/, "")}/kuromoji/`;
}

async function loader(): Promise<KuroshiroInstance> {
	const [{ default: Kuroshiro }, { default: KuromojiAnalyzer }] = await Promise.all([
		import("kuroshiro"),
		import("kuroshiro-analyzer-kuromoji")
	]);
	const instance = new Kuroshiro();
	await instance.init(new KuromojiAnalyzer({ dictPath: dictPath() }));
	return instance;
}

/** Convert Japanese text to sanitized furigana ruby HTML. */
export async function furiganaHtml(text: string): Promise<string> {
	const cached = cache.get(text);
	if (cached !== undefined) return cached;
	ready ??= loader();
	const instance = await ready;
	const raw = await instance.convert(text, { to: "hiragana", mode: "furigana" });
	const html = sanitize(raw);
	cache.set(text, html);
	return html;
}
