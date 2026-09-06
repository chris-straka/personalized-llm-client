<script lang="ts">
	import { resolve } from "$app/paths";
	import { PROVIDERS, createProvider } from "$lib/providers/registry";
	import {
		loadSettings,
		saveSettings,
		maskKey,
		type AppSettings,
		type ThinkingLevel
	} from "$lib/settings";
	import { ejectProvider, restoreProvider } from "$lib/session";
	import { ProviderError, type ChatMessage } from "$lib/providers/types";

	let settings: AppSettings = $state(loadSettings());
	let savedFlash = $state(false);
	let testing = $state(false);
	let testResult = $state("");
	let testError = $state("");
	/** Per-provider "replace key" mode; otherwise a stored key shows masked. */
	let editingKey: Record<string, boolean> = $state({});
	/** Local mirror of the session module set, so eject/restore re-renders. */
	let ejectedIds: string[] = $state([]);

	const activeDef = $derived(PROVIDERS.find((p) => p.id === settings.activeProviderId)!);
	const active = $derived(settings.providers[settings.activeProviderId]);
	const ejected = $derived(ejectedIds.includes(settings.activeProviderId));
	const showKeyField = $derived(!active.apiKey.trim() || editingKey[settings.activeProviderId]);

	function eject() {
		ejectProvider(settings.activeProviderId);
		ejectedIds = [...ejectedIds, settings.activeProviderId];
	}

	function restore() {
		restoreProvider(settings.activeProviderId);
		ejectedIds = ejectedIds.filter((id) => id !== settings.activeProviderId);
	}

	function save() {
		saveSettings(settings);
		editingKey[settings.activeProviderId] = false;
		savedFlash = true;
		setTimeout(() => (savedFlash = false), 1500);
	}

	function switchProvider(id: string) {
		settings.activeProviderId = id;
		testResult = "";
		testError = "";
	}

	function setThinking(level: ThinkingLevel) {
		settings.thinkingLevel = level;
	}

	async function testConnection() {
		testing = true;
		testResult = "";
		testError = "";
		try {
			if (ejected) throw new ProviderError("Key is ejected for this session — restore it to test.");
			if (!active.apiKey.trim()) throw new ProviderError("Enter an API key first.");
			const provider = createProvider(settings.activeProviderId, active);
			const messages: ChatMessage[] = [
				{ role: "system", content: settings.systemPrompt },
				{ role: "user", content: "Reply with exactly: ok" }
			];
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 30000);
			try {
				const result = await provider.chat(messages, { signal: controller.signal });
				const tokens = result.usage ? ` (${result.usage.total} tokens)` : "";
				testResult = `Connected — model replied: ${result.content.trim()}${tokens}`;
			} finally {
				clearTimeout(timer);
			}
		} catch (error) {
			testError = error instanceof ProviderError ? error.message : String(error);
		} finally {
			testing = false;
		}
	}
</script>

<svelte:head>
	<title>Settings — Ccez Studio</title>
</svelte:head>

