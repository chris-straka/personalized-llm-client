<script lang="ts">
	import { getProviderDef, listProviders, createProvider } from "$lib/providers/registry";
	import { maskKey, activeProviderSettings, type AppSettings } from "$lib/settings";
	import { thinkingFor, resolveThinkingId } from "$lib/providers/thinking";
	import { ejectProvider, restoreProvider } from "$lib/session";
	import { hydrateSecrets, tauriBackendAvailable } from "$lib/secrets";
	import { getCurrentWindow } from "@tauri-apps/api/window";
	import { check } from "@tauri-apps/plugin-updater";
	import {
		nativeTtsSupported,
		nativeTtsLastError,
		friendlyNativeError,
		nativeVoices,
		openVoiceSettings
	} from "$lib/nativeTts";
	import { hasQualityVoices, voicesForLang, allVoicesForLang, autoVoiceForLang } from "$lib/voiceTiers";
	import type { NativeVoice } from "$lib/nativeTts";
	import { onMount } from "svelte";

	interface Props {
		settings: AppSettings;
		onClose: () => void;
		/** Opens the shortcuts modal (owned by the page). */
		onShortcuts: () => void;
		/** Active-chat token tally shown right of the heading. */
		tokensLabel?: string | null;
		/** Tooltip for the tally (exact total). */
		tokensTitle?: string | null;
		/** Phone UI: hover doesn't exist, so the hover toggles read as a note. */
		androidUI?: boolean;
	}

	let {
		settings,
		onClose,
		onShortcuts,
		tokensLabel = null,
		tokensTitle = null,
		androidUI = false
	}: Props = $props();
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
	/** Android picker: no quality gate — Android has no premium/enhanced tiers. */
	const androidVoiceOptions = $derived(allVoicesForLang(installedVoices, voiceLangTag));
	/** The voice Auto would use next for the tag above (label only —
	the bridge stays authoritative at speak time). */
	const autoVoice = $derived(autoVoiceForLang(installedVoices, voiceLangTag, settings.nativeVoiceId));
	/* No appended category: Apple's registry names already carry it
	("Ava (Premium)"), and Siri's have none to repeat. */
	const autoLabel = $derived(autoVoice ? `Auto - ${autoVoice.name}` : "Auto");
	// A picked voice never reads another language: when the tag moves on
	// from the saved pick, fall back to Auto instead of a blank field.
	$effect(() => {
		const options = androidUI ? androidVoiceOptions : voiceOptions;
		if (settings.nativeVoiceId && !options.some((v) => v.id === settings.nativeVoiceId)) {
			settings.nativeVoiceId = null;
		}
	});
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
	const active = $derived(activeProviderSettings(settings));
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
			// Premium/enhanced/Siri tiers are macOS-only: Android voices
			// never pass the quality gate, so it must not force web there.
			if (!androidUI && !qualityVoices && settings.voiceEngine === "native")
				settings.voiceEngine = "web";
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

	/** This model's thinking dial (native knob or prompt hints); hidden
	 * when a single level exists. Recomputes from the model field, so a
	 * newer/cheaper model id picks up its own dial as soon as it is typed. */
	const thinkingSupport = $derived(thinkingFor(settings.activeProviderId, active.model));
	const thinkingId = $derived(
		resolveThinkingId(thinkingSupport, settings.thinking[settings.activeProviderId])
	);
	function setThinking(id: string) {
		settings.thinking = { ...settings.thinking, [settings.activeProviderId]: id };
	}

	/**
	 * The header doubles as the window drag strip and the close target:
	 * mousedown starts a native drag (Tauri shell), while a plain click
	 * (no real pointer travel) closes the panel. The travel check keeps
	 * a drag that ends over the header from closing settings. Travel is
	 * measured in screen coordinates: during a native drag the window
	 * follows the cursor, so client coordinates barely move and would
	 * misread every drag as a click.
	 */
	let headDown: { x: number; y: number } | null = null;
	function dragHead(event: MouseEvent): void {
		if (event.button !== 0) return;
		headDown = { x: event.screenX, y: event.screenY };
		if (!tauriBackendAvailable()) return;
		try {
			getCurrentWindow().startDragging().catch((error: unknown) => {
				console.warn(
					"Window drag failed:",
					error instanceof Error ? error.message : String(error)
				);
			});
		} catch (error) {
			console.warn(
				"Window drag failed:",
				error instanceof Error ? error.message : String(error)
			);
		}
	}
	function closeFromHead(event: MouseEvent): void {
		const down = headDown;
		headDown = null;
		if (down && Math.hypot(event.screenX - down.x, event.screenY - down.y) > 5) return;
		onClose();
	}
