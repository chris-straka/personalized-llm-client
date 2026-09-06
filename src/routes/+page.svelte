<script lang="ts">
	import { onMount } from "svelte";
	import { SvelteSet } from "svelte/reactivity";
	import {
		createChatState,
		activeChat,
		newChat,
		selectChat,
		deleteChat,
		deleteAllChats,
		deleteMessage,
		stageMessage,
		branchFrom,
		dismissFailedAssistant,
		truncateToMessage,
		resendLast,
		tokenTotal,
		waypoints,
		sendMessage,
		type ChatMsg
	} from "$lib/chat";
	import {
		loadSettings,
		saveSettings,
		effectiveSystemPrompt,
		cycleThinkingLevel
	} from "$lib/settings";
	import {
		LANGUAGE_MENUS,
		replyLanguageFor,
		type LanguageMenu
	} from "$lib/languages";
	import { PROVIDERS, createProvider, getProviderDef } from "$lib/providers/registry";
	import { MockProvider, mockProviderEnabled } from "$lib/providers/mock";
	import { createPromptEditor, type PromptEditor, type SubmitKind } from "$lib/editor";
	import { isEjected } from "$lib/session";
	import { hydrateSecrets, tauriBackendAvailable } from "$lib/secrets";
	import type { ChatProvider } from "$lib/providers/types";
	import MessageBody from "$lib/components/MessageBody.svelte";
	import SettingsPanel from "$lib/components/SettingsPanel.svelte";
	import { renderMessage, htmlToText, sourcesAsked } from "$lib/render";
	import {
		fileToAttachment,
		stripImageMarkers,
		IMAGE_MARKER,
		type Attachment
	} from "$lib/attachments";
	import {
		addAnnotation,
		editAnnotationComment,
		deleteAnnotation,
		clearAnnotations,
		annotationNumber,
		withAnnotations,
		type Annotation
	} from "$lib/annotations";
	import { translateSelection } from "$lib/translate";
	import {
		detectScript,
		SCRIPT_LABEL,
		AID_LABEL,
		MODEL_AIDS,
		MODEL_AID_FOR_SCRIPT,
		extractWordAt,
		speakWord,
		ttsLangFor,
		runModelAid
	} from "$lib/reading";
	import {
		speakText,
		speechText,
		replyLangFor,
		stopSpeaking,
		micAvailable,
		dictateOnce,
		type VoiceProgress
	} from "$lib/voice";

	let chatState = $state(createChatState());
	let settings = $state(loadSettings());

	if (tauriBackendAvailable()) {
		// Pull Keychain keys into memory before the first send; no-op in browsers.
		void hydrateSecrets(settings);
	}
	let editor: PromptEditor | null = $state(null);
	let promptEl: HTMLElement | undefined = $state();
	let scrollBox: HTMLElement | undefined = $state();
	let focusMode: "edit" | "scroll" = $state("edit");
	let selectedIdx = $state(-1);
	let missingKey = $state(false);
	let attachments = $state<Attachment[]>([]);
	let attachError: string | null = $state(null);
	let attachInput: HTMLInputElement | undefined = $state();
	let foldedIds = new SvelteSet<string>();
	let previewId: string | null = $state(null);
	let annotations = $state<Annotation[]>([]);
	let reviewOpen = $state(false);
	let editingId: string | null = $state(null);
	let editDraft = $state("");
	let highlightAnnId: string | null = $state(null);
	let selMenu = $state<{
		x: number;
		y: number;
		quote: string;
		messageId: string;
	} | null>(null);
	let translate = $state<{
		quote: string;
		messageId: string;
		result: string | null;
		error: string | null;
		busy: boolean;
	} | null>(null);
	let vocalized = $state<Record<string, string>>({});
	let vocalizing = new SvelteSet<string>();
	let vocalizeError: string | null = $state(null);
	let speakingId: string | null = $state(null);
	let spokenNow = $state("");
	let voiceError: string | null = $state(null);
	let canMic = $state(false);
	let dictating = $state(false);
	let micError: string | null = $state(null);
	let stopDictation: (() => void) | null = null;
	let openLangMenu: LanguageMenu["id"] | null = $state(null);
	const activeReplyLang = $derived(replyLanguageFor(settings.replyLang));
	let settingsOpen = $state(false);

	function toggleSidebar(): void {
		settings.sidebarCollapsed = !settings.sidebarCollapsed;
		persistSettings();
	}

	function doNewChat(): void {
		stopVoice();
		selMenu = null;
		newChat(chatState);
		scrollBox?.scrollTo({ top: 0 });
		editor?.focus();
	}

	const useMock = mockProviderEnabled();
	const chat = $derived(activeChat(chatState));
	const providerLabel = $derived(
		useMock ? "mock" : getProviderDef(settings.activeProviderId).label
	);
	const total = $derived(tokenTotal(chatState));
	const points = $derived(waypoints(chatState));
	const sourcesWanted = $derived(
		sourcesAsked(chat.messages.filter((m) => m.role === "user").map((m) => m.content))
	);
	const attachTokens = $derived(attachments.reduce((sum, a) => sum + a.tokens, 0));

	/** Prompt text minus pasted-image marker lines (images travel as attachments). */
	function composerText(): string {
		return stripImageMarkers(editor?.getText() ?? "").trim();
	}

	async function addFiles(files: File[]): Promise<void> {
		attachError = null;
		for (const file of files) {
			try {
				attachments = [...attachments, await fileToAttachment(file)];
			} catch (error) {
				attachError = error instanceof Error ? error.message : String(error);
			}
		}
	}

	function onImagePasted(file: File): void {
		void addFiles([file]).then(() => {
			editor?.insertText(`\n${IMAGE_MARKER}\n`);
		});
	}

	function removeAttachment(id: string): void {
		attachments = attachments.filter((a) => a.id !== id);
		if (previewId === id) previewId = null;
	}

	function toggleFold(id: string): void {
		if (foldedIds.has(id)) foldedIds.delete(id);
		else foldedIds.add(id);
	}

	function copyMarkdown(text: string): void {
		void navigator.clipboard?.writeText(text).catch(() => {});
	}

	function copyText(content: string): void {
		const html = renderMessage(content, true).html;
		void navigator.clipboard?.writeText(htmlToText(html)).catch(() => {});
	}

	function toggleThoughts(): void {
		const blocks = scrollBox?.querySelectorAll("details.ccez-thoughts");
		if (!blocks || blocks.length === 0) return;
		const open = [...blocks].some((b) => !(b as HTMLDetailsElement).open);
		blocks.forEach((b) => {
			(b as HTMLDetailsElement).open = open;
		});
	}

	/** Message id owning the selection anchor, or null outside messages. */
	function selectedMessageId(selection: Selection): string | null {
		const node = selection.anchorNode;
		const element = node instanceof Element ? node : node?.parentElement;
		const article = element?.closest('article[id^="msg-"]');
		if (!article) return null;
		const index = Number(article.id.slice(4));
		return chat.messages[index]?.id ?? null;
	}

	function currentQuote(): { quote: string; messageId: string } | null {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed) return null;
		const inRendered = selection.anchorNode instanceof Element
			? selection.anchorNode
			: selection.anchorNode?.parentElement;
		if (!inRendered?.closest(".rendered")) return null;
		const quote = selection.toString().trim();
		if (!quote) return null;
		const messageId = selectedMessageId(selection);
		if (!messageId) return null;
		return { quote, messageId };
	}

	function onSelectEnd(event: MouseEvent): void {
		if (event.altKey) return; // Option-click deletes; never a menu.
		const found = currentQuote();
		if (!found) {
			selMenu = null;
			return;
		}
		const rect = window.getSelection()?.getRangeAt(0).getBoundingClientRect();
		if (!rect) {
			selMenu = null;
			return;
		}
		const width = 220;
		const x = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
		let y = rect.top - 48;
		if (y < 8) y = rect.bottom + 8;
		selMenu = { x, y, quote: found.quote, messageId: found.messageId };
	}

	function clearSelection(): void {
		window.getSelection()?.removeAllRanges();
	}

	function annotateFromMenu(moreDetails: boolean): void {
		if (!selMenu) return;
		annotations = addAnnotation(annotations, selMenu.messageId, selMenu.quote);
		const created = annotations[annotations.length - 1];
		clearSelection();
		selMenu = null;
		reviewOpen = true;
		highlightAnnId = created.id;
		if (moreDetails) {
			editingId = created.id;
			editDraft = "";
		}
	}

	function openBadge(id: string): void {
		reviewOpen = true;
		editingId = null;
		highlightAnnId = id;
	}

	function saveEdit(id: string): void {
		annotations = editAnnotationComment(annotations, id, editDraft);
		editingId = null;
	}

	function removeAnnotation(id: string): void {
		annotations = deleteAnnotation(annotations, id);
		if (editingId === id) editingId = null;
		if (highlightAnnId === id) highlightAnnId = null;
	}

	function clearAllAnnotations(): void {
		annotations = clearAnnotations();
		reviewOpen = false;
		editingId = null;
		highlightAnnId = null;
	}

	async function openTranslate(): Promise<void> {
		const found = currentQuote();
		if (!found) return;
		const provider = resolveProvider();
		translate = {
			quote: found.quote,
			messageId: found.messageId,
			result: null,
			error: provider ? null : "Set an API key first — open Settings.",
			busy: !!provider
		};
		clearSelection();
		selMenu = null;
		if (!provider) return;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 30000);
		try {
			// Lookup targets English; anything else goes in the chat itself.
			const result = await translateSelection(
				provider,
				found.quote,
				"English",
				controller.signal
			);
			if (translate && translate.quote === found.quote) {
				translate = { ...translate, result, busy: false };
			}
		} catch (error) {
			if (translate && translate.quote === found.quote) {
				translate = {
					...translate,
					error: error instanceof Error ? error.message : String(error),
					busy: false
				};
			}
		} finally {
			clearTimeout(timer);
		}
	}

	function annotateTranslation(): void {
		if (!translate?.result) return;
		annotations = addAnnotation(annotations, translate.messageId, translate.quote, translate.result);
		highlightAnnId = annotations[annotations.length - 1].id;
		translate = null;
		reviewOpen = true;
		editingId = null;
	}

	function marksFor(messageId: string): Array<{ id: string; number: number; quote: string }> {
		return annotations
			.filter((a) => a.messageId === messageId)
			.map((a) => ({ id: a.id, number: annotationNumber(annotations, a.id), quote: a.quote }));
	}

	function toggleReadingAids(): void {
		settings.readingAids = !settings.readingAids;
		persistSettings();
	}

	async function runModelAidFor(msg: ChatMsg, aidId: string): Promise<void> {
		if (vocalized[msg.id] || vocalizing.has(msg.id)) return;
		const provider = resolveProvider();
		if (!provider) {
			vocalizeError = "Set an API key first — open Settings.";
			return;
		}
		vocalizeError = null;
		vocalizing.add(msg.id);
		try {
			const text = await runModelAid(provider, aidId, msg.content);
			vocalized = { ...vocalized, [msg.id]: text };
		} catch (error) {
			vocalizeError = error instanceof Error ? error.message : String(error);
		} finally {
			vocalizing.delete(msg.id);
		}
	}

	function latinFallback(): string {
		return settings.voiceLang?.trim() || "en-US";
	}

	function onVoiceProgress(progress: VoiceProgress): void {
		spokenNow = progress.current;
	}

	function resetVoice(): void {
		speakingId = null;
		spokenNow = "";
	}

	function stopVoice(): void {
		stopSpeaking();
		resetVoice();
	}

	function startSpeech(id: string, text: string, lang: string): void {
		stopSpeaking();
		voiceError = null;
		speakingId = id;
		spokenNow = "";
		const ok = speakText(text, lang, {
			onProgress: onVoiceProgress,
			onEnd: resetVoice,
			onError: (message) => {
				voiceError = message;
				resetVoice();
			}
		});
		if (!ok) {
			resetVoice();
			voiceError = "Voice not available in this browser.";
		}
	}

	function speakReply(msg: ChatMsg): void {
		const text = speechText(msg.content);
		if (!text) return;
		startSpeech(msg.id, text, replyLangFor(msg.content, latinFallback()));
	}

	function maybeSpeakReply(): void {
		if (!settings.voice) return;
		const last = chat.messages[chat.messages.length - 1];
		if (last?.role === "assistant" && !last.error && last.content.trim()) {
			speakReply(last);
		}
	}

	function toggleVoice(): void {
		settings.voice = !settings.voice;
		if (!settings.voice) stopVoice();
		persistSettings();
	}

	/** Highlight-to-speak: only what was selected, only when asked. */
	function speakSelection(): void {
		if (!selMenu) return;
		const quote = selMenu.quote;
		clearSelection();
		selMenu = null;
		startSpeech("selection", quote, ttsLangFor(quote, latinFallback()));
	}

	function toggleMic(): void {
		if (dictating) {
			stopDictation?.();
			stopDictation = null;
			dictating = false;
			return;
		}
		micError = null;
		const stop = dictateOnce(
			latinFallback(),
			(transcript) => {
				editor?.insertText(transcript.endsWith(" ") ? transcript : `${transcript} `);
				dictating = false;
				stopDictation = null;
			},
			(message) => {
				micError = message;
				dictating = false;
				stopDictation = null;
			}
		);
		if (!stop) {
			micError = "Mic input not available in this browser.";
			return;
		}
		stopDictation = stop;
		dictating = true;
	}

	function unvocalize(id: string): void {
		const next = { ...vocalized };
		delete next[id];
		vocalized = next;
	}

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

	async function doSend() {
		const provider = resolveProvider();
		if (!provider) {
			missingKey = true;
			return;
		}
		missingKey = false;
		focusMode = "edit";
		stopVoice();
		const outgoing = attachments;
		const outgoingAnnotations = annotations;
		await sendMessage(
			chatState,
			provider,
			effectiveSystemPrompt(settings),
			withAnnotations(composerText(), outgoingAnnotations),
			{ attachments: outgoing }
		);
		// Keep drafts when the reply failed so nothing silently drops.
		const sent = chat.messages[chat.messages.length - 1];
		if (sent?.role === "assistant" && !sent.error) {
			attachments = [];
			previewId = null;
			annotations = [];
			reviewOpen = false;
			editingId = null;
			highlightAnnId = null;
		}
		editor?.clear();
		scrollToBottom();
		maybeSpeakReply();
	}

	async function resend() {
		const provider = resolveProvider();
		if (!provider) {
			missingKey = true;
			return;
		}
		missingKey = false;
		stopVoice();
		await resendLast(chatState, provider, effectiveSystemPrompt(settings));
		scrollToBottom();
		maybeSpeakReply();
	}

	function onSubmit(kind: SubmitKind) {
		if (kind === "stage") {
			// ⌥+Enter: most recent message, no reply; the next submit
			// carries the full history in order.
			stageMessage(chatState, composerText(), attachments);
			attachments = [];
			previewId = null;
			editor?.clear();
			scrollToBottom();
			return;
		}
		void doSend();
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
		settings.thinkingLevel = cycleThinkingLevel(settings.thinkingLevel, direction);
		persistSettings();
	}

	function setReplyLang(code: string): void {
		const lang = replyLanguageFor(code);
		if (!lang) return;
		settings.replyLang = code;
		settings.voiceLang = lang.voice;
		openLangMenu = null;
		persistSettings();
	}

	function clearReplyLang(): void {
		settings.replyLang = null;
		openLangMenu = null;
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
			onHopOut: enterScrollMode,
			onImagePaste: onImagePasted
		});
		editor.focus();

		const onKey = (event: KeyboardEvent) => {
			const inEditor = (event.target as HTMLElement | null)?.closest(".cm-content");
			if ((event.metaKey || event.ctrlKey) && (event.key === "t" || event.key === "T")) {
				// Translate lookup only hijacks the combo over message text —
				// vim and the browser keep it everywhere else.
				if (!inEditor && currentQuote()) {
					event.preventDefault();
					event.stopPropagation();
					void openTranslate();
					return;
				}
			}
			if (event.key === "Escape" && !inEditor) {
				selMenu = null;
				translate = null;
				openLangMenu = null;
				settingsOpen = false;
				stopVoice();
				return;
			}
			if (event.altKey && (event.key === "r" || event.key === "R")) {
				// Vim owns the prompt; everywhere else Alt+R flips reading aids.
				if (!inEditor) {
					event.preventDefault();
					toggleReadingAids();
					return;
				}
			}
			if (event.ctrlKey && (event.key === "o" || event.key === "O")) {
				// Thoughts toggle works from anywhere, even inside the prompt.
				event.preventDefault();
				event.stopPropagation();
				toggleThoughts();
				return;
			}
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
			if (event.ctrlKey && event.altKey && (event.key === "n" || event.key === "N")) {
				event.preventDefault();
				event.stopPropagation();
				doNewChat();
				return;
			}
			if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
				const combo = event.key.toLowerCase();
				if (combo === "b") {
					event.preventDefault();
					event.stopPropagation();
					toggleSidebar();
					return;
				}
				if (event.key === ".") {
					event.preventDefault();
					event.stopPropagation();
					settingsOpen = !settingsOpen;
					return;
				}
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
		const onMouseUp = (event: MouseEvent) => {
			// Ignore clicks that start inside the prompt, popups, or buttons —
			// only freshly selected message text summons the menu.
			if (event.button === 2) return; // right-click reads aloud instead
			if (openLangMenu) {
				const target = event.target as HTMLElement | null;
				if (!target?.closest(".lang-menu")) openLangMenu = null;
			}
			const target = event.target as HTMLElement | null;
			if (target?.closest(".cm-content, .sel-menu, .review, .translate-panel, button, input, textarea")) {
				return;
			}
			onSelectEnd(event);
		};
		// Right-click a word in a message to hear it — even with aids off.
		// Capture phase + preventDefault pre-empts the native context menu.
		const onContextMenu = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			const body = target?.closest(".messages .rendered");
			if (!body || target?.closest("button, input, textarea, a, summary")) return;
			let range: Range | null = null;
			try {
				if (typeof document.caretRangeFromPoint === "function") {
					range = document.caretRangeFromPoint(event.clientX, event.clientY);
				}
			} catch {
				range = null;
			}
			const node = range?.startContainer;
			if (!node || node.nodeType !== Node.TEXT_NODE || !body.contains(node)) return;
			const word = extractWordAt(node.textContent ?? "", range?.startOffset ?? 0);
			if (!word) return;
			event.preventDefault();
			speakWord(word, settings.voiceLang?.trim() || "en-US");
		};
		canMic = micAvailable();
		window.addEventListener("keydown", onKey, true);
		window.addEventListener("focusin", onFocusIn);
		window.addEventListener("mouseup", onMouseUp);
		window.addEventListener("contextmenu", onContextMenu, true);
		return () => {
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("focusin", onFocusIn);
			window.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("contextmenu", onContextMenu, true);
			stopSpeaking();
			stopDictation?.();
			editor?.destroy();
			editor = null;
		};
	});
