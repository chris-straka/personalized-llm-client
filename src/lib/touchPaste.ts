/**
 * Touch paste-images path (search-mobile bucket): reads images from the
 * Async Clipboard API into the existing attachments pipeline
 * (`fileToAttachment` in `attachments.ts`). The clipboard reader is
 * injected so the logic unit-tests without clipboard permission.
 */

export interface ClipboardItemLike {
	types: string[];
	getType(type: string): Promise<Blob>;
}

/** MIME types on a clipboard item that can become image attachments. */
export function imageTypesForItem(types: string[]): string[] {
	return types.filter((t) => t.startsWith("image/"));
}

/**
 * Read every image off every clipboard item as Files. Throws when the
 * clipboard holds no images so callers can toast instead of silently
 * doing nothing.
 */
export async function readClipboardImageFiles(
	read: () => Promise<ClipboardItemLike[]>
): Promise<File[]> {
	const items = await read();
	const files: File[] = [];
	for (const item of items) {
		for (const type of imageTypesForItem(item.types)) {
			try {
				const blob = await item.getType(type);
				const ext = type.split("/")[1] ?? "png";
				files.push(
					new File([blob], `clipboard-image.${ext}`, { type: blob.type || type })
				);
			} catch {
				// One unreadable type must not drop the readable rest.
			}
		}
	}
	if (files.length === 0) throw new Error("No images on the clipboard.");
	return files;
}

/** True when the touch paste button can work in this runtime. */
export function clipboardReadAvailable(): boolean {
	try {
		return (
			typeof navigator !== "undefined" &&
			!!navigator.clipboard &&
			typeof (navigator.clipboard as unknown as { read?: unknown }).read === "function"
		);
	} catch {
		return false;
	}
}
