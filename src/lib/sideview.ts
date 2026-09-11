import type { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import type { Webview } from "@tauri-apps/api/webview";
import { tauriBackendAvailable } from "./secrets";

/**
 * Research side panel ("bucket sideview"): Cmd+T docks a second OS
 * webview on the right of the same Tauri window for external lookup
 * pages. Exactly one tab is ever open; the engine switcher navigates
 * that same webview. Outside the Tauri shell (plain `vite dev`,
 * Vitest) there is no webview host, so the bridge reports false and
 * the page renders a DOM fallback strip instead of crashing.
 *
 * Pure helpers (engines, URL gate, toggle, layout) are unit-tested;
 * the `*Sideview` bridge below runs only inside the desktop shell —
 * shell-creation/resize behavior is NOT covered by automated tests
 * (unverified in the Tauri shell; exercise Cmd+T there by hand).
 */

/** Webview label for the single research tab. */
export const SIDE_VIEW_LABEL = "research-sideview";

/** Dock width in logical px on desktop-width windows. */
export const SIDE_VIEW_DOCK_WIDTH = 420;

/** Below this viewport width the panel overlays instead of splitting. */
export const SIDE_VIEW_OVERLAY_BELOW = 640;

export type SideviewEngineId = "google" | "bing";

export interface SideviewEngine {
	id: SideviewEngineId;
	/** Short label for the switcher. */
	name: string;
	/** Lookup home page (the single tab's URL). */
	url: string;
}

/**
 * Lookup engines. Google Translate is the default; Bing Translator is
 * the friendlier fallback — Translate sometimes bot-blocks embedded
 * contexts, which is why the switcher exists at all.
 */
export const SIDE_VIEW_ENGINES: SideviewEngine[] = [
	{ id: "google", name: "Google Translate", url: "https://translate.google.com/" },
	{ id: "bing", name: "Bing Translator", url: "https://www.bing.com/translator" }
];

/** Engine by id; unknown ids fall back to the default (Google). */
export function sideviewEngine(id: string): SideviewEngine {
	return SIDE_VIEW_ENGINES.find((engine) => engine.id === id) ?? SIDE_VIEW_ENGINES[0]!;
}

/**
 * URL gate for the research tab: only remote http(s) pages may load.
 * Rejects javascript:/data:/file:/blob: and unparseable input so a
 * bad engine URL can never script or file-read through the panel.
 */
export function isSideviewUrlAllowed(raw: string): boolean {
	try {
		const parsed = new URL(raw.trim());
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

/** Next open state for the toggle (Cmd+T, Esc, button all share it). */
export function toggleSideviewOpen(open: boolean): boolean {
	return !open;
}

export interface SideviewBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface SideviewLayout {
	main: SideviewBounds;
	side: SideviewBounds;
	/** True when the panel overlays (small viewport) instead of splitting. */
	overlay: boolean;
}

/**
 * Dock geometry in logical px (= CSS px). Wide windows split: the
 * main webview keeps the left, the panel docks right at
 * `SIDE_VIEW_DOCK_WIDTH`. Narrow windows overlay full-viewport so the
 * main view is never squeezed to zero. Never emits negative sizes.
 */
export function sideviewLayout(
	viewportWidth: number,
	viewportHeight: number,
	dockWidth = SIDE_VIEW_DOCK_WIDTH
): SideviewLayout {
	const width = Math.max(0, Math.floor(viewportWidth));
	const height = Math.max(0, Math.floor(viewportHeight));
	if (width < SIDE_VIEW_OVERLAY_BELOW) {
		const full: SideviewBounds = { x: 0, y: 0, width, height };
		return { main: full, side: { ...full }, overlay: true };
	}
	const sideWidth = Math.min(dockWidth, Math.max(280, width - 320));
	const mainWidth = Math.max(0, width - sideWidth);
	return {
		main: { x: 0, y: 0, width: mainWidth, height },
		side: { x: mainWidth, y: 0, width: sideWidth, height },
		overlay: false
	};
}

/**
 * Narrow handle to the single research tab (shell-only; the dynamic
 * imports below carry the real types, so no casts are needed).
 */
type SideviewHandle = Pick<Webview, "close" | "hide" | "setPosition" | "setSize" | "show">;

/** Cached handle to the single research tab (null until created). */
let sideviewRef: SideviewHandle | null = null;

async function bridge(): Promise<{
	Webview: typeof Webview;
	getCurrentWebview: () => SideviewHandle;
	getCurrentWindow: () => Webview["window"];
	LogicalPosition: typeof LogicalPosition;
	LogicalSize: typeof LogicalSize;
} | null> {
	if (!tauriBackendAvailable()) return null;
	try {
		const webview = await import("@tauri-apps/api/webview");
		const windowApi = await import("@tauri-apps/api/window");
		const dpi = await import("@tauri-apps/api/dpi");
		return {
			Webview: webview.Webview,
			getCurrentWebview: webview.getCurrentWebview,
			getCurrentWindow: windowApi.getCurrentWindow,
			LogicalPosition: dpi.LogicalPosition,
			LogicalSize: dpi.LogicalSize
		};
	} catch {
		return null;
	}
}

/**
 * Open (or reveal) the single research tab and dock it beside the
 * main webview. False outside the shell or when the shell refuses —
 * callers fall back to the DOM strip. Never throws.
 */
export async function openSideview(url: string, layout: SideviewLayout): Promise<boolean> {
	const api = await bridge();
	if (!api || !isSideviewUrlAllowed(url)) return false;
	try {
		const existing = sideviewRef ?? (await api.Webview.getByLabel(SIDE_VIEW_LABEL));
		if (existing) {
			sideviewRef = existing;
			await existing.setPosition(new api.LogicalPosition(layout.side.x, layout.side.y));
			await existing.setSize(new api.LogicalSize(layout.side.width, layout.side.height));
			await existing.show();
		} else {
			sideviewRef = new api.Webview(api.getCurrentWindow(), SIDE_VIEW_LABEL, {
				url,
				x: layout.side.x,
				y: layout.side.y,
				width: layout.side.width,
				height: layout.side.height
			});
		}
		const main = api.getCurrentWebview();
		await main.setPosition(new api.LogicalPosition(layout.main.x, layout.main.y));
		await main.setSize(new api.LogicalSize(layout.main.width, layout.main.height));
		return true;
	} catch {
		return false;
	}
}

/**
 * Engine switch: the JS Webview API exposes no navigate, so the
 * single tab is recreated at the new URL (still exactly one tab).
 * False when the shell refuses; never throws.
 */
export async function navigateSideview(url: string, layout: SideviewLayout): Promise<boolean> {
	const api = await bridge();
	if (!api || !isSideviewUrlAllowed(url)) return false;
	try {
		const existing = sideviewRef ?? (await api.Webview.getByLabel(SIDE_VIEW_LABEL));
		if (existing) {
			try {
				await existing.close();
			} catch {
				// Already gone; recreate below.
			}
		}
		sideviewRef = new api.Webview(api.getCurrentWindow(), SIDE_VIEW_LABEL, {
			url,
			x: layout.side.x,
			y: layout.side.y,
			width: layout.side.width,
			height: layout.side.height
		});
		return true;
	} catch {
		sideviewRef = null;
		return false;
	}
}

/** Re-dock both webviews after a window resize. Never throws. */
export async function layoutSideviewViews(layout: SideviewLayout): Promise<void> {
	const api = await bridge();
	if (!api) return;
	try {
		if (sideviewRef) {
			await sideviewRef.setPosition(new api.LogicalPosition(layout.side.x, layout.side.y));
			await sideviewRef.setSize(new api.LogicalSize(layout.side.width, layout.side.height));
		}
		const main = api.getCurrentWebview();
		await main.setPosition(new api.LogicalPosition(layout.main.x, layout.main.y));
		await main.setSize(new api.LogicalSize(layout.main.width, layout.main.height));
	} catch {
		// Transient mid-resize failure: the next resize re-applies.
	}
}

/**
 * Hide the tab and restore the main webview to full-window. The tab
 * keeps its page (reopen is instant). Never throws.
 */
export async function hideSideview(fullWidth: number, fullHeight: number): Promise<void> {
	const api = await bridge();
	if (!api) return;
	try {
		if (sideviewRef) await sideviewRef.hide();
		const main = api.getCurrentWebview();
		await main.setPosition(new api.LogicalPosition(0, 0));
		await main.setSize(new api.LogicalSize(Math.max(0, fullWidth), Math.max(0, fullHeight)));
	} catch {
		// Best effort; reopen re-applies the dock.
	}
}

