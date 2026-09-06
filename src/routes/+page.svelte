<script lang="ts">
	import { onMount } from "svelte";
	import { resolve } from "$app/paths";
	import {
		createChatState,
		activeChat,
		newChat,
		selectChat,
		deleteChat,
		deleteAllChats,
		deleteMessage,
		pinMessage,
		unpinMessage,
		branchFrom,
		dismissFailedAssistant,
		truncateToMessage,
		resendLast,
		tokenTotal,
		waypoints,
		sendMessage
	} from "$lib/chat";
	import { loadSettings, saveSettings } from "$lib/settings";
	import { PROVIDERS, createProvider, getProviderDef } from "$lib/providers/registry";
	import { MockProvider, mockProviderEnabled } from "$lib/providers/mock";
	import { createPromptEditor, type PromptEditor, type SubmitKind } from "$lib/editor";
	import { isEjected } from "$lib/session";
	import type { ChatProvider } from "$lib/providers/types";

	let chatState = $state(createChatState());
	let settings = $state(loadSettings());
	let editor: PromptEditor | null = $state(null);
	let promptEl: HTMLElement | undefined = $state();
	let scrollBox: HTMLElement | undefined = $state();
	let focusMode: "edit" | "scroll" = $state("edit");
	let selectedIdx = $state(-1);
	let missingKey = $state(false);

	const useMock = mockProviderEnabled();
	const chat = $derived(activeChat(chatState));
	const providerLabel = $derived(
		useMock ? "mock" : getProviderDef(settings.activeProviderId).label
	);
	const total = $derived(tokenTotal(chatState));
	const points = $derived(waypoints(chatState));

	function persistSettings() {
		saveSettings(settings);
	}

	function resolveProvider(): ChatProvider | null {
		if (useMock) return new MockProvider();
		if (isEjected(settings.activeProviderId)) return null;
		const conf = settings.providers[settings.activeProviderId];
		if (!conf?.apiKey.trim()) return null;
		return createProvider(settings.activeProviderId, conf);
	}

	async function doSend(includePins: boolean) {
		const provider = resolveProvider();
		if (!provider) {
			missingKey = true;
			return;
		}
		missingKey = false;
		focusMode = "edit";
		await sendMessage(chatState, provider, settings.systemPrompt, editor?.getText() ?? "", {
			includePins
		});
		editor?.clear();
		scrollToBottom();
	}

	async function resend() {
		const provider = resolveProvider();
		if (!provider) {
			missingKey = true;
			return;
		}
		missingKey = false;
		await resendLast(chatState, provider, settings.systemPrompt);
		scrollToBottom();
	}

	function onSubmit(kind: SubmitKind) {
		if (kind === "send") void doSend(false);
		else if (kind === "run-pins") void doSend(true);
		else {
			pinMessage(chatState, editor?.getText() ?? "");
			editor?.clear();
		}
	}

	function retryFailed() {
		dismissFailedAssistant(chatState);
		void resend();
	}

	function rerunFrom(index: number) {
		truncateToMessage(chatState, index);
		void resend();
	}

	function scrollToBottom() {
		scrollBox?.scrollTo({ top: scrollBox.scrollHeight });
	}

	function jumpTo(index: number) {
		selectedIdx = index;
		document.getElementById(`msg-${index}`)?.scrollIntoView({ block: "start" });
	}

	function enterScrollMode() {
		focusMode = "scroll";
		if (selectedIdx < 0 && chat.messages.length > 0) {
			selectedIdx = chat.messages.length - 1;
		}
	}

	function enterEditMode() {
		focusMode = "edit";
		editor?.focus();
	}

	function cycleProvider(direction: 1 | -1) {
		const ids = PROVIDERS.map((p) => p.id);
		const next = (ids.indexOf(settings.activeProviderId) + direction + ids.length) % ids.length;
		settings.activeProviderId = ids[next];
		persistSettings();
	}

	function cycleThinking(direction: 1 | -1) {
		settings.thinkingLevel = direction === 1 ? "high" : "low";
		persistSettings();
	}

	function chatLabel(createdAt: number, count: number): string {
		const date = new Date(createdAt);
		const today = new Date();
		const sameDay = date.toDateString() === today.toDateString();
		const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
		const day = sameDay ? "Today" : date.toLocaleDateString([], { month: "short", day: "numeric" });
		return `${day} ${time} · ${count} msg`;
	}

	onMount(() => {
		if (!promptEl) return;
		editor = createPromptEditor(promptEl, {
			onSubmit,
			onHopOut: enterScrollMode
		});
		editor.focus();

		const onKey = (event: KeyboardEvent) => {
			const inEditor = (event.target as HTMLElement | null)?.closest(".cm-content");
			if (event.ctrlKey && event.altKey && event.key.startsWith("Arrow")) {
				// Capture phase (see listener below): fires before CodeMirror or
				// vim can swallow the combo, so the shortcuts work from anywhere.
				event.preventDefault();
				event.stopPropagation();
				if (event.key === "ArrowRight") cycleProvider(1);
				else if (event.key === "ArrowLeft") cycleProvider(-1);
				else if (event.key === "ArrowUp") cycleThinking(1);
				else if (event.key === "ArrowDown") cycleThinking(-1);
				return;
			}
			if (focusMode !== "scroll" || inEditor) return;
			if (event.key === "j" || event.key === "ArrowDown") {
				event.preventDefault();
				jumpTo(Math.min(selectedIdx + 1, chat.messages.length - 1));
			} else if (event.key === "k" || event.key === "ArrowUp") {
				event.preventDefault();
				jumpTo(Math.max(selectedIdx - 1, 0));
			} else if (event.key === "i" || event.key === "Enter") {
				event.preventDefault();
				enterEditMode();
			}
		};
		const onFocusIn = (event: FocusEvent) => {
			if ((event.target as HTMLElement | null)?.closest(".cm-content")) {
				focusMode = "edit";
			}
		};
		window.addEventListener("keydown", onKey, true);
		window.addEventListener("focusin", onFocusIn);
		return () => {
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("focusin", onFocusIn);
			editor?.destroy();
			editor = null;
		};
	});
