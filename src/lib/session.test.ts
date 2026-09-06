import { describe, it, expect } from "vitest";
import { ejectProvider, restoreProvider, isEjected, resetSession } from "./session";
import { maskKey } from "./settings";

describe("session ejection", () => {
	it("ejects for the session and restores", () => {
		resetSession();
		expect(isEjected("muse")).toBe(false);
		ejectProvider("muse");
		expect(isEjected("muse")).toBe(true);
		restoreProvider("muse");
		expect(isEjected("muse")).toBe(false);
	});
});

describe("maskKey", () => {
	it("hides all but the last 4 characters", () => {
		expect(maskKey("")).toBe("");
		expect(maskKey("short")).toBe("••••");
		expect(maskKey("sk-abcdefghij")).toBe("••••ghij");
	});
});

