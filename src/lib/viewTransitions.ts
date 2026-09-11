/**
 * View Transitions for chat switching.
 *
 * Wraps the chat-switch state mutation in `document.startViewTransition`
 * where supported so the outgoing/incoming chat cross-fade instead of
 * cutting. Where unsupported the mutation runs synchronously (instant
 * cut) — identical end state, no animation.
 */

/** True when the View Transitions API is available. */
export function viewTransitionsSupported(): boolean {
	try {
		return (
			typeof document !== "undefined" &&
			typeof (document as Document & { startViewTransition?: unknown }).startViewTransition ===
				"function"
		);
	} catch {
		return false;
	}
}

/**
 * Run a chat-switch mutation inside a view transition where supported,
 * otherwise synchronously. Resolves after the transition's update
 * callback has run. Never rejects: a failing transition falls back to
 * running the mutation directly.
 */
export async function switchChatWithTransition(mutate: () => void): Promise<void> {
	const doc = (
		typeof document !== "undefined" ? document : undefined
	) as (Document & { startViewTransition?: (opts: { update: () => void }) => { finished: Promise<void> } }) | undefined;
	if (doc && typeof doc.startViewTransition === "function") {
		try {
			const transition = doc.startViewTransition({ update: mutate });
			await transition.finished.catch(() => {});
			return;
		} catch {
			// Fall through to the instant cut below.
		}
	}
	mutate();
}
