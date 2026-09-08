import type {
	ChatMessage,
	ChatProvider,
	ContentPart,
	TokenUsage
} from "./providers/types";
import type { Attachment } from "./attachments";
import type { KeyValueStore } from "./settings";
import { memoryStore } from "./settings";

/**
 * Opaque identifiers: still plain strings at runtime (comparisons,
 * template slots, and Map/Record keys all keep working), but a chat id
 * can never be passed where a message id is expected. The compiler, not
 * discipline, catches the swap.
 */
export type ChatId = string & { readonly kind: "chat" };
export type ChatMsgId = string & { readonly kind: "message" };

/**
 * A collapsed pasted span inside a user message: UTF-16 offsets into
 * `content` as sent. Display-only — the API always sees full content.
 */
export interface PasteFold {
	start: number;
	end: number;
	chars: number;
	/** True once the user unfolded it (persisted). Default: folded. */
	open?: boolean;
}

export interface ChatMsg {
	id: ChatMsgId;
	role: "user" | "assistant";
	content: string;
	usage: TokenUsage | null;
	/** Set when the assistant reply failed; the message is retryable. */
	error: string | null;
	/** Files/images sent with a user message (persisted with history). */
	attachments?: Attachment[];
	/** Collapsed pastes, captured at send time (persisted with history). */
	pasteFolds?: PasteFold[];
}

export interface Chat {
	id: ChatId;
	createdAt: number;
	messages: ChatMsg[];
	/** Reply-language pill code for this chat only (null = off). */
	replyLang: string | null;
}

/**
 * Plain-object chat state. The UI holds this in `$state` (runes proxy plain
 * objects reliably); every function below mutates it in place so updates
 * always notify. All logic is UI-agnostic and unit-tested.
 */
export interface ChatState {
	chats: Chat[];
	activeChatId: ChatId;
	sending: boolean;
}

const STORAGE_KEY = "ccez-studio-chats-v1";

export function newChatId(): ChatId {
	return crypto.randomUUID() as ChatId;
}

export function newChatMsgId(): ChatMsgId {
	return crypto.randomUUID() as ChatMsgId;
}

