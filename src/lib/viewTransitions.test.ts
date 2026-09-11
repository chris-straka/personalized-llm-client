// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { viewTransitionsSupported, switchChatWithTransition } from "./viewTransitions";

afterEach(() => {
	vi.restoreAllMocks();
	delete (document as unknown as Record<string, unknown>).startViewTransition;
});

describe("view transitions for chat switching", () => {
	it("reports unsupported by default (instant cut)", () => {
		expect(viewTransitionsSupported()).toBe(false);
	});
	it("runs the mutation synchronously where unsupported", async () => {
		const mutate = vi.fn();
		await switchChatWithTransition(mutate);
		expect(mutate).toHaveBeenCalledTimes(1);
	});
	it("routes the mutation through startViewTransition where supported", async () => {
		const mutate = vi.fn();
		(document as unknown as Record<string, unknown>).startViewTransition = vi.fn(
			(opts: { update: () => void }) => {
				opts.update();
				return { finished: Promise.resolve() };
			}
		);
		expect(viewTransitionsSupported()).toBe(true);
		await switchChatWithTransition(mutate);
		expect(mutate).toHaveBeenCalledTimes(1);
	});
	it("falls back to a direct run when the transition throws", async () => {
		const mutate = vi.fn();
		(document as unknown as Record<string, unknown>).startViewTransition = vi.fn(() => {
			throw new Error("nope");
		});
		await switchChatWithTransition(mutate);
		expect(mutate).toHaveBeenCalledTimes(1);
	});
});
