// Update routing: the Tauri auto-updater is desktop-only, so on Android
// "check for updates" means opening the latest release page for the newest
// APK (/releases/latest redirects to the newest tagged release, not the
// list the app was installed from), and on the web build (no Tauri shell
// at all) there is nothing to check — a redeploy updates the site, so the
// updater stays disabled.
export const RELEASES_URL =
	"https://github.com/chris-straka/personalized-llm-client/releases/latest";

export type UpdateRoute = { kind: "updater" } | { kind: "releases"; url: string } | { kind: "none" };

export function updateRouteFor(androidUI: boolean, inShell = true): UpdateRoute {
	if (androidUI) return { kind: "releases", url: RELEASES_URL };
	if (!inShell) return { kind: "none" };
	return { kind: "updater" };
}
