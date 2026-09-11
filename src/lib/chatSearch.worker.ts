/**
 * Search index worker: keeps the ranked query off the main thread so
 * large histories never jank the composer. The main thread persists
 * the raw documents in IndexedDB (`chatSearchStore.ts`); the worker
 * only holds the latest snapshot in memory.
 */
import { querySearch, type SearchDoc } from "./chatSearch";

interface IndexMessage {
	type: "index";
	docs: SearchDoc[];
}

interface QueryMessage {
	type: "query";
	id: number;
	query: string;
	limit: number;
}

let docs: SearchDoc[] = [];

interface WorkerScope {
	postMessage(message: unknown): void;
	addEventListener(type: "message", listener: (event: Event) => void): void;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener("message", (event: Event) => {
	const data = (event as MessageEvent<IndexMessage | QueryMessage>).data;
	if (!data || typeof data !== "object") return;
	if (data.type === "index") {
		docs = data.docs;
		return;
	}
	if (data.type === "query") {
		const { id, query, limit } = data;
		try {
			const hits = querySearch(docs, query, limit);
			scope.postMessage({ type: "results", id, hits });
		} catch (error) {
			scope.postMessage({
				type: "results",
				id,
				hits: [],
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}
});
