import { inflate } from "pako";

/**
 * ESM bridge replacing `zlibjs/bin/gunzip.min.js` in the browser (see
 * vite.config.js alias). zlibjs assigns its exports onto top-level `this`,
 * which is undefined inside bundled ESM and crashes kuromoji's dictionary
 * load. The only API kuromoji uses is `new Zlib.Gunzip(bytes).decompress()`,
 * reimplemented here synchronously on top of pako.
 */
class Gunzip {
	private readonly data: Uint8Array;

	constructor(data: Uint8Array) {
		this.data = data;
	}

	decompress(): Uint8Array {
		return inflate(this.data);
	}
}

export const Zlib = { Gunzip };
