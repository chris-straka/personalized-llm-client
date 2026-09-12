/**
 * Build-time Unihan extractor for Inspect enrichment.
 *
 * Downloads nothing itself: fetch the public UCD archive once, then run:
 *
 *   curl -sL -o /tmp/Unihan.zip https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip
 *   unzip -p /tmp/Unihan.zip Unihan_Readings.txt > /tmp/Unihan_Readings.txt
 *   bun scripts/unihan-extract.ts --src /tmp/Unihan_Readings.txt --out src/lib/unihan.generated.ts
 *
 * A `.zip` path also works directly for --src (reads
 * Unihan_Readings.txt out of it via `unzip -p`). `--include-ext-a`
 * additionally bundles CJK Extension A (U+3400–U+4DBF); the default
 * is CJK Unified Ideographs only (U+4E00–U+9FFF).
 *
 * Extracted fields per character: kDefinition, kMandarin, kJapaneseOn,
 * kJapaneseKun. Everything else in Unihan_Readings.txt is dropped.
 *
 * License: the source data is © Unicode, Inc. under the Unicode
 * License V3 (https://www.unicode.org/license.txt), which permits
 * copying/modifying/distributing provided the copyright + permission
 * notice travels with the copies. The generated module embeds that
 * notice (see formatGeneratedModule); keep it when regenerating.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

export const UNIHAN_SOURCE_URL = "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip";
export const UNIHAN_UNICODE_VERSION = "17.0.0";

/** CJK Unified Ideographs block, always bundled. */
export const UNIFIED_START = 0x4e00;
export const UNIFIED_END = 0x9fff;
/** CJK Extension A block, bundled only with --include-ext-a. */
export const EXT_A_START = 0x3400;
export const EXT_A_END = 0x4dbf;

/** Unihan field -> short key used in the generated module. */
export const UNIHAN_FIELD_MAP = {
	kDefinition: "d",
	kMandarin: "m",
	kJapaneseOn: "on",
	kJapaneseKun: "kun"
} as const;

export type UnihanField = keyof typeof UNIHAN_FIELD_MAP;

export interface ExtractOptions {
	/** Also bundle CJK Extension A (default false: size). */
	includeExtA?: boolean;
}

/** One extracted character: present fields only, keyed by short key. */
export interface ExtractedEntry {
	char: string;
	d?: string;
	m?: string;
	on?: string;
	kun?: string;
}

const FIELD_BY_NAME = new Map<string, keyof ExtractedEntry>(
	Object.entries(UNIHAN_FIELD_MAP).map(([field, short]) => [field, short as keyof ExtractedEntry])
);

/** True when the code point belongs to a bundled range under these options. */
export function inBundledRange(codePoint: number, options: ExtractOptions = {}): boolean {
	if (codePoint >= UNIFIED_START && codePoint <= UNIFIED_END) return true;
	if (options.includeExtA === true && codePoint >= EXT_A_START && codePoint <= EXT_A_END) return true;
	return false;
}

function entryFor(entries: Map<string, ExtractedEntry>, codePoint: number): ExtractedEntry {
	const char = String.fromCodePoint(codePoint);
	let entry = entries.get(char);
	if (!entry) {
		entry = { char };
		entries.set(char, entry);
	}
	return entry;
}

/**
 * Parse Unihan_Readings.txt content (tab-separated
 * `U+XXXX\tkField\tvalue` lines; `#` comments) into per-character
 * entries. Unknown fields, out-of-range code points, and malformed
 * lines are skipped. A repeated field keeps the last value.
 */
export function parseUnihanReadings(text: string, options: ExtractOptions = {}): Map<string, ExtractedEntry> {
	const entries = new Map<string, ExtractedEntry>();
	for (const line of text.split("\n")) {
		if (line === "" || line.startsWith("#")) continue;
		const tab1 = line.indexOf("\t");
		const tab2 = tab1 < 0 ? -1 : line.indexOf("\t", tab1 + 1);
		if (tab1 < 0 || tab2 < 0) continue;
		const cpText = line.slice(0, tab1);
		const field = line.slice(tab1 + 1, tab2);
		const value = line.slice(tab2 + 1);
		if (!cpText.startsWith("U+") || value === "") continue;
		const codePoint = Number.parseInt(cpText.slice(2), 16);
		if (!Number.isInteger(codePoint)) continue;
		const short = FIELD_BY_NAME.get(field);
		if (short === undefined) continue;
		if (!inBundledRange(codePoint, options)) continue;
		try {
			entryFor(entries, codePoint)[short] = value;
		} catch {
			continue;
		}
	}
	return entries;
}

