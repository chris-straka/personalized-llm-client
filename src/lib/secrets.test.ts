// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
	getSecret,
	setSecret,
	deleteSecret,
	hydrateSecrets,
	persistSecrets,
	withBlankedKeys,
	secretAccount,
	tauriBackendAvailable
} from "./secrets";
import { defaultSettings } from "./settings";

beforeEach(() => {
	localStorage.clear();
});

describe("secrets fallback (no Tauri shell)", () => {
	it("reports no Tauri backend in jsdom", () => {
		expect(tauriBackendAvailable()).toBe(false);
	});

	it("detects the v2 shell global (v1 name kept as fallback)", () => {
		const w = window as unknown as Record<string, unknown>;
		const prevInternals = w.__TAURI_INTERNALS__;
		const prevV1 = w.__TAURI__;
		try {
			w.__TAURI_INTERNALS__ = {};
			expect(tauriBackendAvailable()).toBe(true);
			delete w.__TAURI_INTERNALS__;
			w.__TAURI__ = {};
			expect(tauriBackendAvailable()).toBe(true);
		} finally {
			if (prevInternals === undefined) delete w.__TAURI_INTERNALS__;
			else w.__TAURI_INTERNALS__ = prevInternals;
			if (prevV1 === undefined) delete w.__TAURI__;
			else w.__TAURI__ = prevV1;
		}
		expect(tauriBackendAvailable()).toBe(false);
	});

	it("round-trips secrets through namespaced storage", async () => {
		expect(await getSecret(secretAccount("deepseek"))).toBeNull();
		await setSecret(secretAccount("deepseek"), "sk-test");
		expect(await getSecret(secretAccount("deepseek"))).toBe("sk-test");
		expect(localStorage.getItem("ccez-keychain:provider:deepseek")).toBe("sk-test");
		await deleteSecret(secretAccount("deepseek"));
		expect(await getSecret(secretAccount("deepseek"))).toBeNull();
	});

	it("hydrates blank settings keys from storage", async () => {
		await setSecret(secretAccount("muse"), "muse-test");
		const settings = defaultSettings();
		settings.providers["deepseek"]!.apiKey = "";
		settings.providers["muse"]!.apiKey = "";
		const hydrated = await hydrateSecrets(settings);
		expect(hydrated).toEqual(["muse"]);
		expect(settings.providers["muse"]!.apiKey).toBe("muse-test");
		// Already-filled keys are left alone.
		settings.providers["deepseek"]!.apiKey = "keep";
		await expect(hydrateSecrets(settings)).resolves.toEqual([]);
		expect(settings.providers["deepseek"]!.apiKey).toBe("keep");
	});

	it("persists keys and blanks copies for shell storage", async () => {
		const settings = defaultSettings();
		settings.providers["deepseek"]!.apiKey = "sk-live";
		await persistSecrets(settings);
		expect(await getSecret(secretAccount("deepseek"))).toBe("sk-live");
		const blanked = withBlankedKeys(settings);
		expect(blanked.providers["deepseek"]!.apiKey).toBe("");
		expect(settings.providers["deepseek"]!.apiKey).toBe("sk-live");
	});
});
