import { describe, it, expect } from "vitest";
import { getProviderDef, listProviders, createProvider } from "./registry";

const custom = [
	{
		id: "custom-kimi",
		label: "Kimi",
		defaultBaseUrl: "https://api.moonshot.ai/v1",
		defaultModel: "moonshot-v1",
		keyHint: "API key"
	}
];

describe("registry", () => {
	it("lists built-ins plus customs, rejects unknowns", () => {
		expect(listProviders(custom).map((p) => p.id)).toEqual(["muse", "deepseek", "custom-kimi"]);
		expect(getProviderDef("custom-kimi", custom).label).toBe("Kimi");
		expect(getProviderDef("muse", custom).label).toBe("Muse Spark 1.3");
		expect(() => getProviderDef("nope", custom)).toThrow("Unknown provider");
		expect(
			createProvider("custom-kimi", { baseUrl: "https://x", apiKey: "k", model: "m" }, custom)
		).toBeTruthy();
	});
});
