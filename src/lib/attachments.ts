import { estimateTextTokens } from "./render";

/**
 * Composer attachments: images (downscaled client-side before send) and
 * text files (inlined with a token estimate). Every attachment carries its
 * own estimate so the composer can show cost before sending.
 */

export type AttachmentKind = "image" | "text";

export interface Attachment {
	id: string;
	name: string;
	mime: string;
	kind: AttachmentKind;
	/** Downscaled data URL (images only). */
	dataUrl: string | null;
	/** File text (text kind only). */
	text: string | null;
	width: number | null;
	height: number | null;
	/** Estimated tokens this attachment adds to the request. */
	tokens: number;
}

/** Marker line inserted in the prompt when an image is pasted. The composer
 * strips these lines on send — the image travels as an attachment instead. */
export const IMAGE_MARKER = "[Pasted an image]";

/** Max side (px) for images before upload. */
export const IMAGE_MAX_DIM = 1568;

/**
 * OpenAI-style vision estimate: a base cost plus per-512px-tile cost on the
 * downscaled image.
 */
export function imageTokens(width: number, height: number): number {
	const tiles = Math.ceil(width / 512) * Math.ceil(height / 512);
	return 85 + 170 * Math.max(1, tiles);
}

/** Target dimensions fitting inside IMAGE_MAX_DIM, preserving aspect ratio. */
export function fitDimensions(width: number, height: number): { width: number; height: number } {
	const scale = Math.min(1, IMAGE_MAX_DIM / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	};
}

/** Downscale an image to a data URL via canvas. Callers pass a loaded
 * HTMLImageElement (or any canvas-drawImage source with width/height). */
export async function downscaleImage(
	source: { width: number; height: number },
	draw: (canvas: HTMLCanvasElement, width: number, height: number) => void,
	mime = "image/jpeg"
): Promise<{ dataUrl: string; width: number; height: number }> {
	const { width, height } = fitDimensions(source.width, source.height);
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	draw(canvas, width, height);
	return {
		dataUrl: canvas.toDataURL(mime, 0.85),
		width,
		height
	};
}

export function newId(): string {
	return crypto.randomUUID();
}

const TEXT_MIMES = [
	"text/",
	"application/json",
	"application/javascript",
	"application/typescript",
	"application/x-sh",
	"application/yaml",
	"application/toml",
	"application/xml"
];

const TEXT_EXTENSIONS = [
	"txt", "md", "markdown", "json", "js", "ts", "tsx", "jsx", "mjs", "cjs",
	"py", "rb", "go", "rs", "java", "c", "h", "cpp", "hpp", "cs", "swift",
	"kt", "php", "sh", "bash", "zsh", "yaml", "yml", "toml", "xml", "html",
	"css", "scss", "sql", "csv", "tsv", "log", "ini", "cfg", "conf", "env",
	"dockerfile", "gitignore", "svelte", "vue", "rs"
];

/** Cap inlined file text so one attachment can't blow the context window. */
export const MAX_FILE_CHARS = 100_000;

export function isTextFile(file: File): boolean {
	if (TEXT_MIMES.some((m) => file.type.startsWith(m))) return true;
	const ext = file.name.split(".").pop()?.toLowerCase();
	return !!ext && TEXT_EXTENSIONS.includes(ext);
}

/** Read a user file into an Attachment (images downscaled, text inlined). */
export async function fileToAttachment(file: File): Promise<Attachment> {
	if (file.type.startsWith("image/")) {
		const bitmap = await createImageBitmap(file);
		try {
			const { width, height } = fitDimensions(bitmap.width, bitmap.height);
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("Canvas 2D unavailable");
			ctx.drawImage(bitmap, 0, 0, width, height);
			return {
				id: newId(),
				name: file.name || "pasted-image",
				mime: "image/jpeg",
				kind: "image",
				dataUrl: canvas.toDataURL("image/jpeg", 0.85),
				text: null,
				width,
				height,
				tokens: imageTokens(width, height)
			};
		} finally {
			bitmap.close();
		}
	}
	if (isTextFile(file)) {
		const raw = await file.text();
		const text = raw.length > MAX_FILE_CHARS ? raw.slice(0, MAX_FILE_CHARS) : raw;
		return {
			id: newId(),
			name: file.name || "pasted-text",
			mime: file.type || "text/plain",
			kind: "text",
			dataUrl: null,
			text,
			width: null,
			height: null,
			tokens: estimateTextTokens(text)
		};
	}
	throw new Error(`Unsupported attachment: ${file.name || file.type || "unknown file"}`);
}

/** Drop pasted-image marker lines; the images travel as attachments. */
export function stripImageMarkers(text: string): string {
	return text
		.split("\n")
		.filter((line) => line.trim() !== IMAGE_MARKER)
		.join("\n");
}
