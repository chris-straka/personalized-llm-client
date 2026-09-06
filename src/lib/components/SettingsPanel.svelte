<script lang="ts">
	import { PROVIDERS, createProvider } from "$lib/providers/registry";
	import {
		saveSettings,
		maskKey,
		type AppSettings,
		type ThinkingLevel
	} from "$lib/settings";
	import { ejectProvider, restoreProvider } from "$lib/session";
	import {
		hydrateSecrets,
		persistSecrets,
		withBlankedKeys,
		tauriBackendAvailable
	} from "$lib/secrets";
	import { check } from "@tauri-apps/plugin-updater";
	import { ProviderError, type ChatMessage } from "$lib/providers/types";
	import { onMount } from "svelte";

	interface Props {
		settings: AppSettings;
		onClose: () => void;
	}

	let { settings, onClose }: Props = $props();
	let savedFlash = $state(false);
	let testing = $state(false);
	let testResult = $state("");
	let testError = $state("");
	let updateStatus = $state("");
	let checkingUpdate = $state(false);
	/** Per-provider "replace key" mode; otherwise a stored key shows masked. */
	let editingKey: Record<string, boolean> = $state({});
	/** Local mirror of the session module set, so eject/restore re-renders. */
	let ejectedIds: string[] = $state([]);
	const inShell = tauriBackendAvailable();

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

	async function save() {
		// Mirror keys into secret storage first; in the Tauri shell the
		// persisted settings then keep no key material at all.
		await persistSecrets(settings);
		saveSettings(inShell ? withBlankedKeys(settings) : settings);
		editingKey[settings.activeProviderId] = false;
		savedFlash = true;
		setTimeout(() => (savedFlash = false), 1500);
	}

	async function checkUpdates() {
		checkingUpdate = true;
		updateStatus = "Checking…";
		try {
			const update = await check();
			updateStatus = update
				? `Version ${update.version} is available — download it from the release page to install.`
				: "You're on the latest version.";
		} catch (error) {
			updateStatus = `Updater unavailable: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			checkingUpdate = false;
		}
	}

	onMount(() => {
		// Pull Keychain keys into memory (Tauri shell); no-op elsewhere.
		// hydrateSecrets mutates the shared proxy, which is already reactive.
		void hydrateSecrets(settings);
	});

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

<div class="panel-head">
	<h1>Settings</h1>
	<button type="button" aria-label="Close settings" title="Close settings" onclick={onClose}>
		×
	</button>
</div>

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
	<p class="note">
		{#if inShell}
			Keys stay in the macOS Keychain, never in a file. Eject unloads a key
			for this session only.
		{:else}
			Keys stay on this machine, in this app's local storage.
		{/if}
	</p>
</section>

<section aria-labelledby="defaults-heading">
	<h2 id="defaults-heading">Defaults</h2>
	<label>
		System prompt
		<textarea rows="2" bind:value={settings.systemPrompt} spellcheck="false"></textarea>
	</label>
	<fieldset>
		<legend>Thinking level (appends a deliberation hint to the system prompt)</legend>
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
				aria-checked={settings.thinkingLevel === "medium"}
				class:selected={settings.thinkingLevel === "medium"}
				onclick={() => setThinking("medium")}>Medium</button
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

<section aria-labelledby="keys-heading">
	<h2 id="keys-heading">Keyboard shortcuts</h2>
	<dl class="keys">
		<div><dt>Send</dt><dd>⌘+Enter (or ↑; faded when empty; hold ⌥ for Add +)</dd></div>
		<div><dt>New line</dt><dd>Enter</dd></div>
		<div><dt>Stage message, no reply</dt><dd>⌥+Enter (seen at the next send, in order)</dd></div>
		<div><dt>New chat</dt><dd>Ctrl+Alt+N</dd></div>
		<div><dt>Chat list show/hide</dt><dd>⌘B</dd></div>
		<div><dt>Settings show/hide</dt><dd>⌘.</dd></div>
		<div><dt>Switch model / key</dt><dd>Ctrl+Alt+← / →</dd></div>
		<div><dt>Thinking low / medium / high</dt><dd>Ctrl+Alt+↓ / ↑ (cycles)</dd></div>
		<div><dt>Hop out of the prompt</dt><dd>Ctrl+G (vim swallows the rest)</dd></div>
		<div><dt>Scroll messages</dt><dd>J / K, then I or Enter to write again</dd></div>
		<div><dt>Reading aids on/off</dt><dd>Alt+R (outside the prompt)</dd></div>
		<div><dt>Speak hovered word</dt><dd>Right-click the word</dd></div>
		<div><dt>Thoughts show/hide</dt><dd>Ctrl+O</dd></div>
		<div><dt>Translate selection</dt><dd>⌘+T (to English; feeds annotation)</dd></div>
		<div><dt>Stop voice / close menus</dt><dd>Esc (outside the prompt)</dd></div>
		<div><dt>Delete a message</dt><dd>Option-click it (or its Delete button)</dd></div>
		<div><dt>Rerun a prompt</dt><dd>Rerun button (deletes everything after; Branch keeps it)</dd></div>
	</dl>
	<h3>Vim in the prompt box</h3>
	<p class="note">
		Vim is trapped inside the prompt: type to insert, Esc for normal mode,
		Enter is a newline in either mode. Ctrl+G hops out to message scroll
		(J/K), I or Enter hops back in. The rest of vim (motions, operators,
		:commands via the vim layer) works where you left it.
	</p>
</section>

<section aria-labelledby="updates-heading">
	<h2 id="updates-heading">Updates</h2>
	<button type="button" onclick={() => void checkUpdates()} disabled={checkingUpdate}>
		{checkingUpdate ? "Checking…" : "Check for updates"}
	</button>
	{#if updateStatus}<p class="result" role="status">{updateStatus}</p>{/if}
</section>

<footer>
	<button type="button" class="primary" onclick={() => void save()}>Save</button>
	<button type="button" onclick={testConnection} disabled={testing}>
		{testing ? "Testing…" : "Test connection"}
	</button>
	{#if savedFlash}<span class="saved" role="status">Saved</span>{/if}
</footer>

{#if testResult}<p class="result" role="status">{testResult}</p>{/if}
{#if testError}<p class="error" role="alert">{testError}</p>{/if}

<style>
	.panel-head {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		margin-bottom: 0.5rem;
	}
	.panel-head h1 {
		font-size: 1.15rem;
		font-weight: 700;
		margin: 0;
	}
	.panel-head button {
		margin-left: auto;
		font-size: 1.1rem;
		line-height: 1;
		border: 1px solid #c7c7cc;
		border-radius: 8px;
		background: none;
		cursor: pointer;
		padding: 0.15rem 0.55rem;
		color: #3a3a3c;
	}
	section {
		border-top: 1px solid #e5e5ea;
		padding: 1.1rem 0;
	}
	h2 {
		font-size: 0.95rem;
		font-weight: 650;
		margin: 0 0 0.9rem;
	}
	h3 {
		font-size: 0.88rem;
		font-weight: 650;
		margin: 1.1rem 0 0.4rem;
	}
	label {
		display: block;
		font-size: 0.83rem;
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
		color: inherit;
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
		font-size: 0.83rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.key-state code {
		font-family: ui-monospace, monospace;
	}
	.key-state button {
		font-size: 0.78rem;
		border: 1px solid #c7c7cc;
		border-radius: 6px;
		background: #fff;
		cursor: pointer;
		padding: 0.2rem 0.6rem;
		color: inherit;
	}
	.provider-row,
	.segmented {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 1rem;
	}
	.provider-row button,
	.segmented button {
		padding: 0.45rem 0.9rem;
		font: inherit;
		font-size: 0.83rem;
		border: 1px solid #c7c7cc;
		border-radius: 999px;
		background: #fff;
		cursor: pointer;
		color: inherit;
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
		font-size: 0.83rem;
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
	.keys {
		margin: 0;
		display: flex;
		flex-direction: column;
	}
	.keys div {
		display: flex;
		gap: 0.8rem;
		padding: 0.35rem 0;
		border-top: 1px solid #e5e5ea;
		font-size: 0.8rem;
	}
	.keys div:first-child {
		border-top: 0;
	}
	.keys dt {
		flex: 0 0 9.5rem;
		color: #3a3a3c;
	}
	.keys dd {
		margin: 0;
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
		color: #1c1c1e;
		overflow-wrap: anywhere;
	}
	section > button {
		padding: 0.45rem 1rem;
		font: inherit;
		font-size: 0.83rem;
		border: 1px solid #c7c7cc;
		border-radius: 8px;
		background: #fff;
		cursor: pointer;
		color: inherit;
	}
	section > button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	footer {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0 1rem;
	}
	footer button {
		padding: 0.5rem 1.1rem;
		font: inherit;
		font-size: 0.88rem;
		border: 1px solid #c7c7cc;
		border-radius: 8px;
		background: #fff;
		cursor: pointer;
		color: inherit;
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
		font-size: 0.83rem;
		color: #1e7e34;
	}
	.result,
	.error {
		font-size: 0.83rem;
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
		.panel-head button {
			border-color: #48484a;
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
		.key-state button,
		section > button,
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
		.note,
		.keys dt {
			color: #98989f;
		}
		.keys div {
			border-color: #38383a;
		}
		.keys dd {
			color: #f2f2f7;
		}
		.unverified {
			background: #2c2c2e;
			color: #98989f;
		}
		.verified {
			background: #12351f;
			color: #7bd88f;
		}
		.saved {
			color: #7bd88f;
		}
		.result {
			background: #12351f;
		}
		.error {
			background: #3d1008;
			color: #ffb4a2;
		}
	}
</style>
