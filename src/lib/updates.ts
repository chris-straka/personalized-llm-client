// Update routing: the Tauri auto-updater is desktop-only, so on Android
// "check for updates" means opening the Releases page for the newest APK.
export const RELEASES_URL =
	"https://github.com/chris-straka/personalized-llm-client/releases";

export type UpdateRoute = { kind: "updater" } | { kind: "releases"; url: string };

export function updateRouteFor(androidUI: boolean): UpdateRoute {
	return androidUI ? { kind: "releases", url: RELEASES_URL } : { kind: "updater" };
}