function blankChat(): Chat {
	return { id: newChatId(), createdAt: Date.now(), messages: [], replyLang: null };
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
	const state: ChatState = { chats: [], activeChatId: "" as ChatId, sending: false };
	loadChats(state, store ?? browserStore() ?? memoryStore);
	if (state.chats.length === 0) {
		const chat = blankChat();
		state.chats = [chat];
		state.activeChatId = chat.id;
	}
	if (!state.chats.some((c) => c.id === state.activeChatId)) {
		// Land on the newest chat (last), as before — only the order
		// flipped, not the destination.
		const last = state.chats[state.chats.length - 1];
		if (!last) {
			const chat = blankChat();
			state.chats = [chat];
			state.activeChatId = chat.id;
		} else {
			state.activeChatId = last.id;
		}
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
	// Newest at the bottom, next to the add button — never prepend.
	state.chats = [...state.chats, chat];
	state.activeChatId = chat.id;
	persistChats(state, store);
}

export function selectChat(state: ChatState, id: ChatId): void {
	if (state.chats.some((c) => c.id === id)) state.activeChatId = id;
}

/**
 * Fold/unfold one pasted span, replacing the message object (never
 * mutating in place — proxy signals need the swap). No-op on bad ids.
 * Persists like siblings.
 */
export function setPasteFold(
	state: ChatState,
	msgId: ChatMsgId,
	index: number,
	open: boolean,
	store?: KeyValueStore
): void {
	for (const chat of state.chats) {
		const at = chat.messages.findIndex((m) => m.id === msgId);
		if (at < 0) continue;
		const msg = chat.messages[at];
		const folds = msg?.pasteFolds;
		if (!msg || !folds || index < 0 || index >= folds.length) return;
		const fold = folds[index];
		if (!fold) return;
		chat.messages = [
			...chat.messages.slice(0, at),
			{
				...msg,
				pasteFolds: [...folds.slice(0, index), { ...fold, open }, ...folds.slice(index + 1)]
			},
			...chat.messages.slice(at + 1)
		];
		persistChats(state, store);
		return;
	}
}

/** Set (or clear) one chat's reply-language pill. Persists like siblings. */
export function setChatReplyLang(
	state: ChatState,
	id: ChatId,
	code: string | null,
	store?: KeyValueStore
): void {
	const target = state.chats.find((c) => c.id === id);
	if (!target) return;
	target.replyLang = code;
	persistChats(state, store);
}

/** Abort controller for the in-flight send, if any (see abortSend). */
let inflight: AbortController | null = null;

/**
 * Abort the in-flight send, if any. Dropping a chat mid-stream must kill
 * its network request too — otherwise `sending` strands "Thinking..." on
 * whatever chat replaces it.
 */
export function abortSend(): void {
	inflight?.abort();
	inflight = null;
}

export function deleteChat(state: ChatState, id: ChatId, store?: KeyValueStore): void {
	abortSend();
	const at = state.chats.findIndex((c) => c.id === id);
	state.chats = state.chats.filter((c) => c.id !== id);
	if (state.chats.length === 0) state.chats = [blankChat()];
	if (!state.chats.some((c) => c.id === state.activeChatId)) {
		// Land on the chat that slid into the deleted one's place (the
		// one right below it), or the new bottom one if it was last.
		const target = state.chats[Math.min(Math.max(at, 0), state.chats.length - 1)];
		if (target) state.activeChatId = target.id;
	}
	persistChats(state, store);
}

export function deleteAllChats(state: ChatState, store?: KeyValueStore): void {
	abortSend();
	const chat = blankChat();
	state.chats = [chat];
	state.activeChatId = chat.id;
	persistChats(state, store);
}

export function deleteMessage(state: ChatState, index: number, store?: KeyValueStore): void {
	const chat = activeChat(state);
	// Removing the streaming placeholder mid-flight strands it the same
	// way dropping the chat does — kill the send with it.
	const target = chat.messages[index];
	if (state.sending && target?.role === "assistant" && index === chat.messages.length - 1) {
		abortSend();
	}
	chat.messages = chat.messages.filter((_, i) => i !== index);
	persistChats(state, store);
}

/**
 * Stage the draft as the most recent message (⌥+Enter) without sending.
 * The model never sees it until the next submit carries the full history.
 */
export function stageMessage(
	state: ChatState,
	text: string,
	attachments: Attachment[] = [],
	store?: KeyValueStore
): void {
	const trimmed = text.trim();
	if (!trimmed && attachments.length === 0) return;
	const chat = activeChat(state);
	chat.messages = [
		...chat.messages,
		{
			id: newChatMsgId(),
			role: "user",
			content: trimmed,
			usage: null,
			error: null,
			...(attachments.length > 0 ? { attachments } : {})
		}
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
			.map((m) => ({ ...m, id: newChatMsgId(), error: null }))
	};
	state.chats = [...state.chats, fork];
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
	if (chat.messages[index]?.role !== "user") return;
	chat.messages = chat.messages.slice(0, index + 1);
	persistChats(state, store);
}

/**
 * Edit-and-resend from any user message: delete it and everything after
 * it, so its text can go back into the composer for a corrected send.
 * Out-of-range indices and non-user targets are no-ops.
 */
export function takeBackMessage(state: ChatState, index: number, store?: KeyValueStore): void {
	const chat = activeChat(state);
	if (index < 0 || index >= chat.messages.length) return;
	if (chat.messages[index]?.role !== "user") return;
	chat.messages = chat.messages.slice(0, index);
	persistChats(state, store);
}

/** Resend the last user message (used after dismissing a failed reply or taking one back). */
export async function resendLast(
	state: ChatState,
	provider: ChatProvider,
	systemPrompt: string,
	opts: { store?: KeyValueStore | undefined; thinking?: string | undefined } = {}
): Promise<void> {
	const chat = activeChat(state);
	const last = chat.messages[chat.messages.length - 1];
	if (!last || last.role !== "user" || state.sending) return;
	chat.messages = chat.messages.slice(0, -1);
	await sendMessage(
		state,
		provider,
		systemPrompt,
		last.content,
		{ attachments: last.attachments, thinking: opts.thinking },
		opts.store
	);
}

export function tokenTotal(state: ChatState, chat?: Chat): number {
	const target = chat ?? activeChat(state);
	return target.messages.reduce((sum, m) => sum + (m.usage?.total ?? 0), 0);
}

/** Per-chat input/output split, summed from each message's reported usage. */
export function tokenSplit(state: ChatState, chat?: Chat): { prompt: number; completion: number } {
	const target = chat ?? activeChat(state);
	let prompt = 0;
	let completion = 0;
	for (const m of target.messages) {
		prompt += m.usage?.prompt ?? 0;
		completion += m.usage?.completion ?? 0;
	}
	return { prompt, completion };
}

/**
 * Compact token count: full digits under 1000, then K/M/B with at most one
 * decimal (100+ drops the fraction; anything rounding to 1000 rolls up to
 * the next unit) so the header counter holds its width.
 */
export function formatTokens(n: number): string {
	const count = Math.max(0, Math.floor(n));
	if (count < 1000) return String(count);
	let divisor = count < 1_000_000 ? 1_000 : count < 1_000_000_000 ? 1_000_000 : 1_000_000_000;
	const suffix = (): string =>
		divisor === 1_000 ? "K" : divisor === 1_000_000 ? "M" : "B";
	const text = (): string => {
		const rounded = Math.round((count / divisor) * 10) / 10;
		return rounded >= 100 ? String(Math.round(rounded)) : String(rounded);
	};
	// Anything formatting as "1000" rolls up one unit (exact string check —
	// no float-threshold gambling). Terminates: B never rolls up.
	if (text() === "1000" && divisor < 1_000_000_000) divisor *= 1000;
	return text() + suffix();
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

/**
 * Menu label for a waypoint jump target: the message's first line,
 * whitespace-collapsed and capped (may be empty for blank messages —
 * callers fall back).
 */
export function waypointLabel(content: string, max = 60): string {
	return content.replace(/\s+/g, " ").trim().slice(0, max);
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
		// The filter above already required dataUrl; re-check so a future
		// edit to it can't smuggle null into the API payload.
		if (!image.dataUrl) continue;
		parts.push({ type: "image_url", image_url: { url: image.dataUrl } });
	}
	return parts;
}

export async function sendMessage(
	state: ChatState,
	provider: ChatProvider,
	systemPrompt: string,
	text: string,
	opts: {
		signal?: AbortSignal | undefined;
		attachments?: Attachment[] | undefined;
		thinking?: string | undefined;
		pasteFolds?: PasteFold[] | undefined;
	} = {},
	store?: KeyValueStore
): Promise<void> {
	const trimmed = text.trim();
	const attachments = opts.attachments ?? [];
	const pasteFolds = opts.pasteFolds ?? [];
	if ((!trimmed && attachments.length === 0) || state.sending) return;
	const chat = activeChat(state);
	chat.messages = [
		...chat.messages,
		{
			id: newChatMsgId(),
			role: "user",
			content: trimmed,
			usage: null,
			error: null,
			...(attachments.length > 0 ? { attachments } : {}),
			...(pasteFolds.length > 0 ? { pasteFolds } : {})
		}
	];
	persistChats(state, store);

	const apiMessages = buildApiMessages(chat, systemPrompt);
	const replyId = newChatMsgId();
	chat.messages = [
		...chat.messages,
		{ id: replyId, role: "assistant", content: "", usage: null, error: null }
	];
	state.sending = true;
	// Own controller (chained off a caller-provided signal, if any) so
	// dropping the chat can abort the network request, not just orphan it.
	const controller = new AbortController();
	inflight = controller;
	if (opts.signal?.aborted) controller.abort();
	else opts.signal?.addEventListener("abort", () => controller.abort(), { once: true });
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
		}, { signal: controller.signal, thinking: opts.thinking });
		replaceReply({ content: result.content, usage: result.usage });
	} catch (error) {
		replaceReply({
			content: streamed,
			error: error instanceof Error ? error.message : String(error)
		});
	} finally {
		if (inflight === controller) inflight = null;
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
					// Reply languages are per-session: a restart opens
					// with no pill on any chat (and backfills old saves).
					c.replyLang = null;
					return c;
				});
			if (state.chats.length > 0) {
				const first = state.chats[0];
				if (first) state.activeChatId = first.id;
			}
		}
	} catch {
		// Corrupt storage starts fresh.
	}
}
