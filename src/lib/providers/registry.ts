import { OpenAICompatProvider } from "./openai-compat";

export interface ProviderDef {
	id: string;
	label: string;
	defaultBaseUrl: string;
	defaultModel: string;
	/** Short hint shown under the key field. Never a real key. */
	keyHint: string;
	/** True once the adapter has been verified live against the real API. */
	verifiedLive: boolean;
}

export const PROVIDERS: ProviderDef[] = [
	{
		id: "deepseek",
		label: "DeepSeek",
		defaultBaseUrl: "https://api.deepseek.com",
		defaultModel: "deepseek-v4-pro",
		keyHint: "Starts with sk-",
		verifiedLive: false
	},
	{
		id: "muse",
		label: "Muse Spark 1.3",
		defaultBaseUrl: "https://api.meta.ai/v1",
		defaultModel: "muse-spark-1.3-contributor",
		keyHint: "Meta Model API key",
		verifiedLive: true
	}
];

export function getProviderDef(id: string): ProviderDef {
	const def = PROVIDERS.find((p) => p.id === id);
	if (!def) throw new Error(`Unknown provider: ${id}`);
	return def;
}

export function createProvider(
	id: string,
	opts: { baseUrl: string; apiKey: string; model: string }
): OpenAICompatProvider {
	getProviderDef(id); // throws on unknown ids
	return new OpenAICompatProvider(id, opts);
}
