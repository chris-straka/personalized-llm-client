import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAICompatProvider, readSse } from "./openai-compat";
import { ProviderError } from "./types";

const CONFIG = { baseUrl: "https://example.test/v1/", apiKey: "k", model: "m" };

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" }
	});
}

function sseResponse(chunks: string[]): Response {
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
			controller.close();
		}
	});
	return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("chat", () => {
	it("posts model + messages to /chat/completions with a bearer key", async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({ choices: [{ message: { content: "hi" } }] })
		);
		vi.stubGlobal("fetch", fetchMock);

		const provider = new OpenAICompatProvider("probe", CONFIG);
		const result = await provider.chat([{ role: "user", content: "hey" }]);

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("https://example.test/v1/chat/completions");
		expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer k");
		expect(JSON.parse(init.body as string)).toMatchObject({
			model: "m",
			messages: [{ role: "user", content: "hey" }],
			stream: false
		});
		expect(result.content).toBe("hi");
	});

	it("maps usage including reasoning tokens, null when absent", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				jsonResponse({
					choices: [{ message: { content: "x" } }],
					usage: {
						prompt_tokens: 23,
						completion_tokens: 219,
						total_tokens: 242,
						completion_tokens_details: { reasoning_tokens: 207 }
					}
				})
			)
		);
		const provider = new OpenAICompatProvider("probe", CONFIG);
		const withUsage = await provider.chat([{ role: "user", content: "x" }]);
		expect(withUsage.usage).toEqual({
			prompt: 23,
			completion: 219,
			total: 242,
			reasoning: 207
		});

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => jsonResponse({ choices: [{ message: { content: "x" } }] }))
		);
		const withoutUsage = await provider.chat([{ role: "user", content: "x" }]);
		expect(withoutUsage.usage).toBeNull();
	});

	it("wraps HTTP failures and network errors in ProviderError", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
		const provider = new OpenAICompatProvider("probe", CONFIG);
		const err = await provider.chat([{ role: "user", content: "x" }]).catch((e) => e);
		expect(err).toBeInstanceOf(ProviderError);
		expect((err as ProviderError).status).toBe(401);

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("down");
			})
		);
		const net = await provider.chat([{ role: "user", content: "x" }]).catch((e) => e);
		expect(net).toBeInstanceOf(ProviderError);
	});
});

describe("stream", () => {
	it("assembles tokens across split chunks and stops at [DONE]", async () => {
		const seen: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				sseResponse([
					`data: {"choices":[{"delta":{"content":"hel`,
					`lo"}}]}\n\ndata: {"choices":[{"delta":{"content":"!"}}]}\n\ndata: [DONE]\n\n`
				])
			)
		);
		const provider = new OpenAICompatProvider("probe", CONFIG);
		const result = await provider.stream([{ role: "user", content: "x" }], {
			onToken: (t) => void seen.push(t)
		});
		expect(result.content).toBe("hello!");
		expect(seen.join("")).toBe("hello!");
	});
});

describe("readSse", () => {
	it("yields data payloads split across reads", async () => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('data: {"a":'));
				controller.enqueue(new TextEncoder().encode('1}\n\ndata: [DONE]\n\n'));
				controller.close();
			}
		});
		const out: string[] = [];
		for await (const event of readSse(stream)) out.push(event);
		expect(out).toEqual(['{"a":1}', "[DONE]"]);
	});
});