</script>

<svelte:head>
	<title>Ccez Studio</title>
</svelte:head>

<div class="app" data-focus-mode={focusMode}>
	<aside>
		<button type="button" class="new" onclick={() => newChat(chatState)}>+ New chat</button>
		<ul>
			{#each chatState.chats as item (item.id)}
				<li>
					<button
						type="button"
						class:active={item.id === chatState.activeChatId}
						onclick={() => selectChat(chatState, item.id)}
					>
						{chatLabel(item.createdAt, item.messages.length)}
					</button>
					<button
						type="button"
						class="del"
						aria-label="Delete chat"
						onclick={() => deleteChat(chatState, item.id)}>×</button
					>
				</li>
			{/each}
		</ul>
		<button type="button" class="danger" onclick={() => deleteAllChats(chatState)}>
			Delete all chats
		</button>
	</aside>

	<main>
		<header>
			<span class="pill">{providerLabel}{useMock ? "" : ` · ${settings.thinkingLevel}`}</span>
			<span class="tokens" title="Accrued tokens this chat">{total} tokens</span>
			<a href={resolve("/settings")}>Settings</a>
		</header>

		{#if points.length > 3}
			<nav aria-label="Waypoints">
				{#each points as index, n (index)}
					<button type="button" title="Jump to message {n + 1}" onclick={() => jumpTo(index)}>
						{n + 1}
					</button>
				{/each}
			</nav>
		{/if}

		<div class="messages" bind:this={scrollBox}>
			{#if chat.messages.length === 0}
				<p class="empty">
					New chat — type below and hit Enter. ⌘+Enter runs with pins, ⌥+Enter pins
					the draft.{#if useMock} <strong>Mock provider active.</strong>{/if}
				</p>
			{/if}
			{#each chat.messages as msg, i (msg.id)}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
				<!-- Option-click is mouse-only by design; keyboard users get the Delete button below. -->
				<article
					id="msg-{i}"
					class:user={msg.role === "user"}
					class:assistant={msg.role === "assistant"}
					class:selected={focusMode === "scroll" && selectedIdx === i}
					onclick={(e) => {
						if (e.altKey) deleteMessage(chatState, i);
					}}
				>
					<div class="body">{msg.content}</div>
					<div class="actions">
						<button type="button" title="Branch from here" onclick={() => branchFrom(chatState, i)}>
							Branch
						</button>
						<button
							type="button"
							title="Delete this message (or option-click it)"
							onclick={() => deleteMessage(chatState, i)}
						>
							Delete
						</button>
						{#if msg.role === "user"}
							<button
								type="button"
								title="Rerun from here — deletes everything after this message"
								onclick={() => rerunFrom(i)}
							>
								Rerun
							</button>
						{/if}
						{#if msg.error}
							<span class="error">{msg.error}</span>
							<button type="button" onclick={retryFailed}>Retry</button>
						{/if}
					</div>
				</article>
			{/each}
			{#if chatState.sending}<p class="sending">…</p>{/if}
		</div>

		{#if missingKey}
			<p class="error-banner" role="alert">
				{#if isEjected(settings.activeProviderId)}
					Key ejected for this session — restore it in
					<a href={resolve("/settings")}>Settings</a>.
				{:else}
					Set an API key first — <a href={resolve("/settings")}>open Settings</a>.
				{/if}
			</p>
		{/if}

		{#if chat.pins.length > 0}
			<ul class="pins">
				{#each chat.pins as pin, i (i)}
					<li>
						<span>{pin.length > 60 ? `${pin.slice(0, 60)}…` : pin}</span>
						<button type="button" aria-label="Unpin" onclick={() => unpinMessage(chatState, i)}>×</button>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="prompt" bind:this={promptEl}></div>
		<footer>
			{#if focusMode === "scroll"}
				<span><strong>scroll</strong> j/k move · i back to writing</span>
			{:else}
				<span>vim inside · ctrl+g message scroll · ⌥+enter pin · ⌘+enter run+pins</span>
			{/if}
		</footer>
	</main>
</div>

<style>
	:global(body) {
		margin: 0;
	}
	.app {
		display: flex;
		height: 100vh;
		font-family:
			-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
		color: #1c1c1e;
		background: #fff;
		color-scheme: light dark;
	}
	aside {
		width: 13rem;
		flex-shrink: 0;
		border-right: 1px solid #e5e5ea;
		padding: 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		overflow-y: auto;
	}
	aside ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	aside li {
		display: flex;
		gap: 0.25rem;
	}
	aside li button:first-child {
		flex: 1;
		text-align: left;
	}
	aside button {
		font: inherit;
		font-size: 0.82rem;
		padding: 0.4rem 0.6rem;
		border: 1px solid transparent;
		border-radius: 8px;
		background: transparent;
		cursor: pointer;
	}
	aside button.active {
		background: #ececf1;
	}
	aside .new {
		border-color: #c7c7cc;
	}
	aside .del {
		color: #6e6e73;
	}
	aside .danger {
		margin-top: auto;
		color: #94250a;
	}
	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	header {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.7rem 1.2rem;
		border-bottom: 1px solid #e5e5ea;
		font-size: 0.82rem;
	}
	.pill {
		font-weight: 650;
	}
	.tokens {
		color: #6e6e73;
	}
	header a {
		margin-left: auto;
		color: #3a3a3c;
		text-decoration: none;
	}
	nav {
		display: flex;
		gap: 0.3rem;
		padding: 0.4rem 1.2rem;
		border-bottom: 1px solid #e5e5ea;
		overflow-x: auto;
	}
	nav button {
		font-size: 0.75rem;
		min-width: 1.6rem;
		border: 1px solid #c7c7cc;
		border-radius: 999px;
		background: #fff;
		cursor: pointer;
	}
	.messages {
		flex: 1;
		overflow-y: auto;
		padding: 1rem 1.2rem;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}
	.empty {
		color: #6e6e73;
		font-size: 0.9rem;
	}
	article {
		border-radius: 10px;
		padding: 0.6rem 0.8rem;
	}
	article.user {
		background: #f1f1f4;
		align-self: flex-end;
		max-width: 85%;
	}
	article.assistant {
		align-self: stretch;
		padding-left: 0;
		padding-right: 0;
	}
	article.selected {
		outline: 2px solid #3a3a3c;
		outline-offset: 2px;
	}
	.body {
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 0.92rem;
		line-height: 1.5;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.35rem;
	}
	.actions button {
		font-size: 0.75rem;
		color: #6e6e73;
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0;
	}
	.actions button:hover {
		color: #1c1c1e;
		text-decoration: underline;
	}
	.error {
		font-size: 0.8rem;
		color: #94250a;
	}
	.sending {
		color: #6e6e73;
	}
	.error-banner {
		margin: 0 1.2rem;
		font-size: 0.85rem;
		padding: 0.6rem 0.8rem;
		border-radius: 8px;
		background: #fdecea;
		color: #94250a;
	}
	.pins {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0;
		padding: 0.5rem 1.2rem 0;
	}
	.pins li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
		background: #eef4ff;
		border-radius: 999px;
		padding: 0.25rem 0.3rem 0.25rem 0.7rem;
	}
	.pins button {
		border: 0;
		background: none;
		cursor: pointer;
		color: #3a3a3c;
	}
	.prompt {
		margin: 0.6rem 1.2rem 0;
		border: 1px solid #c7c7cc;
		border-radius: 12px;
		padding: 0 0.8rem;
		background: #fff;
	}
	.prompt:focus-within {
		border-color: #3a3a3c;
	}
	footer {
		padding: 0.4rem 1.2rem 0.7rem;
		font-size: 0.75rem;
		color: #6e6e73;
	}
	@media (prefers-color-scheme: dark) {
		.app {
			color: #f2f2f7;
			background: #17171a;
		}
		aside {
			border-color: #38383a;
		}
		aside button.active {
			background: #2c2c2e;
		}
		aside .new {
			border-color: #48484a;
		}
		header {
			border-color: #38383a;
		}
		header a {
			color: #aeaeb2;
		}
		nav {
			border-color: #38383a;
		}
		nav button {
			background: #1c1c1e;
			border-color: #48484a;
			color: #f2f2f7;
		}
		article.user {
			background: #2c2c2e;
		}
		article.selected {
			outline-color: #aeaeb2;
		}
		.actions button {
			color: #98989f;
		}
		.actions button:hover {
			color: #f2f2f7;
		}
		.error-banner {
			background: #3d1008;
			color: #ffb4a2;
		}
		.pins li {
			background: #12233d;
		}
		.prompt {
			background: #1c1c1e;
			border-color: #48484a;
		}
		.prompt:focus-within {
			border-color: #aeaeb2;
		}
		footer {
			color: #98989f;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		* {
			transition: none;
		}
	}
</style>
