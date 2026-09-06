import { describe, it, expect } from "vitest";
import {
	createChatState,
	activeChat,
	newChat,
	selectChat,
	deleteChat,
	deleteAllChats,
	deleteMessage,
	pinMessage,
	unpinMessage,
	branchFrom,
	truncateToMessage,
	dismissFailedAssistant,
	takeBackLastReply,
	resendLast,
	tokenTotal,
	waypoints,
	sendMessage,
	buildApiMessages,
	type ChatState
} from "./chat";
import type { ChatProvider, ChatResult } from "./providers/types";
import { MockProvider } from "./providers/mock";

function freshStore() {
	return {
		data: new Map<string, string>(),
		getItem(k: string) {
			return this.data.get(k) ?? null;
		},
		setItem(k: string, v: string) {
			void this.data.set(k, v);
		}
	};
}

type Store = ReturnType<typeof freshStore>;

function stateWith(store: Store): { state: ChatState; store: Store } {
	return { state: createChatState(store), store };
}

function scriptedProvider(script: string[], usage = { prompt: 1, completion: 1, total: 2 }): ChatProvider {
	return {
		id: "scripted",
		async chat(): Promise<ChatResult> {
			return { content: script.join(""), usage };
		},
		async stream(_messages, callbacks): Promise<ChatResult> {
			for (const token of script) callbacks.onToken(token);
			return { content: script.join(""), usage };
		}
	};
}

