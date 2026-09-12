/**
 * Offline fallback: when the network drops, a cloud chat provider is
 * parked on the on-device Gemma option; reconnecting restores exactly
 * what the drop parked — never a provider the user picked meanwhile.
 * Pure helpers (tested); the event wiring lives in `+page.svelte`.
 */

/** The on-device provider id (see `providers/registry.ts`). */
export const OFFLINE_FALLBACK_ID = "local-gemma";

/** Test seam id: the mock provider never touches the network either. */
const MOCK_ID = "mock";

/** True when the provider needs the network to answer. */
export function needsNetwork(providerId: string): boolean {
	return providerId !== OFFLINE_FALLBACK_ID && providerId !== MOCK_ID;
}

/**
 * Offline moment: the id to switch to, or null when already local
 * (nothing to park).
 */
export function offlineTarget(activeId: string): string | null {
	return needsNetwork(activeId) ? OFFLINE_FALLBACK_ID : null;
}

/**
 * Back online: the id to restore, or null when there is nothing to do —
 * no parked provider, or the user has moved on to something else meanwhile.
 */
export function onlineRestore(parkedFrom: string | null, activeId: string): string | null {
	if (parkedFrom === null) return null;
	if (activeId !== OFFLINE_FALLBACK_ID) return null;
	return parkedFrom;
}
