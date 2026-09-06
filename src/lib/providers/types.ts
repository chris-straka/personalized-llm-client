export interface TextPart {
	type: "text";
	text: string;
}

export interface ImagePart {
	type: "image_url";
	image_url: { url: string };
}

export type ContentPart = TextPart | ImagePart;

export interface ChatMessage {
	role: "system" | "user" | "assistant";
	content: string | ContentPart[];
}

/** Plain-text view of a message, skipping image parts. */
export function messageText(content: string | ContentPart[]): string {
	if (typeof content === "string") return content;
	return content
		.filter((p): p is TextPart => p.type === "text")
		.map((p) => p.text)
		.join("\n");
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
