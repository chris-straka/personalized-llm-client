import type {
	ChatMessage,
	ChatProvider,
	ChatResult,
	StreamCallbacks
} from "./types";
import { messageText } from "./types";

/**
 * Dev/test-only provider: streams a canned reply so the chat UI (streaming
 * display, token meter, retry) can be exercised in a browser without API keys.
 * Enabled in the UI only when localStorage `ccez-mock-provider` is "1".
 */
export class MockProvider implements ChatProvider {
	readonly id = "mock";

	async chat(messages: ChatMessage[]): Promise<ChatResult> {
		return {
			content: canned(messages),
			usage: { prompt: 10, completion: 12, total: 22 }
		};
	}

	async stream(
		messages: ChatMessage[],
		callbacks: StreamCallbacks
	): Promise<ChatResult> {
		const full = canned(messages);
		for (const word of full.split(/(?<=\s)/)) {
			await new Promise((r) => setTimeout(r, 15));
			callbacks.onToken(word);
		}
		return { content: full, usage: { prompt: 10, completion: 12, total: 22 } };
	}
}

function canned(messages: ChatMessage[]): string {
	const last = [...messages].reverse().find((m) => m.role === "user");
	const excerpt = messageText(last?.content ?? "").slice(0, 60);
	return `Mock reply to: ${excerpt || "(empty)"}`;
}

export function mockProviderEnabled(): boolean {
	try {
		return localStorage.getItem("ccez-mock-provider") === "1";
	} catch {
		return false;
	}
}
