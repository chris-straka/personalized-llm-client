import type {
	ChatMessage,
	ChatProvider,
	ContentPart,
	TokenUsage
} from "./providers/types";
import type { Attachment } from "./attachments";
import type { KeyValueStore } from "./settings";
import { memoryStore } from "./settings";

export interface ChatMsg {
	id: string;
	role: "user" | "assistant";
	content: string;
	usage: TokenUsage | null;
	/** Set when the assistant reply failed; the message is retryable. */
	error: string | null;
	/** Files/images sent with a user message (persisted with history). */
	attachments?: Attachment[];
}

export interface Chat {
	id: string;
	createdAt: number;
	messages: ChatMsg[];
}

/**
 * Plain-object chat state. The UI holds this in `$state` (runes proxy plain
 * objects reliably); every function below mutates it in place so updates
 * always notify. All logic is UI-agnostic and unit-tested.
 */
export interface ChatState {
	chats: Chat[];
	activeChatId: string;
	sending: boolean;
}

const STORAGE_KEY = "ccez-studio-chats-v1";

export function newId(): string {
	return crypto.randomUUID();
}

function blankChat(): Chat {
	return { id: newId(), createdAt: Date.now(), messages: [] };
}

function browserStore(): KeyValueStore | null {
	try {
		if (typeof localStorage === "undefined") return null;
		return localStorage;
	} catch {
		return null;
	}
}

export function createChatState(store?: KeyValueStore): ChatState {
	const state: ChatState = { chats: [], activeChatId: "", sending: false };
	loadChats(state, store ?? browserStore() ?? memoryStore);
	if (state.chats.length === 0) {
		const chat = blankChat();
		state.chats = [chat];
		state.activeChatId = chat.id;
	}
	if (!state.chats.some((c) => c.id === state.activeChatId)) {
		state.activeChatId = state.chats[0].id;
	}
	return state;
}

export function activeChat(state: ChatState): Chat {
	const chat = state.chats.find((c) => c.id === state.activeChatId);
	if (!chat) throw new Error("No active chat");
	return chat;
}

export function newChat(state: ChatState, store?: KeyValueStore): void {
	const chat = blankChat();
	state.chats = [chat, ...state.chats];
	state.activeChatId = chat.id;
	persistChats(state, store);
}

export function selectChat(state: ChatState, id: string): void {
	if (state.chats.some((c) => c.id === id)) state.activeChatId = id;
}

export function deleteChat(state: ChatState, id: string, store?: KeyValueStore): void {
	state.chats = state.chats.filter((c) => c.id !== id);
	if (state.chats.length === 0) state.chats = [blankChat()];
	if (!state.chats.some((c) => c.id === state.activeChatId)) {
		state.activeChatId = state.chats[0].id;
	}
	persistChats(state, store);
}

export function deleteAllChats(state: ChatState, store?: KeyValueStore): void {
	const chat = blankChat();
	state.chats = [chat];
	state.activeChatId = chat.id;
	persistChats(state, store);
}

export function deleteMessage(state: ChatState, index: number, store?: KeyValueStore): void {
	const chat = activeChat(state);
	chat.messages = chat.messages.filter((_, i) => i !== index);
	persistChats(state, store);
}

/**
 * Post the draft as a user message at the very top of the log (⌥+Enter).
 * No reply is triggered — it rides along as history in every later send.
 */
export function postToTop(
	state: ChatState,
	text: string,
	attachments: Attachment[] = [],
	store?: KeyValueStore
): void {
	const trimmed = text.trim();
	if (!trimmed && attachments.length === 0) return;
	const chat = activeChat(state);
	chat.messages = [
		{
			id: newId(),
			role: "user",
			content: trimmed,
			usage: null,
			error: null,
			...(attachments.length > 0 ? { attachments } : {})
		},
		...chat.messages
	];
	persistChats(state, store);
}

/** Copy messages up to `index` (inclusive) into a new chat. */
export function branchFrom(state: ChatState, index: number, store?: KeyValueStore): void {
	const source = activeChat(state);
	const fork: Chat = {
		...blankChat(),
		messages: source.messages
			.slice(0, index + 1)
			.map((m) => ({ ...m, id: newId(), error: null }))
	};
	state.chats = [fork, ...state.chats];
	state.activeChatId = fork.id;
	persistChats(state, store);
}

/** Drop a failed assistant reply so the same prompt can go again. */
export function dismissFailedAssistant(state: ChatState, store?: KeyValueStore): void {
	const chat = activeChat(state);
	const last = chat.messages[chat.messages.length - 1];
	if (last?.role === "assistant" && last.error) {
		chat.messages = chat.messages.slice(0, -1);
		persistChats(state, store);
	}
}

/** Drop the last assistant reply (failed or not) to regenerate it. */
export function takeBackLastReply(state: ChatState, store?: KeyValueStore): void {
	const chat = activeChat(state);
	const last = chat.messages[chat.messages.length - 1];
	if (last?.role === "assistant") {
		chat.messages = chat.messages.slice(0, -1);
		persistChats(state, store);
	}
}

/**
 * Rerun from any user message: delete everything after it (unlike branch,
 * which keeps the original), so the prompt can go again cleanly.
 */
