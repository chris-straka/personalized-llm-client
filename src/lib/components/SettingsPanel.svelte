<script lang="ts">
	import { getProviderDef, listProviders, createProvider } from "$lib/providers/registry";
	import { maskKey, type AppSettings, type ThinkingLevel } from "$lib/settings";
	import { ejectProvider, restoreProvider } from "$lib/session";
	import { hydrateSecrets, tauriBackendAvailable } from "$lib/secrets";
	import { check } from "@tauri-apps/plugin-updater";
	import {
		nativeTtsSupported,
		nativeTtsLastError,
		friendlyNativeError,
		nativeVoices,
		openVoiceSettings
	} from "$lib/nativeTts";
	import { hasQualityVoices, voicesForLang } from "$lib/voiceTiers";
	import type { NativeVoice } from "$lib/nativeTts";
	import { onMount } from "svelte";

	interface Props {
		settings: AppSettings;
		onClose: () => void;
		/** Rebuilds the prompt editor (vim is a build-time extension set). */
		onVimChange: (on: boolean) => void;
		/** Opens the shortcuts modal (owned by the page). */
		onShortcuts: () => void;
		/** Flips voice readback (stops in-flight speech when turning off). */
		onVoiceChange: (on: boolean) => void;
	}

	let { settings, onClose, onVimChange, onShortcuts, onVoiceChange }: Props = $props();
	let updateStatus = $state("");
	let checkingUpdate = $state(false);
	let modelLoading = $state(false);
	let modelError = $state("");

	/**
	 * Pull the provider's `/models` list into the Model picker's datalist.
	 * Best-effort: failures surface transiently and the field keeps working
	 * as free text.
	 */
	async function refreshModels() {
		modelError = "";
		if (!active.baseUrl.trim() || !active.apiKey.trim()) {
			modelError = "Enter a base URL and API key first.";
			setTimeout(() => (modelError = ""), 5000);
			return;
		}
		modelLoading = true;
		try {
			active.models = await createProvider(
			settings.activeProviderId,
			active,
			settings.customProviders
		).listModels();
		} catch (error) {
			modelError = error instanceof Error ? error.message : String(error);
			setTimeout(() => (modelError = ""), 5000);
		} finally {
			modelLoading = false;
		}
	}

	function maybeFetchModels() {
		if (active.apiKey.trim() && active.models.length === 0) void refreshModels();
	}
	/** Native macOS voice engine present (Tauri shell on macOS). */
	let nativeVoice = $state(false);
	/** Plain browser on a Mac: no inventory API, but download guidance applies. */
	let isMacBrowser = $state(false);
	/** A quality voice (premium/enhanced/Siri) is installed, so System voices is worth picking. */
	let qualityVoices = $state(false);
	let voiceSetupError = $state("");
	/** Inventory probe failed (bridge error, not "no voices"): keep the toggle usable. */
	let voiceLoadError = $state("");
	/** Full installed inventory behind the voice picker. */
	let installedVoices = $state<NativeVoice[]>([]);
	let voicesLoaded = $state(false);
	/** Picker options follow the Latin-script voice language field. */
	const voiceLangTag = $derived(settings.voiceLang?.trim() || "en-US");
	const voiceOptions = $derived(voicesForLang(installedVoices, voiceLangTag));
	/** Per-provider "replace key" mode; otherwise a stored key shows masked. */
	let editingKey: Record<string, boolean> = $state({});
	/** Local mirror of the session module set, so eject/restore re-renders. */
	let ejectedIds: string[] = $state([]);
	const inShell = tauriBackendAvailable();

	const allProviders = $derived(listProviders(settings.customProviders));
	const activeDef = $derived(getProviderDef(settings.activeProviderId, settings.customProviders));
	const activeCustom = $derived(
		settings.customProviders.some((p) => p.id === settings.activeProviderId)
	);
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
		maybeFetchModels();
		try {
			const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
			const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
			isMacBrowser =
				!inShell && (/\bmac/i.test(platform) || /\bmacintosh|mac os x/i.test(nav.userAgent));
		} catch {
			isMacBrowser = false;
		}
		void nativeTtsSupported().then(async (supported) => {
			nativeVoice = supported;
			// A persisted "native" choice from another machine is meaningless here.
			if (!supported) {
				if (settings.voiceEngine === "native") settings.voiceEngine = "web";
				voiceLoadError = friendlyNativeError(nativeTtsLastError() ?? "Native speech is not available.");
				return;
			}
			const installed = await nativeVoices();
			const probeError = nativeTtsLastError();
			if (probeError) {
				// The bridge failed: say so, and keep a persisted "native"
				// choice alone — an empty inventory is not evidence of no voices.
				voiceLoadError = friendlyNativeError(probeError);
				voicesLoaded = true;
				return;
			}
			qualityVoices = hasQualityVoices(installed);
			if (!qualityVoices && settings.voiceEngine === "native") settings.voiceEngine = "web";
			installedVoices = installed;
			// A picked voice that is no longer installed falls back to auto.
			if (settings.nativeVoiceId && !installed.some((v) => v.id === settings.nativeVoiceId)) {
				settings.nativeVoiceId = null;
			}
			voicesLoaded = true;
		});
	});

	async function openVoiceSetup() {
		voiceSetupError = "";
		try {
			// Own Rust command (`open` CLI): no plugin scope to misconfigure.
			await openVoiceSettings();
		} catch (error) {
			// Persistent (no auto-clear): a failure must stay readable long
			// enough to copy. The manual path is in the note above.
			console.warn("Could not open System Settings:", error);
			voiceSetupError = "x";
		}
	}

	function switchProvider(id: string) {
		settings.activeProviderId = id;
		maybeFetchModels();
	}

	let customName = $state("");
	let customBaseUrl = $state("");
	let customModel = $state("");
	let customError = $state("");

	/** Cline-style: any OpenAI-compatible endpoint becomes a provider. */
	function addCustomProvider(): void {
		customError = "";
		const label = customName.trim();
		const baseUrl = customBaseUrl.trim().replace(/\/+$/, "");
		const model = customModel.trim();
		if (!label) {
			customError = "Give the provider a name.";
			return;
		}
		if (!/^https?:\/\/.+/i.test(baseUrl)) {
			customError = "Base URL must start with http(s)://.";
			return;
		}
		if (!model) {
			customError = "Enter a model id.";
			return;
		}
		const slug =
			label
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "") || "provider";
		const taken = new Set(allProviders.map((p) => p.id));
		let id = `custom-${slug}`;
		let n = 2;
		while (taken.has(id)) id = `custom-${slug}-${n++}`;
		settings.customProviders = [
			...settings.customProviders,
			{ id, label, defaultBaseUrl: baseUrl, defaultModel: model, keyHint: "API key" }
		];
		settings.providers[id] = { baseUrl, apiKey: "", model, models: [] };
		customName = "";
		customBaseUrl = "";
		customModel = "";
		switchProvider(id);
	}

	function removeCustomProvider(): void {
		const id = settings.activeProviderId;
		if (!settings.customProviders.some((p) => p.id === id)) return;
		settings.customProviders = settings.customProviders.filter((p) => p.id !== id);
		delete settings.providers[id];
		switchProvider("muse");
	}

	function setThinking(level: ThinkingLevel) {
		settings.thinkingLevel = level;
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
		{#each allProviders as def (def.id)}
			<button
				type="button"
				role="radio"
				aria-checked={settings.activeProviderId === def.id}
				class:selected={settings.activeProviderId === def.id}
				onclick={() => switchProvider(def.id)}
			>
				{def.label}
			</button>
		{/each}
	</div>
	{#if activeCustom}
		<p class="note">
			Custom provider.
			<button type="button" onclick={removeCustomProvider}>Remove {activeDef.label}</button>
		</p>
	{/if}
	<details class="note provider-add">
		<summary>Add a custom provider…</summary>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				addCustomProvider();
			}}
		>
			<label>
				Name
				<input
					type="text"
					required
					bind:value={customName}
					oninput={() => (customError = "")}
					placeholder="e.g. Kimi"
					autocomplete="off"
					spellcheck="false"
				/>
			</label>
			<label>
				Base URL
				<input
					type="url"
					required
					bind:value={customBaseUrl}
					oninput={() => (customError = "")}
					placeholder="https://api.example.com/v1"
					autocomplete="off"
					spellcheck="false"
				/>
			</label>
			<label>
				Model
				<input
					type="text"
					required
					bind:value={customModel}
					oninput={() => (customError = "")}
					placeholder="model-id"
					autocomplete="off"
					spellcheck="false"
				/>
			</label>
			{#if customError}<span class="hint" role="alert">{customError}</span>{/if}
			<button type="submit">Add provider</button>
		</form>
	</details>

	<label>
		Base URL
		<input type="url" bind:value={active.baseUrl} autocomplete="off" spellcheck="false" />
	</label>
	<label>
		Model
		<span class="model-row">
			<input
				type="text"
				list="model-list"
				bind:value={active.model}
				autocomplete="off"
				spellcheck="false"
			/>
			<button
				type="button"
				title="Fetch the model list from this base URL"
				disabled={modelLoading}
				onclick={() => void refreshModels()}
			>
				{modelLoading ? "…" : "Refresh"}
			</button>
		</span>
		<datalist id="model-list">
			{#each active.models as id (id)}<option value={id}></option>{/each}
		</datalist>
		{#if modelError}<span class="hint" role="alert">{modelError}</span>{/if}
	</label>
	{#if showKeyField}
		<label>
			API key <span class="hint">{activeDef.keyHint}</span>
			<input
				type="password"
				bind:value={active.apiKey}
				autocomplete="off"
				spellcheck="false"
				onblur={() => (editingKey[settings.activeProviderId] = false)}
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
		Reading aids
		<span class="key-hint" aria-hidden="true">⇧⌘A</span>
	</label>
	<label class="check">
		<input
			type="checkbox"
			checked={settings.vim}
			onchange={(e) => onVimChange(e.currentTarget.checked)}
		/>
		Vim motions in the prompt box
		<span class="key-hint" aria-hidden="true">Ctrl+⌥+V</span>
	</label>
	<label class="check">
		<input
			type="checkbox"
			checked={settings.voice}
			onchange={(e) => onVoiceChange(e.currentTarget.checked)}
		/>
		Voice readback
		<span class="key-hint" aria-hidden="true">Ctrl+⌥+S</span>
	</label>
	{#if nativeVoice}
		<fieldset>
			<legend>Voice engine</legend>
			<div class="segmented" role="radiogroup" aria-label="Voice engine">
				<button
					type="button"
					role="radio"
					aria-checked={settings.voiceEngine === "native"}
					class:selected={settings.voiceEngine === "native"}
					disabled={!qualityVoices && !voiceLoadError}
					title={qualityVoices || voiceLoadError
						? "Read replies with macOS system voices"
						: "No premium, enhanced, or Siri voices installed yet — install some first"}
					onclick={() => (settings.voiceEngine = "native")}>System voices</button
				>
				<button
					type="button"
					role="radio"
					aria-checked={settings.voiceEngine === "web"}
					class:selected={settings.voiceEngine === "web"}
					onclick={() => (settings.voiceEngine = "web")}>Web voices</button
				>
			</div>
			<p class="note">
				System voices use macOS speech and sound much better. To install
				system voices, go to
				<button type="button" title="Open Accessibility settings" onclick={openVoiceSetup}>a11y</button>
				then Read &amp; Speak → System Voice -> ⓘ to install new
				system voices.
				{#if voiceSetupError}<span role="alert"> (couldn't open it automatically)</span>{/if}
			</p>
			{#if voiceLoadError}
				<p class="note" role="alert">Couldn't load the voice list: {voiceLoadError}</p>
			{/if}
			{#if !voiceLoadError}
				{#if voiceOptions.length > 0}
					<!-- Plain div + aria, not a <label>: label clicks yank focus
					into the select, which fights selecting this text. -->
					<div class="voice-pick">
						<span class="voice-pick-label" id="system-voice-label"
							>System voice ({voiceLangTag})</span
						>
						<select
							value={settings.nativeVoiceId ?? ""}
							aria-labelledby="system-voice-label"
							onchange={(e) => {
								settings.nativeVoiceId = e.currentTarget.value || null;
							}}
						>
							<option value="">Auto (your System Voice, else best)</option>
							{#each voiceOptions as option (option.id)}
								<option value={option.id}>
									{option.name} ·
									{option.lang.toLowerCase() === voiceLangTag.toLowerCase()
										? option.tier
										: `${option.lang} · ${option.tier}`}
								</option>
							{/each}
						</select>
					</div>
				{:else if voicesLoaded}
					<p class="note">
						No premium or enhanced voices installed for {voiceLangTag} — Auto uses your
						System Voice.
					</p>
				{/if}
			{/if}
		</fieldset>
		{:else if inShell && voiceLoadError}
			<fieldset>
				<legend>Voice engine</legend>
				<p class="note" role="alert">System voices are unavailable: {voiceLoadError}</p>
			</fieldset>
		{:else if isMacBrowser}
			<fieldset>
				<legend>Voice engine</legend>
				<p class="note">
					This browser preview can only use web voices — the
					downloaded-voice inventory lives in the Mac app. To download
					more voices on your Mac: System Settings → Accessibility,
					then Read &amp; Speak → System Voice → Manage Voices.
				</p>
			</fieldset>
	{/if}
	<!-- Plain div + aria, not a <label>: label clicks yank focus into the
		field, which fights selecting this text. -->
	<div class="field">
		<span id="voice-lang-label">Voice language</span>
		<input
			type="text"
			aria-labelledby="voice-lang-label"
			bind:value={settings.voiceLang}
			placeholder="en-US"
			autocomplete="off"
			spellcheck="false"
		/>
	</div>
	<label>
		Text size <span class="hint">(percent · messages and prompt only)</span>
		<span class="font-row">
			<input
				type="range"
				min="80"
				max="140"
				step="5"
				value={Math.round(settings.fontScale * 100)}
				aria-label="Text size percent"
				oninput={(e) => {
					settings.fontScale = Number(e.currentTarget.value) / 100;
				}}
			/>
			<output>{Math.round(settings.fontScale * 100)}%</output>
		</span>
	</label>
</section>

<section aria-labelledby="keys-heading">
	<h2 id="keys-heading">Keyboard shortcuts</h2>
	<button type="button" onclick={onShortcuts}>
		Show all shortcuts <span class="key-hint" aria-hidden="true">⇧⌘/</span>
	</button>
</section>

<section aria-labelledby="updates-heading">
	<h2 id="updates-heading">Updates</h2>
	<button type="button" onclick={() => void checkUpdates()} disabled={checkingUpdate}>
		{checkingUpdate ? "Checking…" : "Check for updates"}
	</button>
	{#if updateStatus}<p class="result" role="status">{updateStatus}</p>{/if}
</section>

<style>
	.panel-head {
		display: flex;
		align-items: center;
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
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			color 0.15s ease;
	}
	.panel-head button:hover {
		border-color: #1c1c1e;
	}
	input[type="checkbox"] {
		cursor: pointer;
	}
	.font-row {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		margin-top: 0.3rem;
	}
	.font-row input[type="range"] {
		flex: 1;
		min-width: 0;
		margin-top: 0;
		padding: 0;
		accent-color: #1c1c1e;
		cursor: pointer;
	}
	.font-row output {
		font-size: 0.83rem;
		min-width: 3rem;
		text-align: right;
		font-variant-numeric: tabular-nums;
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
	.key-hint {
		font-size: 0.68rem;
		opacity: 0.75;
		border: 1px solid currentColor;
		border-radius: 4px;
		padding: 0 0.3rem;
		margin-left: 0.35rem;
		transform: translateY(-0.1em);
		white-space: nowrap;
	}
	label,
	.field,
	.voice-pick {
		display: block;
		font-size: 0.83rem;
		font-weight: 550;
		margin-bottom: 0.9rem;
	}
	/* The picker follows the install note: breathing room on top. */
	.voice-pick {
		margin-top: 0.9rem;
	}
	.voice-pick-label {
		display: block;
		margin-bottom: 0.35rem;
	}
	details.note summary {
		cursor: pointer;
	}
	details.note {
		margin-top: 0.55rem;
	}
	details.note p {
		margin: 0.35rem 0 0;
	}
	/* Element-qualified: the `.note` margin shorthand below ties at
	   class specificity but comes later, so a bare class loses and the
	   gap collapses to zero. */
	details.note.provider-add {
		margin-bottom: 1rem;
	}
	.provider-add form {
		margin-top: 0.75rem;
	}
	.provider-add form button {
		margin-top: 0.5rem;
	}
	input[type="url"],
	input[type="text"],
	input[type="password"],
	select,
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
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease;
	}
	input[type="url"]:hover,
	input[type="text"]:hover,
	input[type="password"]:hover,
	select:hover,
	textarea:hover {
		border-color: #8e8e93;
	}
	input[type="url"]:focus,
	input[type="text"]:focus,
	input[type="password"]:focus,
	select:focus,
	textarea:focus {
		border-color: #1c1c1e;
		outline: none;
	}
	.hint {
		font-weight: 400;
		color: #6e6e73;
		overflow-wrap: anywhere;
	}
	.model-row {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.3rem;
	}
	.model-row input {
		margin-top: 0;
		flex: 1;
		min-width: 0;
	}
	.model-row button {
		flex-shrink: 0;
		/* Fixed floor: "…" must not reflow the row while refreshing. */
		min-width: 4.6rem;
		text-align: center;
		font-size: 0.78rem;
		border: 1px solid #c7c7cc;
		border-radius: 8px;
		background: #fff;
		cursor: pointer;
		padding: 0.2rem 0.7rem;
		color: inherit;
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			color 0.15s ease,
			opacity 0.15s ease;
	}
	.model-row button:not(:disabled):hover {
		border-color: #1c1c1e;
	}
	.model-row button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.note {
		font-size: 0.8rem;
		color: #6e6e73;
		margin: 0.2rem 0 0;
		/* Long error strings must wrap, never shove the panel sideways. */
		overflow-wrap: anywhere;
	}
	.note button {
		font: inherit;
		color: inherit;
		text-decoration: underline;
		text-underline-offset: 2px;
		background: none;
		border: 0;
		cursor: pointer;
		padding: 0;
		transition: color 0.15s ease;
	}
	.note button:hover {
		color: #1c1c1e;
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
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			color 0.15s ease;
	}
	.key-state button:hover {
		border-color: #1c1c1e;
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
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			color 0.15s ease,
			opacity 0.15s ease;
	}
	.provider-row button.selected,
	.segmented button.selected {
		border-color: #1c1c1e;
		background: #1c1c1e;
		color: #fff;
	}
	.provider-row button:not(.selected):not(:disabled):hover,
	.segmented button:not(.selected):not(:disabled):hover {
		border-color: #1c1c1e;
	}
	.segmented button:disabled {
		background: #f3f3f4;
		border-color: #e5e5ea;
		color: #aeaeb2;
		cursor: not-allowed;
		opacity: 1;
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
		cursor: pointer;
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
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			color 0.15s ease,
			opacity 0.15s ease;
	}
	section > button:not(:disabled):hover {
		border-color: #1c1c1e;
	}
	section > button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.result {
		font-size: 0.83rem;
		padding: 0.6rem 0.8rem;
		border-radius: 8px;
		background: #e6f4ea;
		overflow-wrap: anywhere;
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
		select,
		textarea,
		.provider-row button,
		.segmented button,
		.key-state button,
		section > button {
			background: #1c1c1e;
			border-color: #48484a;
			color: #f2f2f7;
		}
		.panel-head button:hover,
		.provider-row button:not(.selected):not(:disabled):hover,
		.segmented button:not(.selected):not(:disabled):hover,
		.key-state button:hover,
		section > button:not(:disabled):hover,
		.note button:hover {
			border-color: #aeaeb2;
			color: #f2f2f7;
		}
		input[type="url"]:hover,
		input[type="text"]:hover,
		input[type="password"]:hover,
		select:hover,
		textarea:hover {
			border-color: #636366;
		}
		input[type="url"]:focus,
		input[type="text"]:focus,
		input[type="password"]:focus,
		select:focus,
		textarea:focus {
			border-color: #aeaeb2;
		}
		.font-row input[type="range"] {
			accent-color: #f2f2f7;
		}
		.model-row button {
			background: #1c1c1e;
			border-color: #48484a;
			color: #f2f2f7;
		}
		.model-row button:not(:disabled):hover {
			border-color: #aeaeb2;
		}
		.provider-row button.selected,
		.segmented button.selected {
			background: #f2f2f7;
			border-color: #f2f2f7;
			color: #1c1c1e;
		}
		.segmented button:disabled {
			background: #2c2c2e;
			border-color: #38383a;
			color: #636366;
		}
		.hint,
		.note {
			color: #98989f;
		}
		.result {
			background: #12351f;
		}
	}
</style>
