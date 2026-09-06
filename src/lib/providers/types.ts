export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface TokenUsage {
	prompt: number;
	completion: number;
	total: number;
	/** Reasoning/thinking tokens, when the API reports them. */
	reasoning?: number;
}

export interface ChatResult {
	content: string;
	usage: TokenUsage | null;
}

export interface StreamCallbacks {
	onToken: (text: string) => void;
}

export interface ChatOptions {
	signal?: AbortSignal;
}

export interface ChatProvider {
	readonly id: string;
	chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;
	stream(
		messages: ChatMessage[],
		callbacks: StreamCallbacks,
		opts?: ChatOptions
	): Promise<ChatResult>;
}

export class ProviderError extends Error {
	readonly status?: number;
	constructor(message: string, status?: number) {
		super(message);
		this.name = "ProviderError";
		this.status = status;
	}
}