export function truncateToMessage(state: ChatState, index: number, store?: KeyValueStore): void {
	const chat = activeChat(state);
	if (index < 0 || index >= chat.messages.length) return;
	if (chat.messages[index].role !== "user") return;
	chat.messages = chat.messages.slice(0, index + 1);
	persistChats(state, store);
}

/** Resend the last user message (used after dismissing a failed reply or taking one back). */
export async function resendLast(
	state: ChatState,
	provider: ChatProvider,
	systemPrompt: string,
	store?: KeyValueStore
): Promise<void> {
	const chat = activeChat(state);
	const last = chat.messages[chat.messages.length - 1];
	if (!last || last.role !== "user" || state.sending) return;
	chat.messages = chat.messages.slice(0, -1);
	await sendMessage(state, provider, systemPrompt, last.content, { attachments: last.attachments }, store);
}

export function tokenTotal(state: ChatState, chat?: Chat): number {
	const target = chat ?? activeChat(state);
	return target.messages.reduce((sum, m) => sum + (m.usage?.total ?? 0), 0);
}

/** Message indices that start a user turn — the waypoint jump targets. */
export function waypoints(state: ChatState, chat?: Chat): number[] {
	const target = chat ?? activeChat(state);
	const out: number[] = [];
	target.messages.forEach((m, i) => {
		if (m.role === "user") out.push(i);
	});
	return out;
}

export function buildApiMessages(chat: Chat, systemPrompt: string): ChatMessage[] {
	const api: ChatMessage[] = [{ role: "system", content: systemPrompt }];
	for (const m of chat.messages) {
		if (m.role === "assistant" && m.error) continue;
		api.push({ role: m.role, content: apiContent(m) });
	}
	return api;
}

/**
 * User messages with image attachments go out as multimodal content parts;
 * text attachments are appended as fenced blocks so every provider sees them.
 */
export function apiContent(message: ChatMsg): string | ContentPart[] {
	const images = (message.attachments ?? []).filter((a) => a.kind === "image" && a.dataUrl);
	let text = message.content;
	for (const a of message.attachments ?? []) {
		if (a.kind === "text" && a.text !== null) {
			text += `\n\n\`\`\`${a.name}\n${a.text}\n\`\`\``;
		}
	}
	if (images.length === 0) return text;
	const parts: ContentPart[] = [{ type: "text", text }];
	for (const image of images) {
		parts.push({ type: "image_url", image_url: { url: image.dataUrl! } });
	}
	return parts;
}

export async function sendMessage(
	state: ChatState,
	provider: ChatProvider,
	systemPrompt: string,
	text: string,
	opts: { signal?: AbortSignal; attachments?: Attachment[] } = {},
	store?: KeyValueStore
): Promise<void> {
	const trimmed = text.trim();
	const attachments = opts.attachments ?? [];
	if ((!trimmed && attachments.length === 0) || state.sending) return;
	const chat = activeChat(state);
	chat.messages = [
		...chat.messages,
		{
			id: newId(),
			role: "user",
			content: trimmed,
			usage: null,
			error: null,
			...(attachments.length > 0 ? { attachments } : {})
		}
	];
	persistChats(state, store);

	const apiMessages = buildApiMessages(chat, systemPrompt);
	const replyId = newId();
	chat.messages = [
		...chat.messages,
		{ id: replyId, role: "assistant", content: "", usage: null, error: null }
	];
	state.sending = true;
	// NOTE: never mutate a message object in place here. Svelte's proxy
	// signals capture values on first read, so only wholesale replacement
	// notifies reliably. The running text lives in this local accumulator.
	let streamed = "";
	const replaceReply = (patch: Partial<ChatMsg>) => {
		const target = activeChat(state);
		target.messages = target.messages.map((m) =>
			m.id === replyId ? { ...m, ...patch } : m
		);
	};
	try {
		const result = await provider.stream(apiMessages, {
			onToken: (token) => {
				streamed += token;
				replaceReply({ content: streamed });
			}
		}, { signal: opts.signal });
		replaceReply({ content: result.content, usage: result.usage });
	} catch (error) {
		replaceReply({
			content: streamed,
			error: error instanceof Error ? error.message : String(error)
		});
	} finally {
		state.sending = false;
		persistChats(state, store);
	}
}

function persistChats(state: ChatState, store?: KeyValueStore): void {
	try {
		(store ?? browserStore() ?? memoryStore).setItem(
			STORAGE_KEY,
			JSON.stringify(state.chats)
		);
	} catch {
		// Storage full or unavailable — chat still works in memory.
	}
}

function loadChats(state: ChatState, store: KeyValueStore): void {
	let raw: string | null;
	try {
		raw = store.getItem(STORAGE_KEY);
	} catch {
		return;
	}
	if (!raw) return;
	try {
		const parsed = JSON.parse(raw) as Array<Chat & { pins?: unknown }>;
		if (Array.isArray(parsed)) {
			state.chats = parsed
				.filter((c) => c && typeof c.id === "string")
				.map((c) => {
					// The old pins array is gone; top-posted messages replaced it.
					delete c.pins;
					return c;
				});
			if (state.chats.length > 0) state.activeChatId = state.chats[0].id;
		}
	} catch {
		// Corrupt storage starts fresh.
	}
}