export interface GeneratedMeta {
	unicodeVersion: string;
	sourceUrl: string;
	includeExtA: boolean;
}

/**
 * Render the generated TS module: Unicode copyright + permission
 * notice (required by Unicode License V3), provenance, then one
 * object literal keyed by character. Entries sort by code point so
 * regeneration diffs stay stable.
 */
export function formatGeneratedModule(entries: Map<string, ExtractedEntry>, meta: GeneratedMeta): string {
	const sorted = [...entries.values()].sort(
		(a, b) => (a.char.codePointAt(0) ?? 0) - (b.char.codePointAt(0) ?? 0)
	);
	const lines = sorted.map((entry) => {
		const parts: string[] = [];
		if (entry.d !== undefined) parts.push(`d:${JSON.stringify(entry.d)}`);
		if (entry.m !== undefined) parts.push(`m:${JSON.stringify(entry.m)}`);
		if (entry.on !== undefined) parts.push(`on:${JSON.stringify(entry.on)}`);
		if (entry.kun !== undefined) parts.push(`kun:${JSON.stringify(entry.kun)}`);
		return `\t${JSON.stringify(entry.char)}:{${parts.join(",")}},`;
	});
	return `/**
 * GENERATED — do not edit by hand. Regenerate with:
 *   bun scripts/unihan-extract.ts --src <Unihan_Readings.txt|Unihan.zip> --out src/lib/unihan.generated.ts${
		meta.includeExtA ? " --include-ext-a" : ""
	}
 *
 * Source: ${meta.sourceUrl} (Unicode ${meta.unicodeVersion},
 * Unihan_Readings.txt: kDefinition + kMandarin + kJapaneseOn +
 * kJapaneseKun for ${
		meta.includeExtA
			? "CJK Unified Ideographs (U+4E00-U+9FFF) + Extension A (U+3400-U+4DBF)"
			: "CJK Unified Ideographs (U+4E00-U+9FFF)"
	}, ${entries.size} entries).
 *
 * Unicode data © 1991-2026 Unicode, Inc. Distributed under the
 * Unicode License V3 (https://www.unicode.org/license.txt):
 * permission is granted to use, copy, modify, merge, publish,
 * distribute, and/or sell copies of the Data Files, provided the
 * copyright and permission notice appears with all copies or in
 * associated documentation. This header is that notice.
 */
export interface UnihanEntry {
	d?: string;
	m?: string;
	on?: string;
	kun?: string;
}
/** Bundled Unihan readings + definitions keyed by character. */
export const UNIHAN: Record<string, UnihanEntry> = {
${lines.join("\n")}
};
`;
}

function readSource(src: string): string {
	if (src.endsWith(".zip")) {
		const out = spawnSync("unzip", ["-p", src, "Unihan_Readings.txt"], {
			encoding: "utf-8",
			maxBuffer: 64 * 1024 * 1024
		});
		if (out.status !== 0 || out.stdout === "") {
			throw new Error(`could not read Unihan_Readings.txt from ${src}: ${out.stderr.trim()}`);
		}
		return out.stdout as string;
	}
	return readFileSync(src, "utf-8");
}

function argValue(args: string[], name: string): string | undefined {
	const flag = `--${name}`;
	const idx = args.indexOf(flag);
	if (idx < 0) return undefined;
	const value = args[idx + 1];
	if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
	return value;
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	try {
		const src = argValue(args, "src") ?? "Unihan_Readings.txt";
		const out = argValue(args, "out") ?? "src/lib/unihan.generated.ts";
		const includeExtA = args.includes("--include-ext-a");
		const text = readSource(src);
		const entries = parseUnihanReadings(text, { includeExtA });
		const module = formatGeneratedModule(entries, {
			unicodeVersion: UNIHAN_UNICODE_VERSION,
			sourceUrl: UNIHAN_SOURCE_URL,
			includeExtA
		});
		writeFileSync(out, module);
		console.log(`unihan-extract: ${entries.size} entries -> ${out} (${Buffer.byteLength(module, "utf-8")} bytes)`);
	} catch (error) {
		console.error(`unihan-extract: ${error instanceof Error ? error.message : error}`);
		process.exit(1);
	}
}
