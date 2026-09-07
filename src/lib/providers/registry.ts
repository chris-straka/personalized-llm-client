import { OpenAICompatProvider } from "./openai-compat";

export interface ProviderDef {
	id: string;
	label: string;
	defaultBaseUrl: string;
	defaultModel: string;
	/** Short hint shown under the key field. Never a real key. */
	keyHint: string;
}

export const PROVIDERS: ProviderDef[] = [
	{
		id: "muse",
		label: "Muse Spark 1.3",
		defaultBaseUrl: "https://api.meta.ai/v1",
		defaultModel: "muse-spark-1.3-contributor",
		keyHint: "Meta Model API key"
	},
	{
		id: "deepseek",
		label: "DeepSeek",
		defaultBaseUrl: "https://api.deepseek.com",
		defaultModel: "deepseek-v4-pro",
		keyHint: "Starts with sk-"
	}
];

/** Built-ins plus user-added custom providers. */
export function listProviders(custom: ProviderDef[] = []): ProviderDef[] {
	return [...PROVIDERS, ...custom];
}

export function getProviderDef(id: string, custom: ProviderDef[] = []): ProviderDef {
	const def = listProviders(custom).find((p) => p.id === id);
	if (!def) throw new Error(`Unknown provider: ${id}`);
	return def;
}

export function createProvider(
	id: string,
	opts: { baseUrl: string; apiKey: string; model: string },
	custom: ProviderDef[] = []
): OpenAICompatProvider {
	getProviderDef(id, custom); // throws on unknown ids
	return new OpenAICompatProvider(id, opts);
}
