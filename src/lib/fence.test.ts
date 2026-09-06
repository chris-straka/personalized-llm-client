import { describe, it, expect } from "vitest";
import { isFenceTrigger, findFenceBlock, splitLines } from "./fence";

describe("fence triggers", () => {
	it("recognizes ```lang lines and rejects the rest", () => {
		expect(isFenceTrigger("```cpp")).toBe("cpp");
		expect(isFenceTrigger("```c++")).toBe("c++");
		expect(isFenceTrigger("```")).toBeNull();
		expect(isFenceTrigger("some ```cpp text")).toBeNull();
		expect(isFenceTrigger("```c pp")).toBeNull();
	});
});

describe("findFenceBlock", () => {
	const doc = ["talk", "```cpp", "int x = 1;", "```", "after"].join("\n");
	const { lines, starts } = splitLines(doc);

	it("locates the body around a cursor inside the block", () => {
		const pos = starts[2] + 2;
		const block = findFenceBlock(lines, starts, pos);
		expect(block?.language).toBe("cpp");
		expect(doc.slice(block!.bodyFrom, block!.bodyTo)).toBe("int x = 1;\n");
	});

	it("returns null outside a complete block", () => {
		expect(findFenceBlock(lines, starts, 1)).toBeNull();
		const unclosed = splitLines("```cpp\ncode");
		expect(findFenceBlock(unclosed.lines, unclosed.starts, 8)).toBeNull();
	});
});
