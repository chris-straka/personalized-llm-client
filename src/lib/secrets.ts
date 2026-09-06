import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "./settings";

/**
 * Secret storage (Stage 7). Inside the Tauri shell, API keys live in the
 * macOS Keychain behind three Rust commands; everywhere else (browser
 * preview, tests) the same interface falls back to namespaced localStorage
 * so the UI never branches.
 */

const FALLBACK_PREFIX = "ccez-keychain:";

export function secretAccount(providerId: string): string {
	return `provider:${providerId}`;
}

/** True inside the Tauri webview, where the Rust commands exist. */
export function tauriBackendAvailable(): boolean {
	try {
		return (
			typeof window !== "undefined" &&
			"__TAURI__" in window &&
			(window as unknown as { __TAURI__: unknown }).__TAURI__ !== undefined
		);
	} catch {
		return false;
	}
}

function fallbackStore(): Storage | null {
	try {
		if (typeof localStorage === "undefined") return null;
		return localStorage;
	} catch {
		return null;
	}
}

export async function getSecret(account: string): Promise<string | null> {
	if (tauriBackendAvailable()) {
		try {
			return await invoke<string | null>("keychain_get", { account });
		} catch {
			return null;
		}
	}
	return fallbackStore()?.getItem(FALLBACK_PREFIX + account) ?? null;
}

export async function setSecret(account: string, secret: string): Promise<void> {
	if (tauriBackendAvailable()) {
		await invoke("keychain_set", { account, secret });
		return;
	}
	try {
		fallbackStore()?.setItem(FALLBACK_PREFIX + account, secret);
	} catch {
		// Private-mode storage failure: keys stay session-only.
	}
}

export async function deleteSecret(account: string): Promise<void> {
	if (tauriBackendAvailable()) {
		try {
			await invoke("keychain_delete", { account });
		} catch {
			// Already gone or locked; the in-memory key is what matters.
		}
		return;
	}
	try {
		fallbackStore()?.removeItem(FALLBACK_PREFIX + account);
	} catch {
		// Nothing to clean up.
	}
}

/**
 * Fill blank in-memory provider keys from secret storage. Returns the ids
 * that were hydrated (so callers can re-render). Never throws.
 */
export async function hydrateSecrets(settings: AppSettings): Promise<string[]> {
	const hydrated: string[] = [];
	for (const id of Object.keys(settings.providers)) {
		if (settings.providers[id].apiKey.trim()) continue;
		try {
			const secret = await getSecret(secretAccount(id));
			if (secret) {
				settings.providers[id].apiKey = secret;
				hydrated.push(id);
			}
		} catch {
			// Locked keychain or missing entry: user types the key instead.
		}
	}
	return hydrated;
}

/**
 * Mirror non-empty in-memory keys into secret storage. In the Tauri shell
 * the stored settings must then be saved blank (see `withBlankedKeys`);
 * in the browser the settings file keeps working as before.
 */
export async function persistSecrets(settings: AppSettings): Promise<void> {
	for (const id of Object.keys(settings.providers)) {
		const key = settings.providers[id].apiKey.trim();
		if (!key) continue;
		try {
			await setSecret(secretAccount(id), key);
		} catch {
			// Keychain locked: the settings save below still keeps the key.
		}
	}
}

/** Copy of settings with provider keys blanked (Tauri shell persistence). */
export function withBlankedKeys(settings: AppSettings): AppSettings {
	const providers: AppSettings["providers"] = {};
	for (const [id, conf] of Object.entries(settings.providers)) {
		providers[id] = { ...conf, apiKey: "" };
	}
	return { ...settings, providers };
}