</script>

<svelte:head>
	<title>Ccez Studio</title>
</svelte:head>

<div
	class="app"
	data-focus-mode={focusMode}
	data-shell={tauriBackendAvailable() ? "tauri" : "browser"}
>
	<aside class:collapsed={settings.sidebarCollapsed} inert={settings.sidebarCollapsed}>
		<div class="side-head">
			<button type="button" class="new" onclick={() => doNewChat()}>+ New chat</button>
			<button
				type="button"
				class="fold-side"
				title="Collapse chat list (⌘B)"
				aria-label="Collapse chat list"
				onclick={toggleSidebar}
			>
				«
			</button>
		</div>
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
		<header data-tauri-drag-region>
			<button
				type="button"
				class="pill-btn"
				title="Toggle chat list (⌘B)"
				onclick={toggleSidebar}
			>
				<span aria-hidden="true">{settings.sidebarCollapsed ? "»" : "«"}</span> Chats
			</button>
			<span class="pill">{providerLabel}{useMock ? "" : ` · ${settings.thinkingLevel}`}</span>
			{#if activeReplyLang}
				<button
					type="button"
					class="lang-chip"
					title="Reply language — click to clear"
					onclick={clearReplyLang}
				>
					{activeReplyLang.name} ×
				</button>
			{/if}
			<span class="tokens" title="Accrued tokens this chat">{total} tokens</span>
			<span class="spacer"></span>
			<button
				type="button"
				class="pill-btn"
				title="New chat (Ctrl+Alt+N)"
				onclick={doNewChat}
			>
				+ New chat
			</button>
			<button
				type="button"
				class="settings-btn"
				title="Toggle settings (⌘.)"
				aria-expanded={settingsOpen}
				onclick={() => (settingsOpen = !settingsOpen)}
			>
				Settings
			</button>
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

		<div class="messages" bind:this={scrollBox} onscroll={() => (selMenu = null)}>
			{#if chat.messages.length === 0}
				<div class="empty-state">
					<p class="empty">
						New chat — type below; ⌘+Enter sends, Enter is a newline.
						⌥+Enter stages the draft as the latest message without replying.
						Select text in a reply to annotate it;
						⌘+T translates the selection.{#if useMock}
							<strong>Mock provider active.</strong>{/if}
					</p>
					<div class="lang-menus" aria-label="Reply language">
						{#each LANGUAGE_MENUS as menu (menu.id)}
							<div class="lang-menu">
								<button
									type="button"
									aria-haspopup="true"
									aria-expanded={openLangMenu === menu.id}
									title="Reply in a {menu.label.toLowerCase()} language"
									onclick={() =>
										(openLangMenu = openLangMenu === menu.id ? null : menu.id)}
								>
									<span aria-hidden="true">{menu.marker}</span>
									{menu.label}
								</button>
								{#if openLangMenu === menu.id}
									<div class="lang-list" role="menu">
										{#each menu.languages as lang (lang.code)}
											<button
												type="button"
												role="menuitem"
												class:selected={settings.replyLang === lang.code}
												onclick={() => setReplyLang(lang.code)}
											>
												<span class="badge" aria-hidden="true">{lang.badge}</span>
												{lang.name}
											</button>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
						{#if activeReplyLang}
							<button
								type="button"
								class="clear"
								title="Back to the default brief prompt"
								onclick={clearReplyLang}
							>
								Clear · {activeReplyLang.name}
							</button>
						{/if}
					</div>
				</div>
			{/if}
			{#each chat.messages as msg, i (msg.id)}
				{@const script = detectScript(msg.content)}
				{@const aidId = script ? MODEL_AID_FOR_SCRIPT[script] : null}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
				<!-- Option-click is mouse-only by design; keyboard users get the Delete button below. -->
				<article
					id="msg-{i}"
					class:user={msg.role === "user"}
					class:assistant={msg.role === "assistant"}
					class:has-hint={script !== null}
					class:selected={focusMode === "scroll" && selectedIdx === i}
					onclick={(e) => {
						if (e.altKey) deleteMessage(chatState, i);
					}}
				>
					{#if script}
						<div class="script-hint">
							<button
								type="button"
								title="Toggle reading aids (Alt+R)"
								onclick={toggleReadingAids}
							>
								{SCRIPT_LABEL[script]} · {AID_LABEL[script]}
								{settings.readingAids ? "on" : "off"}
							</button>
							{#if aidId && settings.readingAids}
								{#if vocalized[msg.id]}
									<button type="button" title="Show original" onclick={() => unvocalize(msg.id)}>
										original
									</button>
								{:else}
									<button
										type="button"
										title={MODEL_AIDS[aidId].title}
										disabled={vocalizing.has(msg.id)}
										onclick={() => void runModelAidFor(msg, aidId)}
									>
										{vocalizing.has(msg.id) ? "…" : MODEL_AIDS[aidId].button}
									</button>
								{/if}
							{/if}
						</div>
					{/if}
					<MessageBody
						message={msg}
						streaming={chatState.sending &&
							msg.role === "assistant" &&
							i === chat.messages.length - 1}
						sourcesWanted={sourcesWanted}
						folded={foldedIds.has(msg.id)}
						marks={marksFor(msg.id)}
						onBadgeClick={openBadge}
						readingAids={settings.readingAids}
						textOverride={vocalized[msg.id] ?? null}
					/>
					{#if msg.attachments && msg.attachments.length > 0}
						<div class="sent-files">
							{#each msg.attachments as att (att.id)}
								<span title="{att.name} · ~{att.tokens} tokens">📎 {att.name}</span>
							{/each}
						</div>
					{/if}
					<div class="actions">
						<button
							type="button"
							title="Fold this message"
							onclick={() => toggleFold(msg.id)}
						>
							{foldedIds.has(msg.id) ? "Unfold" : "Fold"}
						</button>
						<button type="button" title="Copy as markdown" onclick={() => copyMarkdown(msg.content)}>
							Copy MD
						</button>
						<button type="button" title="Copy as plain text" onclick={() => copyText(msg.content)}>
							Copy text
						</button>
						<button type="button" title="Branch from here" onclick={() => branchFrom(chatState, i)}>
							Branch
						</button>
						<button type="button" title="Read this message aloud" onclick={() => speakReply(msg)}>
							Speak
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
					<button type="button" class="link" onclick={() => (settingsOpen = true)}>
						Settings</button
					>.
				{:else}
					Set an API key first —
					<button type="button" class="link" onclick={() => (settingsOpen = true)}>
						open Settings</button
					>.
				{/if}
			</p>
		{/if}

		{#if attachments.length > 0 || attachError}
			<ul class="attachments">
				{#each attachments as att (att.id)}
					<li>
						{#if att.kind === "image"}
							<button
								type="button"
								class="thumb"
								title="Toggle preview"
								onclick={() => (previewId = previewId === att.id ? null : att.id)}
							>
								IMG
							</button>
						{:else}
							<span class="file-kind" aria-hidden="true">FILE</span>
						{/if}
						<span class="name" title="{att.name} · ~{att.tokens} tokens">{att.name}</span>
						<span class="tok">~{att.tokens}</span>
						<button type="button" aria-label="Remove attachment" onclick={() => removeAttachment(att.id)}>
							×
						</button>
					</li>
				{/each}
			</ul>
			{#if previewId}
				{#each attachments.filter((a) => a.id === previewId) as att (att.id)}
					{#if att.dataUrl}
						<img class="preview" src={att.dataUrl} alt={att.name} />
					{/if}
				{/each}
			{/if}
			{#if attachError}
				<p class="error" role="alert">{attachError}</p>
			{/if}
		{/if}

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="prompt"
			bind:this={promptEl}
			ondragover={(e) => e.preventDefault()}
			ondrop={(e) => {
				e.preventDefault();
				const files = [...(e.dataTransfer?.files ?? [])];
				if (files.length > 0) void addFiles(files);
			}}
		>
			<button
				type="button"
				class="voice-float"
				class:on={settings.voice}
				title="Toggle voice readback (replies are read aloud)"
				onclick={toggleVoice}
			>
				<span class="dot" aria-hidden="true"></span>Voice
			</button>
			<button
				type="button"
				class="send-btn"
				title="Send (⌘+Enter)"
				aria-label="Send"
				onclick={() => onSubmit("send")}
			>
				↑
			</button>
		</div>
		{#if reviewOpen && annotations.length > 0}
			<div class="review" role="dialog" aria-label="Annotations">
				{#each annotations as ann, n (ann.id)}
					<div class="review-item" class:highlight={highlightAnnId === ann.id}>
						<div class="review-head">
							<span class="review-num">{n + 1}.</span>
							<span class="review-label">Selected text:</span>
							<span class="review-quote">“{ann.quote}”</span>
							<button
								type="button"
								aria-label="Delete annotation {n + 1}"
								title="Delete annotation"
								onclick={() => removeAnnotation(ann.id)}
							>
								×
							</button>
						</div>
						{#if editingId === ann.id}
							<label>
								<span class="review-label">User comment:</span>
								<textarea rows="2" bind:value={editDraft} placeholder="Add an optional comment…"
								></textarea>
							</label>
							<div class="review-edit-actions">
								<button type="button" onclick={() => saveEdit(ann.id)}>Save</button>
								<button type="button" onclick={() => (editingId = null)}>Cancel</button>
							</div>
						{:else}
							<div class="review-head">
								<span class="review-label">User comment:</span>
								<span class="review-comment">{ann.comment || "—"}</span>
								<button
									type="button"
									title="Edit comment"
									onclick={() => {
										editingId = ann.id;
										editDraft = ann.comment;
									}}
								>
									Edit
								</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if vocalizeError}
			<p class="error-banner" role="alert">{vocalizeError}</p>
		{/if}

		{#if speakingId}
			<div class="voice-bar" role="status">
				<span class="voice-dot" aria-hidden="true"></span>
				<span class="voice-text"
					>{spokenNow
						? `“${spokenNow.length > 90 ? `${spokenNow.slice(0, 90)}…` : spokenNow}”`
						: "Speaking…"}</span
				>
				<button type="button" title="Skip (stop reading)" onclick={stopVoice}>Skip</button>
			</div>
		{/if}
		{#if voiceError}
			<p class="error-banner" role="alert">{voiceError}</p>
		{/if}

		{#if translate}
			<div class="translate-panel" role="dialog" aria-label="Translate lookup">
				<div class="review-head">
					<span class="review-quote">“{translate.quote}”</span>
					<button type="button" aria-label="Close translate" onclick={() => (translate = null)}>
						×
					</button>
				</div>
				{#if translate.busy}
					<p class="muted">Translating to English…</p>
				{:else if translate.error}
					<p class="error" role="alert">{translate.error}</p>
				{:else if translate.result}
					<p class="translate-result">{translate.result}</p>
					<div class="review-edit-actions">
						<button type="button" onclick={annotateTranslation}>Add as annotation</button>
						<button
							type="button"
							onclick={() => {
								if (translate?.result) copyMarkdown(translate.result);
							}}
						>
							Copy
						</button>
					</div>
				{/if}
			</div>
		{/if}

		<div class="composer-bar">
			{#if annotations.length > 0}
				<button
					type="button"
					class="ann-pill"
					title="Review annotations (× clears all)"
					onclick={() => (reviewOpen = !reviewOpen)}
				>
					{annotations.length} annotation{annotations.length === 1 ? "" : "s"}
				</button>
				<button
					type="button"
					aria-label="Delete all annotations"
					title="Delete all annotations"
					onclick={clearAllAnnotations}
				>
					×
				</button>
			{/if}
			<button type="button" title="Attach images or text files" onclick={() => attachInput?.click()}>
				Attach{#if attachTokens > 0} · ~{attachTokens} tok{/if}
			</button>
			{#if canMic}
				<button
					type="button"
					class:recording={dictating}
					title="Dictate into the prompt"
					onclick={toggleMic}
				>
					<span class="dot" aria-hidden="true"></span>{dictating ? "Stop" : "Mic"}
				</button>
			{/if}
			{#if micError}
				<span class="mic-error" role="alert">{micError}</span>
			{/if}
			<input
				type="file"
				class="hidden-input"
				bind:this={attachInput}
				multiple
				accept="image/*,.txt,.md,.markdown,.json,.js,.ts,.tsx,.jsx,.py,.rb,.go,.rs,.java,.c,.h,.cpp,.cs,.swift,.kt,.php,.sh,.yaml,.yml,.toml,.xml,.html,.css,.sql,.csv,.log"
				onchange={(e) => {
					const files = [...(e.currentTarget.files ?? [])];
					e.currentTarget.value = "";
					if (files.length > 0) void addFiles(files);
				}}
			/>
		</div>
		<footer>
			{#if focusMode === "scroll"}
				<span><strong>scroll</strong> j/k move · i back to writing</span>
			{:else}
				<span
					>vim inside · ctrl+g message scroll · ⌥+enter stage ·
					ctrl+o thoughts · alt+r reading aids</span
				>
			{/if}
		</footer>
	</main>

	{#if selMenu}
		<div class="sel-menu" style="left: {selMenu.x}px; top: {selMenu.y}px" role="menu">
			<button type="button" onclick={() => annotateFromMenu(false)}>Add to chat</button>
			<button type="button" onclick={() => annotateFromMenu(true)}>More details</button>
			<button type="button" title="Read only the selection aloud" onclick={speakSelection}>
				Speak aloud
			</button>
		</div>
	{/if}

	<aside
		class="settings-panel"
		class:closed={!settingsOpen}
		aria-label="Settings"
		inert={!settingsOpen}
	>
		<SettingsPanel settings={settings} onClose={() => (settingsOpen = false)} />
	</aside>
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
	.side-head {
		display: flex;
		gap: 0.25rem;
	}
	.side-head .new {
		flex: 1;
	}
	.fold-side {
		flex-shrink: 0;
		font: inherit;
		font-size: 0.9rem;
		color: #6e6e73;
		border: 1px solid transparent;
		border-radius: 8px;
		background: transparent;
		cursor: pointer;
		padding: 0.4rem 0.5rem;
	}
	.fold-side:hover {
		color: #1c1c1e;
		border-color: #c7c7cc;
	}
	aside {
		transition:
			width 0.22s ease,
			opacity 0.18s ease,
			padding 0.22s ease,
			border-color 0.22s ease;
		overflow: hidden;
	}
	aside.collapsed {
		width: 0;
		min-width: 0;
		opacity: 0;
		padding-left: 0;
		padding-right: 0;
		border-right-width: 0;
		pointer-events: none;
	}
	.settings-panel {
		width: 22rem;
		flex-shrink: 0;
		border-left: 1px solid #e5e5ea;
		padding: 1.2rem 1.2rem 2rem;
		overflow-y: auto;
		overflow-x: hidden;
		background: #fff;
		transition:
			width 0.22s ease,
			opacity 0.18s ease,
			padding 0.22s ease,
			border-color 0.22s ease;
	}
	.settings-panel.closed {
		width: 0;
		opacity: 0;
		padding-left: 0;
		padding-right: 0;
		border-left-color: transparent;
		pointer-events: none;
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
		gap: 1rem;
		padding: 0.9rem 1.4rem;
		border-bottom: 1px solid #e5e5ea;
		font-size: 0.82rem;
	}
	.pill {
		font-weight: 650;
		white-space: nowrap;
	}
	.tokens {
		color: #6e6e73;
		white-space: nowrap;
	}
	.spacer {
		flex: 1;
	}
	.lang-chip {
		font: inherit;
		font-size: 0.78rem;
		color: #1c1c1e;
		border: 1px solid #1c1c1e;
		border-radius: 999px;
		background: none;
		cursor: pointer;
		padding: 0.2rem 0.7rem;
		white-space: nowrap;
	}
	.pill-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font: inherit;
		font-size: 0.78rem;
		color: #6e6e73;
		border: 1px solid #c7c7cc;
		border-radius: 999px;
		background: none;
		cursor: pointer;
		padding: 0.25rem 0.8rem;
		white-space: nowrap;
	}
	.settings-btn {
		font: inherit;
		font-size: 0.82rem;
		color: #3a3a3c;
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0;
		white-space: nowrap;
	}
	.settings-btn:hover {
		text-decoration: underline;
	}
	button.link {
		font: inherit;
		color: inherit;
		text-decoration: underline;
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0;
	}
	/* Traffic lights float over the sidebar in the Tauri shell. */
	.app[data-shell="tauri"] aside {
		padding-top: 2.1rem;
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
	.empty-state {
		display: flex;
		flex-direction: column;
		gap: 1.2rem;
		padding: 1.5rem 0.5rem;
	}
	.lang-menus {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	.lang-menu {
		position: relative;
	}
	.lang-menu > button,
	.lang-menus .clear {
		font-size: 0.82rem;
		border: 1px solid #c7c7cc;
		border-radius: 10px;
		background: none;
		cursor: pointer;
		padding: 0.4rem 0.8rem;
		color: #1c1c1e;
	}
	.lang-menu > button:hover,
	.lang-menus .clear:hover {
		border-color: #1c1c1e;
	}
	.lang-list {
		position: absolute;
		z-index: 40;
		top: calc(100% + 0.35rem);
		left: 0;
		min-width: 13rem;
		max-height: 16rem;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		padding: 0.3rem;
		border: 1px solid #c7c7cc;
		border-radius: 10px;
		background: #fff;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
	}
	.lang-list button {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		font-size: 0.82rem;
		border: 0;
		border-radius: 7px;
		background: none;
		cursor: pointer;
		padding: 0.4rem 0.6rem;
		text-align: left;
		color: #1c1c1e;
		white-space: nowrap;
	}
	.lang-list button:hover {
		background: #f1f1f4;
	}
	.lang-list button.selected {
		font-weight: 650;
		background: #f1f1f4;
	}
	.badge {
		display: inline-block;
		min-width: 2rem;
		text-align: center;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: #3a3a3c;
		border: 1px solid #c7c7cc;
		border-radius: 6px;
		padding: 0.1rem 0.3rem;
	}
	article {
		position: relative;
		border-radius: 10px;
		padding: 0.6rem 0.8rem;
	}
	article.has-hint {
		padding-top: 1.15rem;
	}
	.script-hint {
		position: absolute;
		top: 0.35rem;
		right: 0.6rem;
		display: flex;
		gap: 0.4rem;
		opacity: 0.55;
	}
	.script-hint:hover {
		opacity: 1;
	}
	.script-hint button {
		font-size: 0.7rem;
		color: #6e6e73;
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0;
	}
	.script-hint button:hover {
		text-decoration: underline;
	}
	.script-hint button:disabled {
		cursor: default;
		text-decoration: none;
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
	.sent-files {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.35rem;
		font-size: 0.75rem;
		color: #6e6e73;
	}
	.attachments {
		list-style: none;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0;
		padding: 0.5rem 1.2rem 0;
	}
	.attachments li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.78rem;
		background: #eef4ff;
		border-radius: 999px;
		padding: 0.25rem 0.3rem 0.25rem 0.7rem;
		max-width: 100%;
	}
	.attachments .name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 16rem;
	}
	.attachments .tok {
		color: #6e6e73;
	}
	.attachments button {
		border: 0;
		background: none;
		cursor: pointer;
		color: #3a3a3c;
	}
	.attachments .thumb {
		font-size: 0.9rem;
		padding: 0;
	}
	.preview {
		display: block;
		max-width: 16rem;
		max-height: 12rem;
		margin: 0.4rem 1.2rem 0;
		border-radius: 8px;
		border: 1px solid #c7c7cc;
	}
	.composer-bar {
		display: flex;
		padding: 0.35rem 1.2rem 0;
	}
	.composer-bar button {
		font-size: 0.78rem;
		color: #6e6e73;
		border: 1px solid #c7c7cc;
		border-radius: 999px;
		background: none;
		cursor: pointer;
		padding: 0.2rem 0.7rem;
	}
	.composer-bar button:hover {
		color: #1c1c1e;
	}
	.mic-error {
		align-self: center;
		font-size: 0.78rem;
		color: #94250a;
	}
	.composer-bar button .dot {
		display: inline-block;
		width: 0.45rem;
		height: 0.45rem;
		border-radius: 50%;
		background: #c7c7cc;
		margin-right: 0.4rem;
		vertical-align: baseline;
	}
	.composer-bar button.recording .dot {
		background: #c0362c;
	}
	.voice-bar {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin: 0.5rem 1.2rem 0;
		padding: 0.45rem 0.8rem;
		border: 1px solid #c7c7cc;
		border-radius: 12px;
		background: #fafafc;
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
		font-size: 0.82rem;
	}
	.voice-dot {
		width: 0.55rem;
		height: 0.55rem;
		flex-shrink: 0;
		border-radius: 50%;
		background: #30a46c;
		animation: voice-pulse 1.2s ease-in-out infinite;
	}
	@keyframes voice-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}
	.voice-text {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #3a3a3c;
	}
	.voice-bar button {
		flex-shrink: 0;
		font-size: 0.78rem;
		border: 1px solid #c7c7cc;
		border-radius: 999px;
		background: #fff;
		cursor: pointer;
		padding: 0.2rem 0.8rem;
	}
	.hidden-input {
		display: none;
	}
	.sel-menu {
		position: fixed;
		z-index: 50;
		display: flex;
		gap: 0.25rem;
		padding: 0.3rem;
		border: 1px solid #c7c7cc;
		border-radius: 10px;
		background: #fff;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
	}
	.sel-menu button {
		font-size: 0.8rem;
		border: 0;
		border-radius: 7px;
		background: none;
		cursor: pointer;
		padding: 0.35rem 0.7rem;
		white-space: nowrap;
	}
	.sel-menu button:hover {
		background: #f1f1f4;
	}
	.review,
	.translate-panel {
		margin: 0.5rem 1.2rem 0;
		border: 1px solid #e5e5ea;
		border-radius: 10px;
		padding: 0.6rem 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		background: #fafafc;
	}
	.review-item {
		border-radius: 8px;
		padding: 0.35rem 0.5rem;
	}
	.review-item.highlight {
		background: #eef4ff;
	}
	.review-head {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		font-size: 0.82rem;
	}
	.review-head button {
		margin-left: auto;
		flex-shrink: 0;
		font-size: 0.75rem;
		color: #6e6e73;
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0;
	}
	.review-head button:hover {
		color: #1c1c1e;
		text-decoration: underline;
	}
	.review-num {
		font-weight: 700;
	}
	.review-label {
		color: #6e6e73;
		font-size: 0.75rem;
	}
	.review-quote {
		font-weight: 550;
		overflow-wrap: anywhere;
	}
	.review-comment {
		overflow-wrap: anywhere;
	}
	.review label {
		display: block;
		font-size: 0.82rem;
		margin-top: 0.3rem;
	}
	.review textarea {
		display: block;
		width: 100%;
		box-sizing: border-box;
		margin-top: 0.25rem;
		font: inherit;
		border: 1px solid #c7c7cc;
		border-radius: 8px;
		padding: 0.4rem 0.6rem;
		resize: vertical;
	}
	.review-edit-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.35rem;
	}
	.review-edit-actions button {
		font-size: 0.78rem;
		border: 1px solid #c7c7cc;
		border-radius: 999px;
		background: #fff;
		cursor: pointer;
		padding: 0.2rem 0.8rem;
	}
	.ann-pill {
		font-weight: 650;
	}
	.muted {
		font-size: 0.82rem;
		color: #6e6e73;
		margin: 0;
	}
	.translate-result {
		font-size: 0.9rem;
		margin: 0;
		overflow-wrap: anywhere;
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
	.prompt {
		position: relative;
		margin: 0.6rem 1.2rem 0;
		border: 1px solid #c7c7cc;
		border-radius: 12px;
		padding: 0 0.8rem 1.9rem;
		background: #fff;
		/* Fixed floor so mounting the editor never shifts layout. */
		min-height: 4.6rem;
		box-sizing: border-box;
	}
	.send-btn {
		position: absolute;
		right: 0.6rem;
		bottom: 0.5rem;
		width: 1.7rem;
		height: 1.7rem;
		border-radius: 50%;
		border: 1px solid #1c1c1e;
		background: #1c1c1e;
		color: #fff;
		font-size: 0.95rem;
		line-height: 1;
		cursor: pointer;
		padding: 0 0 0.1rem;
	}
	.send-btn:hover {
		opacity: 0.8;
	}
	.voice-float {
		position: absolute;
		top: 0.45rem;
		right: 0.6rem;
		z-index: 5;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font: inherit;
		font-size: 0.72rem;
		color: #6e6e73;
		border: 1px solid #c7c7cc;
		border-radius: 999px;
		background: #fff;
		cursor: pointer;
		padding: 0.15rem 0.6rem;
		white-space: nowrap;
	}
	.voice-float .dot {
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 50%;
		background: #c7c7cc;
	}
	.voice-float.on {
		color: #1c1c1e;
		border-color: #1c1c1e;
	}
	.voice-float.on .dot {
		background: #30a46c;
	}
	.file-kind {
		font-size: 0.68rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		color: #6e6e73;
	}
	/* Prompt editor legibility (global: CodeMirror owns these nodes).
	   Dark rules live here — not in the CM theme object — because real
	   media queries are the only reliable switch. */
	.prompt :global(.cm-content) {
		font-family:
			"Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		padding-right: 4.6rem;
		caret-color: #1c1c1e;
	}
	:global(.cm-editor.cm-focused) {
		/* Kills the dotted focus outline some Chromium builds draw. */
		outline: none !important;
	}
	:global(.cm-editor .cm-cursor) {
		/* !important: CodeMirror injects its own cursor styles at runtime,
		   after this stylesheet — only importance wins deterministically. */
		border-left-color: #1c1c1e !important;
	}
	:global(.cm-editor .cm-fat-cursor) {
		background-color: #1c1c1e !important;
		color: #fff;
	}
	@media (prefers-color-scheme: dark) {
		.prompt :global(.cm-content) {
			caret-color: #f2f2f7;
		}
		:global(.cm-editor .cm-cursor) {
			border-left-color: #f2f2f7 !important;
		}
		:global(.cm-editor .cm-fat-cursor) {
			background-color: #f2f2f7 !important;
			color: #17171a;
		}
		:global(.cm-fence-bar) {
			background: #2c2c2e;
		}
		:global(.cm-fence-lang) {
			color: #aeaeb2;
		}
		:global(.cm-fence-bar button) {
			background: #1c1c1e;
			border-color: #48484a;
			color: #f2f2f7;
		}
		:global(.cm-paste-marker) {
			background: #2c2c2e;
			border-color: #48484a;
			color: #f2f2f7;
		}
	}
	/* Centered reading column on wide screens (DeepSeek-web rhythm). */
	article,
	.empty-state,
	.sending {
		align-self: center;
		width: 100%;
		max-width: 46rem;
		box-sizing: border-box;
	}
	.prompt,
	.composer-bar,
	.attachments,
	.review,
	.translate-panel,
	.voice-bar,
	.error-banner,
	footer {
		width: calc(100% - 2.4rem);
		max-width: 46rem;
		margin-left: auto;
		margin-right: auto;
		box-sizing: border-box;
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
		.settings-btn {
			color: #aeaeb2;
		}
		.fold-side:hover {
			color: #f2f2f7;
			border-color: #48484a;
		}
		.voice-float {
			background: #1c1c1e;
			border-color: #48484a;
			color: #98989f;
		}
		.voice-float.on {
			color: #f2f2f7;
			border-color: #aeaeb2;
		}
		.settings-panel {
			background: #17171a;
			border-color: #38383a;
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
		.script-hint button {
			color: #98989f;
		}
		.error-banner {
			background: #3d1008;
			color: #ffb4a2;
		}
		.sent-files {
			color: #98989f;
		}
		.attachments li {
			background: #12233d;
		}
		.attachments .tok {
			color: #98989f;
		}
		.attachments button {
			color: #f2f2f7;
		}
		.preview {
			border-color: #48484a;
		}
		.composer-bar button {
			color: #98989f;
			border-color: #48484a;
		}
		.composer-bar button:hover {
			color: #f2f2f7;
		}
		.sel-menu {
			background: #1c1c1e;
			border-color: #48484a;
		}
		.sel-menu button {
			color: #f2f2f7;
		}
		.sel-menu button:hover {
			background: #2c2c2e;
		}
		.review,
		.translate-panel {
			background: #1c1c1e;
			border-color: #38383a;
		}
		.review-item.highlight {
			background: #12233d;
		}
		.review-head button {
			color: #98989f;
		}
		.review-head button:hover {
			color: #f2f2f7;
		}
		.review-label {
			color: #98989f;
		}
		.review textarea {
			background: #101013;
			border-color: #48484a;
			color: #f2f2f7;
		}
		.review-edit-actions button {
			background: #2c2c2e;
			border-color: #48484a;
			color: #f2f2f7;
		}
		.muted {
			color: #98989f;
		}
		.prompt {
			background: #1c1c1e;
			border-color: #48484a;
		}
		.prompt:focus-within {
			border-color: #aeaeb2;
		}
		.pill-btn {
			color: #98989f;
			border-color: #48484a;
		}
		.lang-chip {
			color: #f2f2f7;
			border-color: #aeaeb2;
		}
		.lang-menu > button,
		.lang-menus .clear {
			color: #f2f2f7;
			border-color: #48484a;
		}
		.lang-menu > button:hover,
		.lang-menus .clear:hover {
			border-color: #aeaeb2;
		}
		.lang-list {
			background: #1c1c1e;
			border-color: #48484a;
		}
		.lang-list button {
			color: #f2f2f7;
		}
		.lang-list button:hover,
		.lang-list button.selected {
			background: #2c2c2e;
		}
		.badge {
			color: #aeaeb2;
			border-color: #48484a;
		}
		footer {
			color: #98989f;
		}
		.send-btn {
			background: #f2f2f7;
			border-color: #f2f2f7;
			color: #1c1c1e;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		* {
			transition: none;
		}
	}
</style>
