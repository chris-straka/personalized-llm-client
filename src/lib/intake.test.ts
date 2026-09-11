import { describe, it, expect, vi } from "vitest";
import {
	captureScreenToFile,
	chatToMarkdown,
	consumeLaunchFiles,
	dropFilesFromDataTransfer,
	exportChatMarkdown,
	exportFilename,
	isMarkdownFilename,
	isPermissionDismissal,
	splitLaunchFiles,
	type LaunchParamsLike,
	type LaunchQueueLike,
	type SavePickerOptions,
	type ScreenStreamLike
} from "./intake";

function textFile(name: string, content = "x"): File {
	return new File([content], name, { type: "text/plain" });
}

describe("dropFilesFromDataTransfer", () => {
	it("returns dropped files in order", () => {
		const a = textFile("a.md");
		const b = textFile("b.png");
		expect(dropFilesFromDataTransfer({ files: [a, b] })).toEqual([a, b]);
	});

	it("treats null, missing, and null entries as no files", () => {
		expect(dropFilesFromDataTransfer(null)).toEqual([]);
		expect(dropFilesFromDataTransfer(undefined)).toEqual([]);
		expect(dropFilesFromDataTransfer({})).toEqual([]);
		expect(dropFilesFromDataTransfer({ files: null })).toEqual([]);
		expect(dropFilesFromDataTransfer({ files: [null, textFile("a.md")] })).toHaveLength(1);
	});
});

describe("captureScreenToFile", () => {
	function stream(stops: number[] = []): ScreenStreamLike {
		return { getVideoTracks: () => [{ stop: () => void stops.push(1) }] };
	}

	it("wraps the grabbed frame as a screenshot file and stops tracks", async () => {
		const stops: number[] = [];
		const getDisplayMedia = vi.fn(async () => stream(stops));
		const grabFrame = vi.fn(async () => new Blob(["frame"], { type: "image/png" }));
		const file = await captureScreenToFile(getDisplayMedia, grabFrame);
		expect(file).toBeInstanceOf(File);
		expect(file.name).toBe("screenshot.png");
		expect(file.type).toBe("image/png");
		expect(getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: false });
		expect(grabFrame).toHaveBeenCalledOnce();
		expect(stops).toHaveLength(1);
	});

	it("still stops tracks when the grab fails, then rethrows", async () => {
		const stops: number[] = [];
		const getDisplayMedia = vi.fn(async () => stream(stops));
		const grabFrame = vi.fn(async () => {
			throw new Error("no frame");
		});
		await expect(captureScreenToFile(getDisplayMedia, grabFrame)).rejects.toThrow("no frame");
		expect(stops).toHaveLength(1);
	});

	it("propagates permission dismissals for the caller to swallow", async () => {
		const denied = new DOMException("denied", "NotAllowedError");
		await expect(
			captureScreenToFile(
				vi.fn(async () => {
					throw denied;
				}),
				vi.fn()
			)
		).rejects.toBe(denied);
	});
});

describe("isPermissionDismissal", () => {
	it("swallows Abort and NotAllowed, surfaces the rest", () => {
		expect(isPermissionDismissal(new DOMException("x", "AbortError"))).toBe(true);
		expect(isPermissionDismissal(new DOMException("x", "NotAllowedError"))).toBe(true);
		expect(isPermissionDismissal(new Error("Couldn't capture that frame."))).toBe(false);
		expect(isPermissionDismissal(null)).toBe(false);
	});
});

