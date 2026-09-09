import { describe, it, expect } from "vitest";
import {
	createChatState,
	activeChat,
	newChat,
	selectChat,
	setChatReplyLang,
	deleteChat,
	deleteAllChats,
	deleteMessage,
	stageMessage,
	branchFrom,
	truncateToMessage,
	editMessageContent,
	dismissFailedAssistant,
	takeBackLastReply,
	resendLast,
	tokenTotal,
	tokenSplit,
	formatTokens,
	waypoints,
	waypointLabel,
	sendMessage,
	setPasteFold,
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
		expect(chat.messages[1]?.content).toBe("hello");
		expect(chat.messages[1]?.usage?.total).toBe(2);
		expect(tokenTotal(state)).toBe(2);
		expect(state.sending).toBe(false);
	});

	it("splits tokens into input and output", async () => {
		const { state, store } = stateWith(freshStore());
		await sendMessage(state, scriptedProvider(["hi"], { prompt: 5, completion: 3, total: 8 }), "sys", "hello", {}, store);
		await sendMessage(state, scriptedProvider(["yo"], { prompt: 7, completion: 2, total: 9 }), "sys", "again", {}, store);
		expect(tokenSplit(state)).toEqual({ prompt: 12, completion: 5 });
		expect(tokenTotal(state)).toBe(17);
	});

	it("splits zero tokens on an empty chat", () => {
		const { state } = stateWith(freshStore());
		expect(tokenSplit(state)).toEqual({ prompt: 0, completion: 0 });
	});

	it("compacts token counts with K/M/B suffixes", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(42)).toBe("42");
		expect(formatTokens(999)).toBe("999");
		expect(formatTokens(1000)).toBe("1K");
		expect(formatTokens(1536)).toBe("1.5K");
		expect(formatTokens(10_400)).toBe("10.4K");
		expect(formatTokens(99_999)).toBe("100K");
		expect(formatTokens(999_949)).toBe("1M");
		expect(formatTokens(999_950)).toBe("1M");
		expect(formatTokens(2_500_000)).toBe("2.5M");
		expect(formatTokens(1_000_000_000)).toBe("1B");
		expect(formatTokens(-5)).toBe("0");
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
		expect(last?.error).toBe("bad key");
		expect(last?.content).toBe("");

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
		await resendLast(state, flaky, "sys", { store });
		expect(activeChat(state).messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(activeChat(state).messages[1]?.content).toBe("recovered");

		takeBackLastReply(state, store);
		await resendLast(state, flaky, "sys", { store });
		expect(activeChat(state).messages).toHaveLength(2);
	});

	it("aborts the in-flight send when its chat is dropped", async () => {
		const { state, store } = stateWith(freshStore());
		let aborted = false;
		const hanging: ChatProvider = {
			id: "hang",
			async chat(): Promise<ChatResult> {
				throw new Error("unused");
			},
			stream(_m, _cb, opts): Promise<ChatResult> {
				return new Promise<ChatResult>((_resolve, reject) => {
					opts?.signal?.addEventListener("abort", () => {
						aborted = true;
						reject(new DOMException("aborted", "AbortError"));
					});
				});
			}
		};
		const sending = sendMessage(state, hanging, "sys", "hi", {}, store);
		await new Promise((r) => setTimeout(r, 20));
		expect(state.sending).toBe(true);
		deleteChat(state, state.activeChatId, store);
		await sending;
		expect(aborted).toBe(true);
		expect(state.sending).toBe(false);
		expect(activeChat(state).messages).toHaveLength(0);
	});

	it("reruns from any user message, deleting everything after it", async () => {
		const { state, store } = stateWith(freshStore());
		const provider = scriptedProvider(["r"]);
		await sendMessage(state, provider, "sys", "one", {}, store);
		await sendMessage(state, provider, "sys", "two", {}, store);
		expect(activeChat(state).messages).toHaveLength(4);

		truncateToMessage(state, 0, store);
		expect(activeChat(state).messages.map((m) => m.content)).toEqual(["one"]);
		await resendLast(state, provider, "sys", { store });
		expect(activeChat(state).messages.map((m) => m.role)).toEqual(["user", "assistant"]);

		// Non-user targets and out-of-range indices are no-ops.
		truncateToMessage(state, 1, store);
		expect(activeChat(state).messages).toHaveLength(2);
		truncateToMessage(state, 99, store);
		expect(activeChat(state).messages).toHaveLength(2);
	});

	it("edits an own message in place without touching history", async () => {
		const { state, store } = stateWith(freshStore());
		const provider = scriptedProvider(["r"]);
		await sendMessage(state, provider, "sys", "one", {}, store);
		await sendMessage(state, provider, "sys", "two", {}, store);
		const target = activeChat(state).messages[2];
		if (!target) throw new Error("seed message missing");

		expect(editMessageContent(state, target.id, "TWO!", {}, store)).toBe(true);
		expect(activeChat(state).messages.map((m) => m.content)).toEqual(["one", "r", "TWO!", "r"]);

		// Unknown ids and non-user targets are no-ops.
		expect(editMessageContent(state, "nope" as never, "x", {}, store)).toBe(false);
		const reply = activeChat(state).messages[3];
		if (!reply) throw new Error("seed reply missing");
		expect(editMessageContent(state, reply.id, "x", {}, store)).toBe(false);
		expect(activeChat(state).messages.map((m) => m.content)).toEqual(["one", "r", "TWO!", "r"]);
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
		expect(activeChat(state).messages[0]?.content).toBe("one");
	});

	it("stages messages last without sending, in order", async () => {
		const { state, store } = stateWith(freshStore());
		await sendMessage(state, scriptedProvider(["r"]), "sys", "q", {}, store);
		stageMessage(state, "foo", [], store);
		expect(activeChat(state).messages.map((m) => m.content)).toEqual(["q", "r", "foo"]);
		// foo rides unseen until the next submit carries it in order.
		expect(buildApiMessages(activeChat(state), "sys").map((m) => m.content)).toEqual([
			"sys",
			"q",
			"r",
			"foo"
		]);
		await sendMessage(state, scriptedProvider(["ok"]), "sys", "bar", {}, store);
		expect(activeChat(state).messages.map((m) => m.content)).toEqual([
			"q",
			"r",
			"foo",
			"bar",
			"ok"
		]);
		// Empty stages are ignored.
		stageMessage(state, "   ", [], store);
		expect(activeChat(state).messages).toHaveLength(5);
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

	it("appends new and branched chats at the bottom, newest last", async () => {
		const { state, store } = stateWith(freshStore());
		const first = state.activeChatId;
		await sendMessage(state, scriptedProvider(["r"]), "sys", "one", {}, store);
		newChat(state, store);
		const second = state.activeChatId;
		expect(state.chats.map((c) => c.id)).toEqual([first, second]);
		expect(activeChat(state).messages).toEqual([]);
		selectChat(state, first);
		branchFrom(state, 0, store);
		expect(state.chats.map((c) => c.id)).toEqual([first, second, state.activeChatId]);
		expect(activeChat(state).messages[0]?.content).toBe("one");
	});

	it("deleting the active chat lands on the one right below it", () => {
		const { state, store } = stateWith(freshStore());
		const first = state.activeChatId;
		newChat(state, store);
		const second = state.activeChatId;
		newChat(state, store);
		const third = state.activeChatId;
		expect(state.chats.map((c) => c.id)).toEqual([first, second, third]);
		selectChat(state, second);
		deleteChat(state, second, store);
		expect(state.chats.map((c) => c.id)).toEqual([first, third]);
		expect(state.activeChatId).toBe(third);
		selectChat(state, third);
		deleteChat(state, third, store);
		expect(state.chats.map((c) => c.id)).toEqual([first]);
		expect(state.activeChatId).toBe(first);
	});

	it("folds and unfolds pasted spans by replacing the message", async () => {
		const { state, store } = stateWith(freshStore());
		await sendMessage(
			state,
			scriptedProvider(["r"]),
			"sys",
			"hello world",
			{ pasteFolds: [{ start: 0, end: 5, chars: 5 }] },
			store
		);
		const msg = activeChat(state).messages[0]!;
		expect(msg.pasteFolds).toEqual([{ start: 0, end: 5, chars: 5 }]);
		setPasteFold(state, msg.id, 0, true, store);
		const updated = activeChat(state).messages[0]!;
		expect(updated).not.toBe(msg);
		expect(updated.pasteFolds).toEqual([{ start: 0, end: 5, chars: 5, open: true }]);
		const again = createChatState(store);
		const reloaded = again.chats.flatMap((c) => c.messages).find((m) => m.id === msg.id);
		expect(reloaded?.pasteFolds).toEqual([{ start: 0, end: 5, chars: 5, open: true }]);
		setPasteFold(state, msg.id, 7, true, store);
		setPasteFold(state, "missing" as typeof msg.id, 0, true, store);
		expect(activeChat(state).messages[0]?.pasteFolds).toEqual([
			{ start: 0, end: 5, chars: 5, open: true }
		]);
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

	it("labels waypoint targets with a collapsed excerpt", () => {
		expect(waypointLabel("once more")).toBe("once more");
		expect(waypointLabel("  line one\nline two  ")).toBe("line one line two");
		expect(waypointLabel("x".repeat(100))).toBe("x".repeat(60));
		expect(waypointLabel("hello", 3)).toBe("hel");
		expect(waypointLabel("   ")).toBe("");
	});

	it("keeps a reply pill per chat and strips it on load", async () => {
		const { state, store } = stateWith(freshStore());
		newChat(state, store);
		const [first, second] = state.chats;
		expect(first!.replyLang).toBeNull();
		setChatReplyLang(state, first!.id, null, store);
		setChatReplyLang(state, second!.id, "ar", store);
		expect(activeChat(state).replyLang).toBe("ar");
		selectChat(state, first!.id);
		expect(activeChat(state).replyLang).toBeNull();
		const again = createChatState(store);
		expect(again.chats[0]?.replyLang).toBeNull();
		expect(again.chats[1]?.replyLang).toBeNull();
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
		expect(activeChat(state).messages[1]?.content).toContain("ping");
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
		expect(sent?.attachments).toHaveLength(2);

		const api = buildApiMessages(activeChat(state), "sys");
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
		const api = buildApiMessages(activeChat(state), "sys");
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
		await resendLast(state, scriptedProvider(["two"]), "sys", { store });
		expect(activeChat(state).messages[0]?.attachments).toHaveLength(1);

		branchFrom(state, 1, store);
		selectChat(state, state.chats[0]!.id);
		expect(activeChat(state).messages[0]?.attachments).toHaveLength(1);
	});
});

describe("resendLast identity", () => {
	it("reuses the user message instead of remounting it", async () => {
		const { state, store } = stateWith(freshStore());
		await sendMessage(state, scriptedProvider(["one"]), "sys", "q", {}, store);
		const userId = activeChat(state).messages[0]?.id;
		if (!userId) throw new Error("seed message missing");
		takeBackLastReply(state, store);
		await resendLast(state, scriptedProvider(["two"]), "sys", { store });
		const messages = activeChat(state).messages;
		expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
		expect(messages[0]?.id).toBe(userId);
		expect(messages[1]?.content).toBe("two");
	});
});
