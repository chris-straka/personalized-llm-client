import { describe, expect, it } from "vitest";
import { bumpVersion, parseBump, parseSemver } from "./version";

describe("bumpVersion", () => {
	it("bumps patch by default shape", () => {
		expect(bumpVersion("0.1.0", "patch")).toBe("0.1.1");
	});

	it("bumps minor and resets patch", () => {
		expect(bumpVersion("0.1.9", "minor")).toBe("0.2.0");
	});

	it("bumps major and resets minor and patch", () => {
		expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
	});

	it("rejects non-semver input", () => {
		expect(() => bumpVersion("1.2", "patch")).toThrow("non-semver");
	});
});

describe("parseBump", () => {
	it("defaults to patch", () => {
		expect(parseBump([])).toBe("patch");
		expect(parseBump(["--dry-run"])).toBe("patch");
	});

	it("reads --minor and --major", () => {
		expect(parseBump(["--minor"])).toBe("minor");
		expect(parseBump(["--major"])).toBe("major");
	});

	it("rejects both flags", () => {
		expect(() => parseBump(["--major", "--minor"])).toThrow("Pick one");
	});
});

describe("parseSemver", () => {
	it("parses components", () => {
		expect(parseSemver("0.1.0")).toEqual({ major: 0, minor: 1, patch: 0 });
	});
});