describe("launchQueue intake", () => {
	it("returns false and calls nothing without a queue", () => {
		const onFiles = vi.fn();
		expect(consumeLaunchFiles(null, onFiles)).toBe(false);
		expect(consumeLaunchFiles(undefined, onFiles)).toBe(false);
		expect(onFiles).not.toHaveBeenCalled();
	});

	it("resolves handles to files and skips unreadable ones", async () => {
		let consumer!: (params: LaunchParamsLike) => void;
		const queue: LaunchQueueLike = {
			setConsumer: (callback) => {
				consumer = callback;
			}
		};
		const seen: File[][] = [];
		expect(
			consumeLaunchFiles(queue, (files) => {
				seen.push(files);
			})
		).toBe(true);
		const good = textFile("notes.md", "hello");
		consumer({
			files: [
				{ getFile: async () => good },
				{
					getFile: async () => {
						throw new Error("locked");
					}
				}
			]
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(seen).toEqual([[good]]);
	});

	it("never calls back on an empty launch", async () => {
		let consumer!: (params: LaunchParamsLike) => void;
		const queue: LaunchQueueLike = {
			setConsumer: (callback) => {
				consumer = callback;
			}
		};
		const onFiles = vi.fn();
		consumeLaunchFiles(queue, onFiles);
		consumer({ files: [] });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(onFiles).not.toHaveBeenCalled();
	});
});

describe("markdown filename split", () => {
	it("matches .md and .markdown case-insensitively", () => {
		expect(isMarkdownFilename("notes.md")).toBe(true);
		expect(isMarkdownFilename("NOTES.MD")).toBe(true);
		expect(isMarkdownFilename("doc.markdown")).toBe(true);
		expect(isMarkdownFilename("photo.png")).toBe(false);
		expect(isMarkdownFilename("md")).toBe(false);
	});

	it("routes markdown to the composer and the rest to attachments", () => {
		const md = textFile("notes.md");
		const upper = textFile("UPPER.MARKDOWN");
		const png = new File(["x"], "shot.png", { type: "image/png" });
		expect(splitLaunchFiles([md, png, upper])).toEqual({ markdown: [md, upper], rest: [png] });
	});
});

describe("chatToMarkdown", () => {
	it("renders an empty chat as header plus placeholder", () => {
		expect(chatToMarkdown({ messages: [] })).toBe("# Chat export\n\n(empty chat)\n");
	});

	it("sections roles, trims trailing space, and lists attachments", () => {
		const md = chatToMarkdown({
			messages: [
				{ role: "user", content: "hello   \n", attachments: [{ name: "notes.md" }] },
				{ role: "assistant", content: "hi there" },
				{ role: "user", content: "   " }
			]
		});
		expect(md).toBe(
			[
				"# Chat export",
				"",
				"## You",
				"",
				"hello",
				"",
				"- Attachment: notes.md",
				"",
				"---",
				"",
				"## Assistant",
				"",
				"hi there",
				"",
				"---",
				"",
				"## You",
				"",
				"(no text)",
				""
			].join("\n")
		);
	});
});

describe("exportFilename", () => {
	it("names chat-YYYY-MM-DD.md in UTC", () => {
		expect(exportFilename(Date.parse("2026-03-04T05:06:07Z"))).toBe("chat-2026-03-04.md");
	});
});

describe("exportChatMarkdown", () => {
	const chat = { messages: [{ role: "user" as const, content: "hello" }] };

	it("writes through the picker where available", async () => {
		const written: string[] = [];
		const closed: number[] = [];
		const seen: SavePickerOptions[] = [];
		const how = await exportChatMarkdown(chat, {
			picker: async (options: SavePickerOptions) => {
				seen.push(options);
				return {
					createWritable: async () => ({
						write: async (text: string) => void written.push(text),
						close: async () => void closed.push(1)
					})
				};
			}
		});
		expect(how).toBe("picker");
		expect(written).toEqual([chatToMarkdown(chat)]);
		expect(closed).toHaveLength(1);
		expect(seen).toHaveLength(1);
		const options = seen[0];
		expect(options?.suggestedName).toMatch(/^chat-\d{4}-\d{2}-\d{2}\.md$/);
		expect(options?.types).toEqual([
			{ description: "Markdown", accept: { "text/markdown": [".md"] } }
		]);
	});

	it("falls back to download where the picker is missing", async () => {
		const downloads: { text: string; filename: string }[] = [];
		const how = await exportChatMarkdown(chat, {
			picker: null,
			download: (text, filename) => void downloads.push({ text, filename })
		});
		expect(how).toBe("download");
		expect(downloads).toHaveLength(1);
		expect(downloads[0]?.text).toBe(chatToMarkdown(chat));
		expect(downloads[0]?.filename).toMatch(/^chat-\d{4}-\d{2}-\d{2}\.md$/);
	});

	it("throws when no export path exists", async () => {
		await expect(exportChatMarkdown(chat, { picker: null })).rejects.toThrow(
			"No export path available."
		);
	});

	it("propagates picker aborts for the caller to swallow", async () => {
		const aborted = new DOMException("cancelled", "AbortError");
		await expect(
			exportChatMarkdown(chat, {
				picker: async () => {
					throw aborted;
				}
			})
		).rejects.toBe(aborted);
	});
});
