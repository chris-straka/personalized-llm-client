/**
 * Session-scoped provider state. In-memory only, never persisted:
 * ejecting a key unloads it for this session; a reload restores it
 * from saved settings.
 */

const ejected = new Set<string>();

export function ejectProvider(id: string): void {
	ejected.add(id);
}

export function restoreProvider(id: string): void {
	ejected.delete(id);
}

export function isEjected(id: string): boolean {
	return ejected.has(id);
}

/** Test/SSR helper. */
export function resetSession(): void {
	ejected.clear();
}