</script>

<div
	class="panel-head"
	data-tauri-drag-region
	role="button"
	tabindex="0"
	aria-label="Close settings"
	title="Close settings"
	onmousedown={dragHead}
	onclick={closeFromHead}
	onkeydown={(e) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			onClose();
		}
	}}
>
	<h1>Settings</h1>
	{#if tokensLabel}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<span
			class="head-tokens"
			title={tokensTitle}
			onclick={(event) => event.stopPropagation()}
		>
			{tokensLabel}
		</span>
	{/if}
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
		{#if inShell && !androidUI}
			Keys stay in the macOS Keychain, never in a file. Eject unloads a key
			for this session only.
		{:else if inShell}
			Keys stay in this app's secured storage, never in a file. Eject
			unloads a key for this session only.
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
	{#if thinkingSupport.options.length > 1}
		<fieldset>
			<legend
				>Thinking level ({thinkingSupport.native ? "sent to the model" : "adds to system prompt"})</legend
			>
			<div class="segmented" role="radiogroup" aria-label="Thinking level">
				{#each thinkingSupport.options as option (option.id)}
					<button
						type="button"
						role="radio"
						aria-checked={thinkingId === option.id}
						class:selected={thinkingId === option.id}
						onclick={() => setThinking(option.id)}>{option.label}</button
					>
				{/each}
			</div>
		</fieldset>
	{/if}
	{#if androidUI}
		<fieldset>
			<legend>Messages</legend>
			<label class="check">
				<input type="checkbox" bind:checked={settings.hideButtons} />
				Hide message buttons until tapped
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.ownBubble} />
				Enable background on my messages
			</label>
		</fieldset>
	{:else}
		<label class="check">
			<input type="checkbox" bind:checked={settings.ownBubble} />
			Enable background on my messages
		</label>
	{/if}
	<!-- One row for both hover toggles: the label names the behavior once,
	each box names whose buttons it covers. Touch has no hover, so the
	phone hides the whole row. -->
	{#if !androidUI}
		<fieldset class="hover-row">
			<legend>Message buttons only on hover for…</legend>
			<label class="check">
				<input type="checkbox" bind:checked={settings.hoverUserActions} />
				My messages
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={settings.hoverAssistantActions} />
				AI messages
			</label>
		</fieldset>
	{/if}
	{#if nativeVoice && androidUI}
		<fieldset class="voice-engine">
			<legend>Voice engine</legend>
			<div class="segmented" role="radiogroup" aria-label="Voice engine">
				<button
					type="button"
					role="radio"
					aria-checked={settings.voiceEngine === "native"}
					class:selected={settings.voiceEngine === "native"}
					title="Read replies with device voices"
					onclick={() => (settings.voiceEngine = "native")}>System voices</button
				>
			</div>
			{#if voiceLoadError}
				<p class="note" role="alert">Couldn't load the voice list: {voiceLoadError}</p>
			{/if}
			{#if !voiceLoadError}
				{#if androidVoiceOptions.length > 0}
					<div class="voice-pick">
						<span class="voice-pick-label" id="system-voice-label-android"
							>System voice ({voiceLangTag})</span
						>
						<select
							value={settings.nativeVoiceId ?? ""}
							aria-labelledby="system-voice-label-android"
							onchange={(e) => {
								settings.nativeVoiceId = e.currentTarget.value || null;
							}}
						>
							<option value="">{autoLabel}</option>
							{#each androidVoiceOptions as option (option.id)}
								<option value={option.id}>
									{option.name}{option.lang.toLowerCase() === voiceLangTag.toLowerCase()
										? ""
										: ` · ${option.lang}`}
								</option>
							{/each}
						</select>
					</div>
				{:else if voicesLoaded}
					<p class="note">
						No voices installed for {voiceLangTag} — Auto uses your
						system default.
					</p>
				{/if}
			{/if}
		</fieldset>
	{/if}
	{#if nativeVoice && !androidUI}
		<fieldset class="voice-engine">
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
				→ Read &amp; Speak → System Voice → ⓘ to install new system voices.
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
							<option value="">{autoLabel}</option>
							{#each voiceOptions as option (option.id)}
								<option value={option.id}>
									{option.name}{option.lang.toLowerCase() === voiceLangTag.toLowerCase()
										? ""
										: ` · ${option.lang}`}
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
		{:else if inShell && voiceLoadError && !androidUI}
			<fieldset>
				<legend>Voice engine</legend>
				<p class="note" role="alert">System voices are unavailable: {voiceLoadError}</p>
			</fieldset>
		{:else if isMacBrowser && !androidUI}
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
			onchange={() => {
				// A typed locale is deliberate: restarts keep it.
				settings.voiceLangPinned = true;
			}}
		/>
	</div>
	<label>
		Text Size
		<span class="font-row">
			<input
				type="range"
				min="80"
				max="200"
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

<section aria-labelledby="appearance-heading">
	<h2 id="appearance-heading">Appearance</h2>
	<fieldset>
		<legend>Color scheme</legend>
		<div class="segmented" role="radiogroup" aria-label="Color scheme">
			<button
				type="button"
				role="radio"
				aria-checked={settings.theme === "system"}
				class:selected={settings.theme === "system"}
				title="Follow the system appearance"
				onclick={() => (settings.theme = "system")}>System</button
			>
			<button
				type="button"
				role="radio"
				aria-checked={settings.theme === "light"}
				class:selected={settings.theme === "light"}
				title="Always light"
				onclick={() => (settings.theme = "light")}>Light</button
			>
			<button
				type="button"
				role="radio"
				aria-checked={settings.theme === "dark"}
				class:selected={settings.theme === "dark"}
				title="Always dark"
				onclick={() => (settings.theme = "dark")}>Dark</button
			>
		</div>
	</fieldset>
</section>

<div class="keys-updates">
	<section aria-labelledby="keys-heading">
		<h2 id="keys-heading">{androidUI ? "Touch gestures" : "Keyboard shortcuts"}</h2>
		<button type="button" onclick={onShortcuts}>
			Show all {androidUI ? "gestures" : "shortcuts"}
			{#if !androidUI}<span class="key-hint" aria-hidden="true">⇧⌘/</span>{/if}
		</button>
	</section>

	<section aria-labelledby="updates-heading">
		<h2 id="updates-heading">Updates</h2>
		<button type="button" onclick={() => void checkUpdates()} disabled={checkingUpdate}>
			{checkingUpdate ? "Checking…" : "Check for updates"}
		</button>
		{#if updateStatus}<p class="result" role="status">{updateStatus}</p>{/if}
	</section>
</div>

<style>
	/* The header is the close target and the window drag strip:
	chrome, not content — no text selection for the native drag
	region to fight over. Negative margins stretch it over the
	aside's own padding so the strip reaches the panel's top edge,
	and the gap down to the divider is padding (clickable, part of
	the header) rather than margin (clicks would fall through to
	the aside and drag nothing). Values mirror .settings-panel
	padding in +page.svelte. */
	.panel-head {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin: -1.2rem -0.7rem 0;
		padding: 1.2rem 0.7rem 0.5rem;
		/* Default arrow like the main chat top bar: the whole strip
		closes on click, so no pointer finger. Buttons keep their own. */
		cursor: default;
		user-select: none;
		-webkit-user-select: none;
	}
	.panel-head h1 {
		font-size: 1.15rem;
		font-weight: 700;
		margin: 0;
	}
	/* Active-chat tally right of the heading: quiet and copyable, and
	clicking it must not close the panel like the rest of the strip. */
	.head-tokens {
		margin-left: auto;
		font-size: 0.75rem;
		color: #6e6e73;
		white-space: nowrap;
		user-select: text;
		-webkit-user-select: text;
		cursor: text;
	}
	/* Dark theme, gated on the resolved scheme (<html data-theme>)
	instead of the OS query, so the settings switch can pin it. */
	:global(html[data-theme="dark"]) .head-tokens {
		color: #98989f;
	}
	.panel-head:focus-visible {
		outline: 2px solid #1c1c1e;
		outline-offset: 2px;
		border-radius: 4px;
	}
	input[type="checkbox"] {
		cursor: pointer;
		transition: box-shadow 0.15s ease;
	}
	input[type="checkbox"]:hover {
		box-shadow: 0 0 0 3px rgba(142, 142, 147, 0.45);
	}
	.font-row {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		margin-top: 0.55rem;
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
	/* Touch gestures and Updates form a 2x2 grid: headings share the
	top row, buttons share the row beneath. Sections go display:contents
	so their children place directly on the grid. */
	.keys-updates {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.6rem 1.5rem;
		align-items: center;
		border-top: 1px solid #e5e5ea;
		padding: 1.1rem 0;
	}
	.keys-updates > section {
		display: contents;
	}
	.keys-updates > section:first-of-type > h2 {
		grid-area: 1 / 1;
	}
	.keys-updates > section:first-of-type > button {
		grid-area: 2 / 1;
		justify-self: start;
	}
	.keys-updates > section:last-of-type > h2 {
		grid-area: 1 / 2;
	}
	.keys-updates > section:last-of-type > button {
		grid-area: 2 / 2;
		justify-self: start;
	}
	.keys-updates h2 {
		margin: 0;
	}
	.keys-updates .result {
		grid-area: 3 / 2;
		margin: 0;
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
	/* The picker hangs below the install note with room to breathe, then
	hands off tightly to Voice language (the fieldset adds its own 0.9rem). */
	.voice-pick {
		margin-top: 0.9rem;
		margin-bottom: 0.4rem;
	}
	.voice-pick-label {
		display: block;
		margin-bottom: 0.35rem;
	}
	/* Native select chrome (Aqua in the shell) sizes itself, so the
	picker would never match the text field: draw it as a twin with a
	chevron in the project's line-icon style instead. */
	.voice-pick select {
		appearance: none;
		-webkit-appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236e6e73' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 0.7rem center;
		padding-right: 2rem;
		cursor: pointer;
	}
	details.note summary {
		cursor: pointer;
	}
	details.note {
		margin-top: 0.55rem;
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
		padding: 0.3rem 0.65rem;
		font: inherit;
		font-size: 0.78rem;
		white-space: nowrap;
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
	/* The voice engine block carries the tallest stack (segmented + note
	+ picker): a breath more room before Voice language. */
	.voice-engine {
		margin-bottom: 1.2rem;
	}
	/* Hover toggles share one legend row instead of repeating the label. */
	.hover-row {
		display: flex;
		gap: 1.2rem;
	}
	.hover-row legend {
		margin-bottom: 0.3rem;
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
	/* Dark theme, gated on the resolved scheme (<html data-theme>)
	instead of the OS query, so the settings switch can pin it. */
	:global(html[data-theme="dark"]) .panel-head:focus-visible {
		outline-color: #aeaeb2;
	}
	:global(html[data-theme="dark"]) section {
		border-color: #38383a;
	}
	:global(html[data-theme="dark"]) input[type="url"],
	:global(html[data-theme="dark"]) input[type="text"],
	:global(html[data-theme="dark"]) input[type="password"],
	:global(html[data-theme="dark"]) select,
	:global(html[data-theme="dark"]) textarea,
	:global(html[data-theme="dark"]) .provider-row button,
	:global(html[data-theme="dark"]) .segmented button,
	:global(html[data-theme="dark"]) .key-state button,
	:global(html[data-theme="dark"]) section > button {
		background: #1c1c1e;
		border-color: #48484a;
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .provider-row button:not(.selected):not(:disabled):hover,
	:global(html[data-theme="dark"]) .segmented button:not(.selected):not(:disabled):hover,
	:global(html[data-theme="dark"]) .key-state button:hover,
	:global(html[data-theme="dark"]) section > button:not(:disabled):hover,
	:global(html[data-theme="dark"]) .note button:hover {
		border-color: #aeaeb2;
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) input[type="url"]:hover,
	:global(html[data-theme="dark"]) input[type="text"]:hover,
	:global(html[data-theme="dark"]) input[type="password"]:hover,
	:global(html[data-theme="dark"]) select:hover,
	:global(html[data-theme="dark"]) textarea:hover {
		border-color: #636366;
	}
	:global(html[data-theme="dark"]) .voice-pick select {
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23aeaeb2' stroke-width='1.6' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		/* The dark field `background` shorthand above resets repeat and
		position: re-assert or the 10px chevron tiles into zigzag. */
		background-repeat: no-repeat;
		background-position: right 0.7rem center;
	}
	:global(html[data-theme="dark"]) input[type="url"]:focus,
	:global(html[data-theme="dark"]) input[type="text"]:focus,
	:global(html[data-theme="dark"]) input[type="password"]:focus,
	:global(html[data-theme="dark"]) select:focus,
	:global(html[data-theme="dark"]) textarea:focus {
		border-color: #aeaeb2;
	}
	:global(html[data-theme="dark"]) .font-row input[type="range"] {
		accent-color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .model-row button {
		background: #1c1c1e;
		border-color: #48484a;
		color: #f2f2f7;
	}
	:global(html[data-theme="dark"]) .model-row button:not(:disabled):hover {
		border-color: #aeaeb2;
	}
	:global(html[data-theme="dark"]) .provider-row button.selected,
	:global(html[data-theme="dark"]) .segmented button.selected {
		background: #f2f2f7;
		border-color: #f2f2f7;
		color: #1c1c1e;
	}
	:global(html[data-theme="dark"]) .segmented button:disabled {
		background: #2c2c2e;
		border-color: #38383a;
		color: #636366;
	}
	:global(html[data-theme="dark"]) .hint,
	:global(html[data-theme="dark"]) .note {
		color: #98989f;
	}
	:global(html[data-theme="dark"]) .result {
		background: #12351f;
	}
</style>
