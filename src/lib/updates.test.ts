import { describe, expect, it } from "vitest";
import { RELEASES_URL, updateRouteFor } from "./updates";

describe("updateRouteFor", () => {
	it("routes Android to the releases page", () => {
		expect(updateRouteFor(true)).toEqual({ kind: "releases", url: RELEASES_URL });
	});

	it("routes desktop to the Tauri updater", () => {
		expect(updateRouteFor(false)).toEqual({ kind: "updater" });
	});

	it("points at this repo's releases", () => {
		expect(RELEASES_URL).toBe(
			"https://github.com/chris-straka/personalized-llm-client/releases"
		);
	});
});