describe("chat", () => {
	it("streams a reply, records usage, and totals tokens", async () => {
		const { state, store } = stateWith(freshStore());
		await sendMessage(state, scriptedProvider(["hel", "lo"]), "sys", "hi", {}, store);
		const chat = activeChat(state);
		expect(chat.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(chat.messages[1].content).toBe("hello");
		expect(chat.messages[1].usage?.total).toBe(2);
		expect(tokenTotal(state)).toBe(2);
		expect(state.sending).toBe(false);
	});

	it("marks failed replies retryable and keeps the prompt", async () => {
		const failing: ChatProvider = {
			id: "failing",
			async chat(): Promise<ChatResult> {
				throw new Error("bad key");
			},
			async stream(): Promise<ChatResult> {
				throw new Error("bad key");
			}
		};
		const { state, store } = stateWith(freshStore());
		await sendMessage(state, failing, "sys", "hi", {}, store);
		const chat = activeChat(state);
		const last = chat.messages[chat.messages.length - 1];
		expect(last.error).toBe("bad key");
		expect(last.content).toBe("");

		dismissFailedAssistant(state, store);
		expect(activeChat(state).messages.map((m) => m.role)).toEqual(["user"]);
		await sendMessage(state, scriptedProvider(["ok"]), "sys", "again", {}, store);
		expect(activeChat(state).messages).toHaveLength(3);
	});

	it("resends the last prompt after a failure or a take-back", async () => {
		let calls = 0;
		const flaky: ChatProvider = {
			id: "flaky",
			async chat(): Promise<ChatResult> {
				return { content: "x", usage: null };
			},
			async stream(_m, cb): Promise<ChatResult> {
				calls++;
				if (calls === 1) throw new Error("boom");
				cb.onToken("recovered");
				return { content: "recovered", usage: null };
			}
		};
		const { state, store } = stateWith(freshStore());
		await sendMessage(state, flaky, "sys", "q", {}, store);
		expect(activeChat(state).messages).toHaveLength(2);
		dismissFailedAssistant(state, store);
		await resendLast(state, flaky, "sys", store);
		expect(activeChat(state).messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(activeChat(state).messages[1].content).toBe("recovered");

		takeBackLastReply(state, store);
		await resendLast(state, flaky, "sys", store);
		expect(activeChat(state).messages).toHaveLength(2);
	});

	it("reruns from any user message, deleting everything after it", async () => {
		const { state, store } = stateWith(freshStore());
		const provider = scriptedProvider(["r"]);
		await sendMessage(state, provider, "sys", "one", {}, store);
		await sendMessage(state, provider, "sys", "two", {}, store);
		expect(activeChat(state).messages).toHaveLength(4);

		truncateToMessage(state, 0, store);
		expect(activeChat(state).messages.map((m) => m.content)).toEqual(["one"]);
		await resendLast(state, provider, "sys", store);
		expect(activeChat(state).messages.map((m) => m.role)).toEqual(["user", "assistant"]);

		// Non-user targets and out-of-range indices are no-ops.
		truncateToMessage(state, 1, store);
		expect(activeChat(state).messages).toHaveLength(2);
		truncateToMessage(state, 99, store);
		expect(activeChat(state).messages).toHaveLength(2);
	});

	it("reruns by dropping the last reply, branches fork history", async () => {
		const { state, store } = stateWith(freshStore());
		const provider = scriptedProvider(["a"]);
		await sendMessage(state, provider, "sys", "one", {}, store);
		takeBackLastReply(state, store);
		expect(activeChat(state).messages.map((m) => m.role)).toEqual(["user"]);

		await sendMessage(state, provider, "sys", "two", {}, store);
		expect(state.chats).toHaveLength(1);
		branchFrom(state, 0, store);
		expect(state.chats).toHaveLength(2);
		expect(activeChat(state).messages).toHaveLength(1);
		expect(activeChat(state).messages[0].content).toBe("one");
	});

	it("pins ride along only when requested", async () => {
		const seen: unknown[] = [];
		const spy: ChatProvider = {
			id: "spy",
			async chat(m): Promise<ChatResult> {
				seen.push(m);
				return { content: "r", usage: null };
			},
			async stream(m, cb): Promise<ChatResult> {
				seen.push(m);
				cb.onToken("r");
				return { content: "r", usage: null };
			}
		};
		const { state, store } = stateWith(freshStore());
		pinMessage(state, "remember this", store);
		await sendMessage(state, spy, "sys", "q", {}, store);
		const plain = seen[0] as Array<{ content: string }>;
		expect(plain.map((m) => m.content)).toEqual(["sys", "q"]);

		takeBackLastReply(state, store);
		await sendMessage(state, spy, "sys", "q2", { includePins: true }, store);
		const pinned = seen[1] as Array<{ content: string }>;
		expect(pinned.map((m) => m.content)).toEqual(["sys", "remember this", "q", "q2"]);

		unpinMessage(state, 0, store);
		expect(activeChat(state).pins).toEqual([]);
	});

	it("creates, selects, and deletes chats without stranding the selection", () => {
		const { state, store } = stateWith(freshStore());
		const first = state.activeChatId;
		newChat(state, store);
		expect(state.chats).toHaveLength(2);
		selectChat(state, first);
		expect(state.activeChatId).toBe(first);
		deleteChat(state, first, store);
		expect(state.activeChatId).not.toBe(first);
		deleteAllChats(state, store);
		expect(state.chats).toHaveLength(1);
		expect(activeChat(state).messages).toEqual([]);
	});

	it("deletes a single message by index", async () => {
		const { state, store } = stateWith(freshStore());
		await sendMessage(state, scriptedProvider(["r"]), "sys", "one", {}, store);
		deleteMessage(state, 0, store);
		expect(activeChat(state).messages.map((m) => m.role)).toEqual(["assistant"]);
	});

	it("exposes user-turn waypoints", async () => {
		const { state, store } = stateWith(freshStore());
		const provider = scriptedProvider(["r"]);
		await sendMessage(state, provider, "sys", "one", {}, store);
		await sendMessage(state, provider, "sys", "two", {}, store);
		expect(waypoints(state)).toEqual([0, 2]);
	});

	it("persists across instances and tolerates corruption", async () => {
		const store = freshStore();
		const first = createChatState(store);
		await sendMessage(first, scriptedProvider(["hi"]), "sys", "hello", {}, store);
		const again = createChatState(store);
		expect(activeChat(again).messages).toHaveLength(2);

		store.setItem("ccez-studio-chats-v1", "garbage{");
		const fresh = createChatState(store);
		expect(activeChat(fresh).messages).toEqual([]);
	});

	it("mock provider streams a canned reply", async () => {
		const { state, store } = stateWith(freshStore());
		await sendMessage(state, new MockProvider(), "sys", "ping", {}, store);
		expect(activeChat(state).messages[1].content).toContain("ping");
	});

	it("sends images as content parts and inlines text files", async () => {
		const { state, store } = stateWith(freshStore());
		const attachments = [
			{
				id: "img",
				name: "pic.jpg",
				mime: "image/jpeg",
				kind: "image",
				dataUrl: "data:image/jpeg;base64,AAA",
				text: null,
				width: 100,
				height: 100,
				tokens: 255
			},
			{
				id: "txt",
				name: "notes.txt",
				mime: "text/plain",
				kind: "text",
				dataUrl: null,
				text: "remember this",
				width: null,
				height: null,
				tokens: 4
			}
		] as const;
		await sendMessage(state, scriptedProvider(["ok"]), "sys", "look", {
			attachments: [...attachments]
		}, store);
		const sent = activeChat(state).messages[0];
		expect(sent.attachments).toHaveLength(2);

		const api = buildApiMessages(activeChat(state), "sys", false);
		const user = api.find((m) => m.role === "user");
		expect(Array.isArray(user?.content)).toBe(true);
		const parts = user?.content as Array<{ type: string }>;
		expect(parts[0]).toEqual({
			type: "text",
			text: "look\n\n```notes.txt\nremember this\n```"
		});
		expect(parts[1]).toEqual({
			type: "image_url",
			image_url: { url: "data:image/jpeg;base64,AAA" }
		});
	});

	it("sends attachment-free messages as plain strings", async () => {
		const { state, store } = stateWith(freshStore());
		await sendMessage(state, scriptedProvider(["ok"]), "sys", "plain", {}, store);
		const api = buildApiMessages(activeChat(state), "sys", false);
		expect(api.find((m) => m.role === "user")?.content).toBe("plain");
	});

	it("carries attachments across resend and branch", async () => {
		const { state, store } = stateWith(freshStore());
		const attachments = [
			{
				id: "t",
				name: "a.txt",
				mime: "text/plain",
				kind: "text",
				dataUrl: null,
				text: "x",
				width: null,
				height: null,
				tokens: 1
			}
		] as const;
		await sendMessage(state, scriptedProvider(["one"]), "sys", "first", {
			attachments: [...attachments]
		}, store);
		await resendLast(state, scriptedProvider(["two"]), "sys", store);
		expect(activeChat(state).messages[0].attachments).toHaveLength(1);

		branchFrom(state, 1, store);
		selectChat(state, state.chats[0].id);
		expect(activeChat(state).messages[0].attachments).toHaveLength(1);
	});
});
