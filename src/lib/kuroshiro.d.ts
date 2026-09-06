declare module "kuroshiro" {
	const Kuroshiro: new () => {
		init(analyzer: unknown): Promise<void>;
		convert(text: string, options?: Record<string, unknown>): Promise<string>;
	};
	export default Kuroshiro;
}

declare module "kuroshiro-analyzer-kuromoji" {
	const KuromojiAnalyzer: new (options?: { dictPath?: string }) => unknown;
	export default KuromojiAnalyzer;
}