<main>
	<header>
		<a href={resolve("/")}>← Chat</a>
		<h1>Settings</h1>
	</header>

	<section aria-labelledby="provider-heading">
		<h2 id="provider-heading">Model provider</h2>
		<div class="provider-row" role="radiogroup" aria-label="Active provider">
			{#each PROVIDERS as def (def.id)}
				<button
					type="button"
					role="radio"
					aria-checked={settings.activeProviderId === def.id}
					class:selected={settings.activeProviderId === def.id}
					onclick={() => switchProvider(def.id)}
				>
					{def.label}
					<span class:verified={def.verifiedLive} class:unverified={!def.verifiedLive}>
						{def.verifiedLive ? "verified" : "unverified"}
					</span>
				</button>
			{/each}
		</div>

		<label>
			Base URL
			<input type="url" bind:value={active.baseUrl} autocomplete="off" spellcheck="false" />
		</label>
		<label>
			Model
			<input type="text" bind:value={active.model} autocomplete="off" spellcheck="false" />
		</label>
		{#if showKeyField}
			<label>
				API key <span class="hint">{activeDef.keyHint}</span>
				<input
					type="password"
					bind:value={active.apiKey}
					autocomplete="off"
					spellcheck="false"
				/>
			</label>
		{:else if ejected}
			<p class="key-state" role="status">
				Key ejected for this session.
				<button type="button" onclick={restore}>Restore</button>
			</p>
		{:else}
			<p class="key-state" role="status">
				Key loaded: <code>{maskKey(active.apiKey)}</code>
				<button
					type="button"
					onclick={() => (editingKey[settings.activeProviderId] = true)}
				>
					Replace
				</button>
				<button type="button" onclick={eject}>Eject for this session</button>
			</p>
		{/if}
		<p class="note">Keys stay on this machine, in this app's local storage.</p>
	</section>

	<section aria-labelledby="defaults-heading">
		<h2 id="defaults-heading">Defaults</h2>
		<label>
			System prompt
			<textarea rows="2" bind:value={settings.systemPrompt} spellcheck="false"></textarea>
		</label>
		<fieldset>
			<legend>Thinking level</legend>
			<div class="segmented" role="radiogroup" aria-label="Thinking level">
				<button
					type="button"
					role="radio"
					aria-checked={settings.thinkingLevel === "low"}
					class:selected={settings.thinkingLevel === "low"}
					onclick={() => setThinking("low")}>Low</button
				>
				<button
					type="button"
					role="radio"
					aria-checked={settings.thinkingLevel === "high"}
					class:selected={settings.thinkingLevel === "high"}
					onclick={() => setThinking("high")}>High</button
				>
			</div>
		</fieldset>
		<label>
			Translate target (⌘+T lookup)
			<input type="text" bind:value={settings.translateTarget} autocomplete="off" spellcheck="false" />
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={settings.readingAids} />
			Reading aids (pinyin / furigana / tashkeel)
		</label>
		<label class="check">
			<input type="checkbox" bind:checked={settings.voice} />
			Voice readback (web speech engine)
		</label>
		<label>
			Voice language for Latin-script text (French, German, English… — BCP-47)
			<input
				type="text"
				bind:value={settings.voiceLang}
				placeholder="en-US"
				autocomplete="off"
				spellcheck="false"
			/>
		</label>
	</section>

	<footer>
		<button type="button" class="primary" onclick={save}>Save</button>
		<button type="button" onclick={testConnection} disabled={testing}>
			{testing ? "Testing…" : "Test connection"}
		</button>
		{#if savedFlash}<span class="saved" role="status">Saved</span>{/if}
	</footer>

	{#if testResult}<p class="result" role="status">{testResult}</p>{/if}
	{#if testError}<p class="error" role="alert">{testError}</p>{/if}
</main>

<style>
	:global(body) {
		margin: 0;
		background: #fff;
	}
	main {
		max-width: 36rem;
		margin: 0 auto;
		padding: 2rem 1.25rem 4rem;
		font-family:
			-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
		color: #1c1c1e;
		color-scheme: light dark;
	}
	header {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}
	header a {
		color: #3a3a3c;
		text-decoration: none;
		font-size: 0.9rem;
	}
	h1 {
		font-size: 1.4rem;
		font-weight: 700;
		margin: 0;
	}
	section {
		border-top: 1px solid #e5e5ea;
		padding: 1.25rem 0;
	}
	h2 {
		font-size: 1rem;
		font-weight: 650;
		margin: 0 0 0.9rem;
	}
	label {
		display: block;
		font-size: 0.85rem;
		font-weight: 550;
		margin-bottom: 0.9rem;
	}
	input[type="url"],
	input[type="text"],
	input[type="password"],
	textarea {
		display: block;
		width: 100%;
		box-sizing: border-box;
		margin-top: 0.3rem;
		padding: 0.5rem 0.6rem;
		font: inherit;
		font-weight: 400;
		border: 1px solid #c7c7cc;
		border-radius: 8px;
		background: #fff;
	}
	.hint {
		font-weight: 400;
		color: #6e6e73;
	}
	.note {
		font-size: 0.8rem;
		color: #6e6e73;
		margin: 0.2rem 0 0;
	}
	.key-state {
		font-size: 0.85rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.key-state code {
		font-family: ui-monospace, monospace;
	}
	.key-state button {
		font-size: 0.8rem;
		border: 1px solid #c7c7cc;
		border-radius: 6px;
		background: #fff;
		cursor: pointer;
		padding: 0.2rem 0.6rem;
	}
	.provider-row,
	.segmented {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.provider-row button,
	.segmented button {
		padding: 0.45rem 0.9rem;
		font: inherit;
		font-size: 0.85rem;
		border: 1px solid #c7c7cc;
		border-radius: 999px;
		background: #fff;
		cursor: pointer;
	}
	.provider-row button.selected,
	.segmented button.selected {
		border-color: #1c1c1e;
		background: #1c1c1e;
		color: #fff;
	}
	.verified,
	.unverified {
		font-size: 0.7rem;
		margin-left: 0.35rem;
		padding: 0.1rem 0.4rem;
		border-radius: 999px;
	}
	.verified {
		background: #e6f4ea;
		color: #1e7e34;
	}
	.unverified {
		background: #f3f3f4;
		color: #6e6e73;
	}
	.selected .verified {
		background: rgba(255, 255, 255, 0.2);
		color: #fff;
	}
	.selected .unverified {
		background: rgba(255, 255, 255, 0.2);
		color: #fff;
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0 0 0.9rem;
	}
	legend {
		font-size: 0.85rem;
		font-weight: 550;
		padding: 0;
		margin-bottom: 0.4rem;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: 400;
	}
	footer {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding-top: 0.5rem;
	}
	footer button {
		padding: 0.5rem 1.1rem;
		font: inherit;
		font-size: 0.9rem;
		border: 1px solid #c7c7cc;
		border-radius: 8px;
		background: #fff;
		cursor: pointer;
	}
	footer button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.primary {
		background: #1c1c1e;
		border-color: #1c1c1e;
		color: #fff;
	}
	.saved {
		font-size: 0.85rem;
		color: #1e7e34;
	}
	.result,
	.error {
		font-size: 0.85rem;
		padding: 0.6rem 0.8rem;
		border-radius: 8px;
	}
	.result {
		background: #e6f4ea;
	}
	.error {
		background: #fdecea;
		color: #94250a;
	}
	@media (prefers-color-scheme: dark) {
		:global(body) {
			background: #17171a;
		}
		main {
			color: #f2f2f7;
		}
		header a {
			color: #aeaeb2;
		}
		section {
			border-color: #38383a;
		}
		input[type="url"],
		input[type="text"],
		input[type="password"],
		textarea,
		.provider-row button,
		.segmented button,
		footer button {
			background: #1c1c1e;
			border-color: #48484a;
			color: #f2f2f7;
		}
		.provider-row button.selected,
		.segmented button.selected,
		.primary {
			background: #f2f2f7;
			border-color: #f2f2f7;
			color: #1c1c1e;
		}
		.hint,
		.note {
			color: #98989f;
		}
		.result {
			background: #12351f;
		}
		.error {
			background: #3d1008;
			color: #ffb4a2;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		* {
			transition: none;
		}
	}
</style>
