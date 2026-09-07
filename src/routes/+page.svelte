<script lang="ts">
	import { onMount } from "svelte";
	import { SvelteSet } from "svelte/reactivity";
	import {
		createChatState,
		formatTokens,
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
		QUICK_LANG_CODES,
		quickKeyFor,
		replyLanguageFor,
		type LanguageMenu
	} from "$lib/languages";
	import { listProviders, createProvider, getProviderDef } from "$lib/providers/registry";
	import { MockProvider, mockProviderEnabled } from "$lib/providers/mock";
	import { getCurrentWindow } from "@tauri-apps/api/window";
	import {
		createPromptEditor,
		type PromptEditor,
		type PromptEditorOptions,
		type SubmitKind
	} from "$lib/editor";
	import { isEjected } from "$lib/session";
	import { hydrateSecrets, persistSecrets, tauriBackendAvailable, withBlankedKeys } from "$lib/secrets";
	import type { ChatProvider } from "$lib/providers/types";
	import MessageBody from "$lib/components/MessageBody.svelte";
	import ActionIcon from "$lib/components/ActionIcon.svelte";
	import SettingsPanel from "$lib/components/SettingsPanel.svelte";
	import { plainBody, sourcesAsked } from "$lib/render";
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
		type SpeakCallbacks
	} from "$lib/voice";
	import {
		speakNative,
		speakNativeWord,
		stopNative,
		friendlyNativeError,
		quoteLangFor,
		currentKeyboardInputSource
	} from "$lib/nativeTts";
	import { voiceLocaleForInputSource } from "$lib/keyboardLang";

	let chatState = $state(createChatState());
	let settings = $state(loadSettings());
	// The chat list always starts closed — a persisted open state never
	// survives a start or refresh.
	settings.sidebarCollapsed = true;

	// Settings save themselves: every change persists (debounced), with
	// secrets mirrored to the Keychain in the Tauri shell. No Save button.
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let skipFirstSave = true;
	$effect(() => {
		const snapshot = $state.snapshot(settings);
		if (skipFirstSave) {
			skipFirstSave = false;
			return;
		}
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveTimer = null;
			void (async () => {
				await persistSecrets(snapshot);
				saveSettings(tauriBackendAvailable() ? withBlankedKeys(snapshot) : snapshot);
			})();
		}, 400);
		return () => {
			if (saveTimer) {
				clearTimeout(saveTimer);
				saveTimer = null;
			}
		};
	});

	if (tauriBackendAvailable()) {
		// Pull Keychain keys into memory before the first send; no-op in browsers.
		void hydrateSecrets(settings);
	}
	let editor: PromptEditor | null = $state(null);
	let promptEl: HTMLElement | undefined = $state();
	let scrollBox: HTMLElement | undefined = $state();
	let focusMode: "edit" | "scroll" = $state("edit");
	let selectedIdx = $state(-1);
	let hoveredIdx = $state(-1);
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
	/** Cursor-anchored annotation pill (ChatGPT-style). Null when closed. */
	let annPop = $state<{ id: string; x: number; y: number; fresh: boolean } | null>(null);
	let annDraft = $state("");
	let annPopBox: HTMLTextAreaElement | undefined = $state();
	/**
	 * First-message landing animation (empty → chat glides down). Skips
	 * the first run: chats restore synchronously from storage, so without
	 * this every load with history would replay the glide on mount.
	 */
	let landTick = $state(false);
	let wasEmpty = true;
	let hydrated = false;
	$effect(() => {
		const empty = chat.messages.length === 0;
		if (hydrated && wasEmpty && !empty) {
			landTick = false;
			const kick = requestAnimationFrame(() => {
				landTick = true;
			});
			const clear = setTimeout(() => {
				landTick = false;
			}, 650);
			return () => {
				cancelAnimationFrame(kick);
				clearTimeout(clear);
			};
		}
		hydrated = true;
		wasEmpty = empty;
	});
	/** The Enter that saves an annotation must never double as a send. */
	let sendGuardUntil = 0;
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
	/** Message a speak-aloud selection came from (tints its selection). */
	let speakingSelection: string | null = $state(null);
	let voiceError: string | null = $state(null);
	let canMic = $state(false);
	let dictating = $state(false);
	let toast: string | null = $state(null);
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	/** Transient top toast (mic errors, copy confirmations). */
	function flashToast(message: string): void {
		if (toastTimer) clearTimeout(toastTimer);
		toast = message;
		toastTimer = setTimeout(() => {
			toast = null;
			toastTimer = null;
		}, 4000);
	}
	function dismissToast(): void {
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = null;
		toast = null;
	}
	let stopDictation: (() => void) | null = null;
	let openLangMenu: LanguageMenu["id"] | null = $state(null);
	const activeReplyLang = $derived(replyLanguageFor(settings.replyLang));
	let settingsOpen = $state(false);
	let shortcutsOpen = $state(false);
	let hasText = $state(false);
	let altHeld = $state(false);
	const canSubmit = $derived(
		hasText || attachments.length > 0 || annotations.length > 0
	);

	function toggleSidebar(): void {
		settings.sidebarCollapsed = !settings.sidebarCollapsed;
		persistSettings();
	}

	/** Unsent composer extras quote one chat's messages — never carry over. */
	function resetDraftExtras(): void {
		annotations = [];
		reviewOpen = false;
		editingId = null;
		editDraft = "";
		highlightAnnId = null;
		annPop = null;
		annDraft = "";
		attachments = [];
		previewId = null;
		selMenu = null;
		translate = null;
	}

	function doNewChat(): void {
		stopVoice();
		resetDraftExtras();
		newChat(chatState);
		scrollBox?.scrollTo({ top: 0 });
		editor?.focus();
	}

	const useMock = mockProviderEnabled();
	const chat = $derived(activeChat(chatState));
	/** The aids hint only earns footer space when aids-eligible text exists. */
	const hasAidText = $derived(chat.messages.some((msg) => detectScript(msg.content)));
	const providerLabel = $derived(
		useMock ? "mock" : getProviderDef(settings.activeProviderId, settings.customProviders).label
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

	function copyPlain(text: string, note: string): void {
		void navigator.clipboard?.writeText(text).catch(() => {});
		flashToast(note);
	}

	function copyText(content: string, role: string): void {
		copyPlain(plainBody(content, role, sourcesWanted), "Copied as plain text");
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
		// Clone the range and drop badge buttons: selecting across an
		// existing annotation would otherwise bake its number into the
		// new quote ("Kyoto1 in two sentences").
		const frag = selection.getRangeAt(0).cloneContents();
		frag.querySelectorAll("[data-ann-badge]").forEach((el) => el.remove());
		const quote = frag.textContent?.trim() ?? "";
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

	/** Annotate at the cursor: the comment pill opens where the selection
	was — never down in the composer. Enter saves, Escape cancels. */
	function annotate(): void {
		if (!selMenu) return;
		annotations = addAnnotation(annotations, selMenu.messageId, selMenu.quote);
		const created = annotations[annotations.length - 1];
		clearSelection();
		const width = 384;
		const x = Math.min(Math.max(8, selMenu.x), window.innerWidth - width - 8);
		const y = Math.min(Math.max(8, selMenu.y), window.innerHeight - 72);
		selMenu = null;
		highlightAnnId = created.id;
		annDraft = "";
		annPop = { id: created.id, x, y, fresh: true };
	}

	function saveAnnPop(fromEnter = false): void {
		if (!annPop) return;
		stopPillMic();
		annotations = editAnnotationComment(annotations, annPop.id, annDraft);
		annPop = null;
		// The highlight lives only while a textbox is open.
		highlightAnnId = null;
		// Only the Enter key needs the anti-double-send guard: a click-away
		// or ✓-click save involves no Enter that could leak into a send.
		if (fromEnter) sendGuardUntil = Date.now() + 500;
		editor?.focus();
	}

	function cancelAnnPop(): void {
		if (!annPop) return;
		const { id, fresh } = annPop;
		stopPillMic();
		annPop = null;
		highlightAnnId = null;
		// Cancel means "as it was": a fresh annotation never existed, so
		// it goes no matter what was typed; an existing one keeps its
		// saved comment (nothing is written until Save).
		if (fresh) {
			annotations = deleteAnnotation(annotations, id);
		}
		editor?.focus();
	}

	function annPopKey(event: KeyboardEvent): void {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			saveAnnPop(true);
		} else if (event.key === "Escape") {
			event.preventDefault();
			cancelAnnPop();
		}
	}

	/** Auto-grow action for the annotation pill. Focuses on open so Enter
	saves immediately without a click. */
	function growPill(node: HTMLTextAreaElement): { destroy(): void } {
		node.focus();
		const fit = () => {
			node.style.height = "auto";
			node.style.height = `${Math.min(node.scrollHeight, 168)}px`;
		};
		node.addEventListener("input", fit);
		fit();
		return {
			destroy: () => node.removeEventListener("input", fit)
		};
	}

	/**
	 * Badge click edits in place: the annotation popover opens at the
	 * badge with the saved comment loaded. Cancel leaves it untouched,
	 * Save writes, trash deletes. The wash shows while editing (it rides
	 * the same highlight as a fresh annotation).
	 */
	function openBadge(id: string, anchor: { x: number; y: number }): void {
		const current = annotations.find((a) => a.id === id);
		if (!current) return;
		stopPillMic();
		editingId = null;
		highlightAnnId = id;
		annDraft = current.comment;
		const width = 384;
		const x = Math.min(Math.max(8, anchor.x - width / 2), window.innerWidth - width - 8);
		const height = 240;
		let y = anchor.y + 8;
		if (y + height > window.innerHeight - 8) y = Math.max(8, anchor.y - height - 8);
		annPop = { id, x, y, fresh: false };
	}

	function saveEdit(id: string): void {
		annotations = editAnnotationComment(annotations, id, editDraft);
		editingId = null;
		highlightAnnId = null;
	}

	function removeAnnotation(id: string): void {
		annotations = deleteAnnotation(annotations, id);
		if (editingId === id) editingId = null;
		if (highlightAnnId === id) highlightAnnId = null;
		if (annPop?.id === id) annPop = null;
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

	function resetVoice(): void {
		speakingId = null;
		speakingSelection = null;
	}

	function stopVoice(): void {
		stopSpeaking();
		stopNative();
		resetVoice();
	}

	function startSpeech(id: string, text: string, lang: string): void {
		stopSpeaking();
		stopNative();
		voiceError = null;
		speakingId = id;
		const useNative = settings.voiceEngine === "native";
		let fellBack = false;
		const callbacks: SpeakCallbacks = {
			onEnd: resetVoice,
			onError: (message) => {
				if (useNative && !fellBack) {
					// The bridge failed: say why, then read this utterance
					// with web voices rather than leaving silence.
					fellBack = true;
					voiceError = `${friendlyNativeError(message)} Falling back to web voices.`;
					const ok = speakText(text, lang, {
						onEnd: resetVoice,
						onError: (webMessage) => {
							voiceError = webMessage;
							resetVoice();
						}
					});
					if (!ok) resetVoice();
					return;
				}
				voiceError = useNative ? friendlyNativeError(message) : message;
				resetVoice();
			}
		};
		const ok = useNative
			? speakNative(text, lang, callbacks, settings.nativeVoiceId)
			: speakText(text, lang, callbacks);
		if (!ok) {
			resetVoice();
			voiceError = "Voice not available.";
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

	function setVoiceEnabled(on: boolean): void {
		settings.voice = on;
		if (!on) stopVoice();
		persistSettings();
	}

	function toggleVoice(): void {
		setVoiceEnabled(!settings.voice);
	}

	/** Raw speech-recognition errors translated into something actionable. */
	function friendlyMicError(message: string): string {
		if (/service-not-allowed/i.test(message)) {
			return "Dictation is blocked in this window — it needs Chrome or Safari.";
		}
		if (/not-allowed|permission/i.test(message)) {
			return "Mic permission denied — allow the microphone and try again.";
		}
		if (/no-speech/i.test(message)) return "Didn't catch anything — try again.";
		if (/audio-capture|not-found|no-microphone/i.test(message)) return "No microphone found.";
		return message;
	}

	/**
	 * Highlight-to-speak: only what was selected, only when asked. The quote
	 * keeps its own language (script detection, then Apple's recognizer for
	 * Latin scripts), so a French highlight gets a French voice even when
	 * the message around it is English.
	 */
	async function speakSelection(): Promise<void> {
		if (!selMenu) return;
		const quote = selMenu.quote;
		const messageId = selMenu.messageId;
		clearSelection();
		selMenu = null;
		speakingSelection = messageId;
		startSpeech("selection", quote, await quoteLangFor(quote, latinFallback()));
	}

	/** Pill-mic dictation into the annotation comment box. */
	let pillDictating = $state(false);
	let stopPillDictation: (() => void) | null = null;
	function stopPillMic(): void {
		stopPillDictation?.();
		stopPillDictation = null;
		pillDictating = false;
	}
	function togglePillMic(): void {
		if (stopPillDictation) {
			stopPillMic();
			return;
		}
		dismissToast();
		const stop = dictateOnce(
			latinFallback(),
			(transcript) => {
				annDraft =
					annDraft === "" || annDraft.endsWith(" ") ? annDraft + transcript : `${annDraft} ${transcript}`;
				stopPillMic();
			},
			(message) => {
				flashToast(friendlyMicError(message));
				stopPillMic();
			}
		);
		if (!stop) {
			flashToast("Mic input not available in this browser.");
			return;
		}
		stopPillDictation = stop;
		pillDictating = true;
	}

	function toggleMic(): void {
		if (dictating) {
			stopDictation?.();
			stopDictation = null;
			dictating = false;
			return;
		}
		dismissToast();
		const stop = dictateOnce(
			latinFallback(),
			(transcript) => {
				editor?.insertText(transcript.endsWith(" ") ? transcript : `${transcript} `);
				dictating = false;
				stopDictation = null;
			},
			(message) => {
				flashToast(friendlyMicError(message));
				dictating = false;
				stopDictation = null;
			}
		);
		if (!stop) {
			flashToast("Mic input not available in this browser.");
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
		return createProvider(settings.activeProviderId, conf, settings.customProviders);
	}

	async function doSend() {
		if (!canSubmit) return;
		const provider = resolveProvider();
		if (!provider) {
			missingKey = true;
			return;
		}
		missingKey = false;
		focusMode = "edit";
		stopVoice();
		const text = composerText();
		const outgoing = attachments;
		const outgoingAnnotations = annotations;
		// The prompt empties the moment the message goes out — not when the
		// (possibly long) reply finishes streaming in.
		editor?.clear();
		scrollToBottom();
		await sendMessage(
			chatState,
			provider,
			effectiveSystemPrompt(settings),
			withAnnotations(text, outgoingAnnotations),
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
			annPop = null;
		}
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
		// The annotation pill owns Enter while open, and the Enter that
		// saved it must not double as a send right after.
		if (annPop) return;
		if (kind === "send" && Date.now() < sendGuardUntil) return;
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
		const ids = listProviders(settings.customProviders).map((p) => p.id);
		const next = (ids.indexOf(settings.activeProviderId) + direction + ids.length) % ids.length;
		settings.activeProviderId = ids[next];
		persistSettings();
	}

	function cycleThinking(direction: 1 | -1) {
		settings.thinkingLevel = cycleThinkingLevel(settings.thinkingLevel, direction);
		persistSettings();
	}

	/** Voice locale before a reply language overrode it; restored on clear. */
	let prevVoiceLang: string | null = null;

	function setReplyLang(code: string): void {
		const lang = replyLanguageFor(code);
		if (!lang) return;
		// Stash once per activation, so FR→DE keeps the pre-FR locale.
		if (settings.replyLang == null) prevVoiceLang = settings.voiceLang;
		settings.replyLang = code;
		settings.voiceLang = lang.voice;
		openLangMenu = null;
		persistSettings();
	}

	function clearReplyLang(): void {
		const active = settings.replyLang ? replyLanguageFor(settings.replyLang) : null;
		settings.replyLang = null;
		// Restore the pre-language locale, unless the user picked their own
		// while the language was active.
		if (prevVoiceLang !== null && active && settings.voiceLang === active.voice) {
			settings.voiceLang = prevVoiceLang;
		}
		prevVoiceLang = null;
		openLangMenu = null;
		persistSettings();
	}

	/**
	 * Reset the voice language to the checked keyboard input source
	 * (⇧⌘Delete's second half). Unrecognized layouts and non-Mac runtimes
	 * yield `null` and leave the language untouched — with a toast either
	 * way so the reset never fails silently.
	 */
	async function resetVoiceLangFromKeyboard(): Promise<void> {
		const sourceId = await currentKeyboardInputSource();
		const locale = sourceId ? voiceLocaleForInputSource(sourceId) : null;
		if (!locale) {
			flashToast("Couldn't tell the keyboard layout — voice language unchanged.");
			return;
		}
		settings.voiceLang = locale;
		persistSettings();
		flashToast(`Voice language reset to ${locale} (keyboard).`);
	}

	function chatLabel(createdAt: number, count: number): string {
		const date = new Date(createdAt);
		const today = new Date();
		const sameDay = date.toDateString() === today.toDateString();
		const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
		const day = sameDay ? "Today" : date.toLocaleDateString([], { month: "short", day: "numeric" });
		return `${day} ${time} · ${count} msg`;
	}

	function promptOptions(): PromptEditorOptions {
		return {
			vim: settings.vim,
			onSubmit,
			onHopOut: enterScrollMode,
			onImagePaste: onImagePasted,
			onDocChange: (text) => {
				hasText = text.trim().length > 0;
			}
		};
	}

	function setVimEnabled(on: boolean): void {
		settings.vim = on;
		persistSettings();
		if (!promptEl) return;
		// Vim is a build-time extension set: rebuild the prompt around the
		// current draft so the toggle takes effect immediately.
		const text = editor?.getText() ?? "";
		editor?.destroy();
		editor = createPromptEditor(promptEl, { ...promptOptions(), initialDoc: text });
		editor.focus();
	}

	/**
	 * Fallback window drag: with the native titlebar gone, empty header
	 * space (and the sidebar head) starts a native move. Controls keep
	 * their clicks (buttons and fields are excluded); the browser preview
	 * early-returns. Needs the `core:window:allow-start-dragging`
	 * capability — without it the invoke is denied and the window sits
	 * immovable with no visible error.
	 */
	/** A drag denial already explained itself; don't toast on every grab. */
	let dragWarned = false;
	function dragWindow(event: MouseEvent): void {
		if (event.button !== 0 || !tauriBackendAvailable()) return;
		const target = event.target;
		if (target instanceof HTMLElement && target.closest("button, input, select, textarea, a")) {
			return;
		}
		// The startDragging call stays synchronous in the mousedown dispatch —
		// awaiting first would leave the native drag gesture.
		let drag: Promise<void>;
		try {
			drag = getCurrentWindow().startDragging();
		} catch (error) {
			drag = Promise.reject(error);
		}
		drag.catch((error: unknown) => {
			// A denial here once meant a silently immovable window (the
			// capability missed `core:window:allow-start-dragging`). Never
			// silent again: log always, toast once per session.
			const message = error instanceof Error ? error.message : String(error);
			console.warn("Window drag failed:", message);
			if (!dragWarned) {
				dragWarned = true;
				flashToast(`Window drag failed: ${message}`);
			}
		});
	}

	onMount(() => {
		// DIAGNOSTIC (send bug): surface silent throws as toasts. REMOVE
		// once the dead-submit cause is found — this is not shipping code.
		window.addEventListener("error", (event) => {
			flashToast(`Error: ${event.message}`);
		});
		window.addEventListener("unhandledrejection", (event) => {
			const reason = event.reason;
			flashToast(`Rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
		});
		if (!promptEl) return;
		editor = createPromptEditor(promptEl, promptOptions());
		editor.focus();
		// Mount-time focus can lose to hydration churn; retry on next frame
		// so a fresh window and a new chat both land in the prompt.
		requestAnimationFrame(() => editor?.focus());

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
			if (event.key === "Escape" && shortcutsOpen) {
				// The modal always wins Esc, even from inside the prompt.
				event.preventDefault();
				event.stopPropagation();
				shortcutsOpen = false;
				return;
			}
			if (event.key === "Escape" && !inEditor) {
				selMenu = null;
				translate = null;
				openLangMenu = null;
				settingsOpen = false;
				shortcutsOpen = false;
				stopVoice();
				return;
			}
			if (
				(event.metaKey || event.ctrlKey) &&
				event.shiftKey &&
				!event.altKey &&
				event.code === "KeyA"
			) {
				// Aids toggle works from anywhere, even inside the prompt.
				event.preventDefault();
				event.stopPropagation();
				toggleReadingAids();
				return;
			}
			if (event.ctrlKey && (event.key === "o" || event.key === "O")) {
				// Thoughts toggle works from anywhere, even inside the prompt.
				event.preventDefault();
				event.stopPropagation();
				toggleThoughts();
				return;
			}
			if (
				(event.metaKey || event.ctrlKey) &&
				!event.altKey &&
				!event.shiftKey &&
				event.key === "Enter"
			) {
				// ⌘Enter sends from anywhere — not just with the prompt
				// focused. Settings fields keep ⌘Enter for themselves.
				if ((event.target as HTMLElement | null)?.closest("input, textarea, select")) return;
				event.preventDefault();
				event.stopPropagation();
				onSubmit("send");
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
			if (event.ctrlKey && event.altKey && event.code === "KeyN") {
				// Physical key code: macOS Option+N reports key "~".
				event.preventDefault();
				event.stopPropagation();
				doNewChat();
				return;
			}
			if (event.ctrlKey && event.altKey && event.code === "KeyV") {
				// Same hard-to-hit family: toggles vim motions in the prompt.
				event.preventDefault();
				event.stopPropagation();
				setVimEnabled(!settings.vim);
				return;
			}
			if (event.ctrlKey && event.altKey && event.code === "KeyS") {
				event.preventDefault();
				event.stopPropagation();
				setVoiceEnabled(!settings.voice);
				return;
			}
			if (
				(event.metaKey || event.ctrlKey) &&
				event.shiftKey &&
				!event.altKey &&
				(event.key === "Backspace" || event.key === "Delete")
			) {
				// ⌘⇧Delete drops the whole current chat (a blank one takes
				// its place, so the composer never strands) and resets the
				// voice language to the checked keyboard. Mac Delete-key
				// reports Backspace; forward-delete reports Delete. Plain
				// ⌘Delete stays untouched for line-kill habits.
				event.preventDefault();
				event.stopPropagation();
				stopVoice();
				resetDraftExtras();
				deleteChat(chatState, chat.id);
				void resetVoiceLangFromKeyboard();
				editor?.focus();
				return;
			}
			if ((event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey) {
				// Physical key codes: shifted brackets report layout-dependent
				// `key` values ("{" / "}" on US), so match the code instead.
				if (event.code === "BracketLeft") {
					event.preventDefault();
					event.stopPropagation();
					toggleSidebar();
					return;
				}
				if (event.code === "BracketRight") {
					event.preventDefault();
					event.stopPropagation();
					settingsOpen = !settingsOpen;
					return;
				}
				if (event.code === "Slash") {
					// ⇧⌘/ (the "?" chord) toggles the shortcuts modal.
					event.preventDefault();
					event.stopPropagation();
					shortcutsOpen = !shortcutsOpen;
					return;
				}
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
				if (event.key === ",") {
					// ⌘, — the macOS Settings shortcut — toggles the panel.
					event.preventDefault();
					event.stopPropagation();
					settingsOpen = !settingsOpen;
					return;
				}
				const quickIdx = "1234567890".indexOf(event.key);
				if (quickIdx !== -1) {
					// ⌘1…⌘0 toggles the priority language in flag order —
					// pressing the active one's key clears it again.
					const code = QUICK_LANG_CODES[quickIdx];
					if (code) {
						event.preventDefault();
						event.stopPropagation();
						if (settings.replyLang === code) clearReplyLang();
						else setReplyLang(code);
						return;
					}
				}
			}
			if (
				(event.key === "f" || event.key === "F") &&
				!inEditor &&
				hoveredIdx >= 0 &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey &&
				!event.shiftKey &&
				!(event.target as HTMLElement | null)?.closest("input, textarea, select")
			) {
				// F folds/unfolds the hovered message. Vim owns keystrokes
				// inside the prompt, so typing "f" there is untouched.
				const target = chat.messages[hoveredIdx];
				if (target) {
					event.preventDefault();
					toggleFold(target.id);
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
			} else if (
				event.key === "i" ||
				event.key === "Enter" ||
				(event.ctrlKey && (event.key === "g" || event.key === "G"))
			) {
				// Ctrl+G hops both ways (the editor keymap handles edit →
				// scroll; this covers scroll → edit, like I).
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
			// Non-element targets (synthetic document/window events) carry no
			// selection UI — real mouse-ups always target an Element.
			const target = event.target instanceof Element ? event.target : null;
			if (openLangMenu) {
				if (!target?.closest(".lang-menu")) openLangMenu = null;
			}
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
			const fallbackLang = settings.voiceLang?.trim() || "en-US";
			const wordLang = ttsLangFor(word, fallbackLang);
			if (settings.voiceEngine === "native") {
				speakNativeWord(
					word,
					wordLang,
					(message) => {
						flashToast(`${friendlyNativeError(message)} (web voice instead)`);
						speakWord(word, fallbackLang);
					},
					settings.nativeVoiceId
				);
			} else speakWord(word, fallbackLang);
		};
		// Holding Option morphs the send button into "Add +" (stage).
		const onAlt = (event: KeyboardEvent) => {
			if (event.key === "Alt") altHeld = event.type === "keydown";
		};
		const onBlur = () => {
			altHeld = false;
		};
		// Coming back to the window lands you in the prompt (pill box when
		// annotating), so Tab continues from there. Never yank focus out of
		// a field that already holds it.
		const onWinFocus = () => {
			const active = document.activeElement;
			if (
				active &&
				active !== document.body &&
				document.contains(active) &&
				(active.tagName === "INPUT" ||
					active.tagName === "TEXTAREA" ||
					active.tagName === "SELECT" ||
					(active instanceof HTMLElement && active.isContentEditable))
			) {
				return;
			}
			if (annPop && annPopBox) annPopBox.focus();
			else editor?.focus();
		};
		canMic = micAvailable();
		window.addEventListener("focus", onWinFocus);
		window.addEventListener("keydown", onKey, true);
		window.addEventListener("keydown", onAlt);
		window.addEventListener("keyup", onAlt);
		window.addEventListener("blur", onBlur);
		window.addEventListener("focusin", onFocusIn);
		window.addEventListener("mouseup", onMouseUp);
		window.addEventListener("contextmenu", onContextMenu, true);
		return () => {
			window.removeEventListener("focus", onWinFocus);
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("keydown", onAlt);
			window.removeEventListener("keyup", onAlt);
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("focusin", onFocusIn);
			window.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("contextmenu", onContextMenu, true);
			stopSpeaking();
			stopNative();
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
	style="--font-scale: {settings.fontScale}"
>
	<aside class:collapsed={settings.sidebarCollapsed} inert={settings.sidebarCollapsed}>
		<div class="side-head" data-tauri-drag-region role="toolbar" aria-label="Chat list" tabindex="-1" onmousedown={dragWindow}>
			<button
				type="button"
				class="settings-btn"
				title="Close chat list (⌘B)"
				aria-label="Close chat list"
				onclick={toggleSidebar}
			>
				Chats <span class="key-hint" aria-hidden="true">⌘B</span>
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
						onclick={() => {
							resetDraftExtras();
							deleteChat(chatState, item.id);
						}}>×</button
					>
				</li>
			{/each}
		</ul>
		<button type="button" class="new" onclick={() => doNewChat()}>+ New chat</button>
		<button
			type="button"
			class="danger"
			onclick={() => {
				resetDraftExtras();
				deleteAllChats(chatState);
			}}
		>
			Delete all chats
		</button>
	</aside>

	<main class:empty={chat.messages.length === 0} class:land={landTick}>
		{#if toast}
			<div class="toast" role="alert">{toast}</div>
		{/if}
		<header data-tauri-drag-region role="toolbar" aria-label="App" tabindex="-1" onmousedown={dragWindow}>
			<button
				type="button"
				class="settings-btn"
				title="Toggle chat list (⌘B)"
				onclick={toggleSidebar}
			>
				Chats <span class="key-hint" aria-hidden="true">⌘B</span>
			</button>
			<span class="pill">{providerLabel}{useMock ? "" : ` · ${settings.thinkingLevel}`}</span>
			<span class="tokens" title="{total} tokens accrued this chat">{formatTokens(total)} tokens</span>
			{#if activeReplyLang}
				<button
					type="button"
					class="lang-chip"
					title="Reply language — click to clear"
					onclick={clearReplyLang}
				>
					{activeReplyLang.name} <ActionIcon kind="close" />
				</button>
			{/if}
			<span class="spacer"></span>
			<button
				type="button"
				class="pill-btn"
				title="New chat (Ctrl+⌥+N)"
				onclick={doNewChat}
			>
				+ New chat
			</button>
			<button
				type="button"
				class="settings-btn"
				title="Toggle settings (⌘,)"
				aria-expanded={settingsOpen}
				onclick={() => (settingsOpen = !settingsOpen)}
			>
				Settings <span class="key-hint" aria-hidden="true">⌘,</span>
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
					<h1 class="hero">What can I do for you?</h1>
					{#if useMock}
						<p class="mock-note"><strong>Mock provider active.</strong></p>
					{/if}
				</div>
			{/if}
			{#each chat.messages as msg, i (msg.id)}
				{@const script = detectScript(msg.content)}
				{@const aidId = script ? MODEL_AID_FOR_SCRIPT[script] : null}
				{@const streamingThis =
					chatState.sending && msg.role === "assistant" && i === chat.messages.length - 1}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
				<!-- Option-click is mouse-only by design; keyboard users get the Delete button below. -->
				<article
					id="msg-{i}"
					class:user={msg.role === "user"}
					class:assistant={msg.role === "assistant"}
					class:has-hint={script !== null}
					class:selected={focusMode === "scroll" && selectedIdx === i}
					class:speaking={speakingId === msg.id}
					class:speaking-sel={speakingSelection === msg.id}
					onclick={(e) => {
						if (e.altKey) deleteMessage(chatState, i);
					}}
					onmouseenter={() => (hoveredIdx = i)}
					onmouseleave={() => (hoveredIdx = -1)}
				>
					{#if script}
						<div class="script-hint">
							<button
								type="button"
								title="Toggle reading aids (⇧⌘A)"
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
						streaming={streamingThis}
						sourcesWanted={sourcesWanted}
						folded={foldedIds.has(msg.id)}
						marks={marksFor(msg.id)}
						washId={annPop?.id ?? editingId}
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
					{#if !(streamingThis && msg.content.trim() === "")}
					<div class="actions">
						<!-- Always in the row: mounting it only while speaking
						shoves the buttons right, then snaps them back. -->
						<span
							class="speaking-dot"
							class:on={speakingId === msg.id}
							role="status"
							aria-label="Speaking this message"
						></span>
						<button
							type="button"
							class="icon-btn"
							title="Fold this message"
							aria-label={foldedIds.has(msg.id) ? "Unfold this message" : "Fold this message"}
							onclick={() => toggleFold(msg.id)}
						>
							<ActionIcon kind="fold" />
						</button>
						<button
							type="button"
							class="icon-btn"
							title="Copy as plain text"
							aria-label="Copy as plain text"
							onclick={() => copyText(msg.content, msg.role)}
						>
							<ActionIcon kind="copy" />
						</button>
						<button
							type="button"
							class="icon-btn"
							title="Branch from here"
							aria-label="Branch from here"
							onclick={() => branchFrom(chatState, i)}
						>
							<ActionIcon kind="branch" />
						</button>
						<button
							type="button"
							class="icon-btn"
							class:active={speakingId === msg.id}
							title={speakingId === msg.id ? "Stop reading aloud" : "Read this message aloud"}
							aria-label={speakingId === msg.id ? "Stop reading aloud" : "Read this message aloud"}
							aria-pressed={speakingId === msg.id}
							onclick={() => {
								if (speakingId === msg.id) stopVoice();
								else speakReply(msg);
							}}
						>
							<ActionIcon kind="speak" />
						</button>
						<button
							type="button"
							class="icon-btn"
							title="Delete this message (or option-click it)"
							aria-label="Delete this message (or option-click it)"
							onclick={() => deleteMessage(chatState, i)}
						>
							<ActionIcon kind="delete" />
						</button>
						{#if msg.role === "user"}
							<button
								type="button"
								class="icon-btn"
								title="Rerun from here — deletes everything after this message"
								aria-label="Rerun from here — deletes everything after this message"
								onclick={() => rerunFrom(i)}
							>
								<ActionIcon kind="rerun" />
							</button>
						{/if}
						{#if msg.error}
							<span class="error">{msg.error}</span>
							<button type="button" onclick={retryFailed}>Retry</button>
						{/if}
					</div>
					{/if}
				</article>
			{/each}
			{#if chatState.sending}
				<p class="sending" role="status" aria-label="Waiting for a reply">
					Thinking<span class="tdots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
				</p>
			{/if}
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

		<div class="composer-bar">
			{#if annotations.length > 0}
				<div class="ann-wrap" class:pinned={reviewOpen}>
					<button
						type="button"
						class="ann-pill"
						title="Review annotations (hover to peek, click to pin open)"
						aria-expanded={reviewOpen}
						onclick={() => (reviewOpen = !reviewOpen)}
					>
						{annotations.length} annotation{annotations.length === 1 ? "" : "s"}
					</button>
					<button
						type="button"
						class="ann-clear"
						aria-label="Delete all annotations"
						title="Delete all annotations"
						onclick={clearAllAnnotations}
					>
						×
					</button>
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
										<button
											type="button"
											onclick={() => {
												editingId = null;
												highlightAnnId = null;
											}}>Cancel</button
										>
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
				</div>
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
				class:wide={altHeld}
				disabled={!canSubmit}
				title={altHeld ? "Stage (⌥+Enter)" : "Send (Enter)"}
				aria-label={altHeld ? "Stage" : "Send"}
				onclick={(event) => onSubmit(altHeld || event.altKey ? "stage" : "send")}
			>
				{altHeld ? "Add +" : "↑"}
			</button>
		</div>
		{#if vocalizeError}
			<p class="error-banner" role="alert">{vocalizeError}</p>
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
								if (translate?.result) copyPlain(translate.result, "Copied");
							}}
						>
							Copy
						</button>
					</div>
				{/if}
			</div>
		{/if}

		{#if chat.messages.length === 0}
			<div class="lang-menus" aria-label="Reply language">
				{#each LANGUAGE_MENUS as menu (menu.id)}
					<div class="lang-menu">
						<button
							type="button"
							aria-haspopup="true"
							aria-expanded={openLangMenu === menu.id}
							title="Reply in a {menu.label.toLowerCase()} language"
							onclick={() => (openLangMenu = openLangMenu === menu.id ? null : menu.id)}
						>
							<span aria-hidden="true">{menu.marker}</span>
							{menu.label}
						</button>
						{#if openLangMenu === menu.id}
							<div class="lang-list" role="menu">
								{#each menu.languages as lang (lang.code)}
									{@const quickKey = quickKeyFor(lang.code)}
									<button
										type="button"
										role="menuitem"
										class:selected={settings.replyLang === lang.code}
										title={quickKey ? `${lang.name} (${quickKey})` : lang.name}
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
			</div>
		{/if}
		<footer>
			{#if focusMode === "scroll"}
				<span><strong>scroll</strong> j/k move · i back to writing</span>
			{:else if hasAidText}
				<span>⇧⌘a reading aids</span>
			{/if}
		</footer>
	</main>

	{#if selMenu}
		<div class="sel-menu" style="left: {selMenu.x}px; top: {selMenu.y}px" role="menu">
			<button type="button" onclick={annotate}>Annotate</button>
			<button type="button" title="Read only the selection aloud" onclick={speakSelection}>
				Speak aloud
			</button>
		</div>
	{/if}

	{#if annPop}
		<!-- Mousedown on the buttons keeps textarea focus: without it the
		blur-save fires first and Cancel/Delete can never win the race. -->
		<div
			class="ann-pop"
			style="left: {annPop.x}px; top: {annPop.y}px"
			role="dialog"
			aria-label={annPop.fresh ? "Annotate" : "Edit annotation"}
		>
			<textarea
				rows={1}
				bind:this={annPopBox}
				bind:value={annDraft}
				placeholder="Add an optional comment…"
				aria-label="Annotation comment. Enter or clicking away saves, Escape cancels."
				use:growPill
				onkeydown={annPopKey}
				onblur={() => saveAnnPop()}
			></textarea>
			<div class="ann-pop-row">
				<button
					type="button"
					class="ann-tool"
					aria-label="Delete annotation"
					title="Delete annotation"
					onmousedown={(e) => e.preventDefault()}
					onclick={() => {
						if (annPop) {
							removeAnnotation(annPop.id);
							editor?.focus();
						}
					}}
				>
					<ActionIcon kind="delete" />
				</button>
				<span class="ann-pop-spacer"></span>
				<button
					type="button"
					class="ann-tool"
					class:recording={pillDictating}
					aria-label={pillDictating ? "Stop dictation" : "Dictate comment"}
					aria-pressed={pillDictating}
					title="Dictate comment"
					onmousedown={(e) => e.preventDefault()}
					onclick={togglePillMic}
				>
					<ActionIcon kind="mic" />
				</button>
				<button
					type="button"
					class="ann-cancel"
					onmousedown={(e) => e.preventDefault()}
					onclick={cancelAnnPop}>Cancel</button
				>
				<button
					type="button"
					class="ann-save"
					onmousedown={(e) => e.preventDefault()}
					onclick={() => saveAnnPop()}>Save</button
				>
			</div>
		</div>
	{/if}

	<aside
		class="settings-panel"
		class:closed={!settingsOpen}
		aria-label="Settings"
		inert={!settingsOpen}
	>
		<!-- Fixed-width inner: the panel clips instead of reflowing text mid-collapse. -->
		<div class="settings-inner">
			<SettingsPanel
			settings={settings}
			onClose={() => (settingsOpen = false)}
			onVimChange={setVimEnabled}
			onVoiceChange={setVoiceEnabled}
			onShortcuts={() => (shortcutsOpen = true)}
		/>
		</div>
	</aside>

	{#if shortcutsOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<!-- Backdrop click only; keyboard users get Esc and the × button. -->
		<div
			class="modal-veil"
			onclick={(e) => {
				if (e.target === e.currentTarget) shortcutsOpen = false;
			}}
		>
			<div class="modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-heading">
				<div class="modal-head">
					<h2 id="shortcuts-heading">Keyboard shortcuts</h2>
					<button
						type="button"
						aria-label="Close shortcuts"
						title="Close (⇧⌘/)"
						onclick={() => (shortcutsOpen = false)}
					>
						×
					</button>
				</div>
				<dl class="keys">
					<div><dt>Send</dt><dd>Enter or ⌘+Enter (or ↑; faded when empty; hold ⌥ for Add +)</dd></div>
					<div><dt>New line</dt><dd>Shift+Enter</dd></div>
					<div><dt>Stage message, no reply</dt><dd>⌥+Enter (seen at the next send, in order)</dd></div>
					<div><dt>New chat</dt><dd>Ctrl+⌥+N</dd></div>
					<div><dt>Chat list show/hide</dt><dd>⌘B</dd></div>
					<div><dt>Settings show/hide</dt><dd>⌘,</dd></div>
					<div><dt>Shortcuts show/hide</dt><dd>⇧⌘/</dd></div>
					<div><dt>Switch model / key</dt><dd>Ctrl+⌥+← / →</dd></div>
					<div><dt>Thinking low / medium / high</dt><dd>Ctrl+⌥+↓ / ↑ (cycles)</dd></div>
					<div><dt>Hop out / back in</dt><dd>Ctrl+G (there and back)</dd></div>
					<div><dt>Scroll messages</dt><dd>J / K, then I or Enter to write again</dd></div>
					<div><dt>Reading aids on/off</dt><dd>⇧⌘A (anywhere)</dd></div>
					<div><dt>Vim motions on/off</dt><dd>Ctrl+⌥+V</dd></div>
					<div><dt>Voice readback on/off</dt><dd>Ctrl+⌥+S</dd></div>
					<div><dt>Speak hovered word</dt><dd>Right-click the word</dd></div>
					<div><dt>Thoughts show/hide</dt><dd>Ctrl+O</dd></div>
					<div><dt>Translate selection</dt><dd>⌘+T (to English; feeds annotation)</dd></div>
					<div><dt>Stop voice / close menus</dt><dd>Esc (outside the prompt)</dd></div>
					<div><dt>Delete a message</dt><dd>Option-click it (or its Delete button)</dd></div>
					<div><dt>Fold / unfold message</dt><dd>F (hover the message first)</dd></div>
					<div><dt>Rerun a prompt</dt><dd>Rerun button (deletes everything after; Branch keeps it)</dd></div>
					<div><dt>Reply language</dt><dd>⌘1…⌘0 (repeat the key to clear)</dd></div>
					<div><dt>Delete this chat + reset voice language to keyboard</dt><dd>⌘+⇧+Delete</dd></div>
				</dl>
				<h3>Vim in the prompt box</h3>
				<p class="modal-note">
					Vim is trapped inside the prompt: type to insert, Esc for normal mode,
					Enter sends in either mode (Shift+Enter is a newline). Ctrl+G hops out
					to message scroll (J/K); I, Enter, or Ctrl+G hops back in. The rest of vim (motions,
					operators, :commands via the vim layer) works where you left it.
				</p>
			</div>
		</div>
	{/if}
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
		/* Never wrap mid-collapse: clip instead of reflowing over itself. */
		white-space: nowrap;
	}
	aside button.active {
		background: #ececf1;
	}
	aside ul button:hover {
		background: #ececf1;
	}
	aside .new:hover {
		border-color: #3a3a3c;
	}
	aside .del:hover {
		color: #c0362c;
	}
	aside .danger:hover {
		background: #ececf1;
	}
	aside .new {
		border-color: #c7c7cc;
	}
	.side-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		/* 0.8rem aside padding + 0.1rem here = the header's 0.9rem. */
		margin-top: 0.1rem;
	}
	/* Sidebar toggles mirror the header text buttons, with the shortcut
	visible on the button itself. */
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
	aside {
		transition:
			width 0.22s ease,
			opacity 0.12s ease,
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
			opacity 0.12s ease,
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
	.settings-inner {
		width: 19.6rem;
		flex-shrink: 0;
		/* Right-docked panels clip from the left: the close × stays put
		while collapsing, so it lands back under the cursor. */
		margin-left: auto;
	}
	.modal-veil {
		position: fixed;
		inset: 0;
		z-index: 60;
		background: rgba(0, 0, 0, 0.35);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
	}
	.modal {
		width: min(34rem, 100%);
		max-height: min(38rem, calc(100vh - 3rem));
		overflow-y: auto;
		background: #fff;
		color: #1c1c1e;
		border: 1px solid #e5e5ea;
		border-radius: 14px;
		box-shadow: 0 12px 48px rgba(0, 0, 0, 0.25);
		padding: 1.2rem 1.4rem 1.4rem;
		box-sizing: border-box;
	}
	.modal-head {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		margin-bottom: 0.5rem;
	}
	.modal-head h2 {
		font-size: 1.05rem;
		font-weight: 700;
		margin: 0;
	}
	.modal-head button {
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
	.modal-head button:hover {
		border-color: #1c1c1e;
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
	.modal h3 {
		font-size: 0.88rem;
		font-weight: 650;
		margin: 1.1rem 0 0.4rem;
	}
	.modal-note {
		font-size: 0.8rem;
		color: #6e6e73;
		margin: 0.2rem 0 0;
	}
	aside .del {
		color: #6e6e73;
	}
	aside .danger {
		margin-top: auto;
		align-self: flex-start;
		/* Deliberately neutral: this is a routine action, not an alarm. */
		color: inherit;
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
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
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
	.lang-chip :global(.action-glyph) {
		height: 0.8rem;
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
	.pill-btn:hover {
		border-color: #3a3a3c;
		color: #1c1c1e;
	}
	.settings-btn {
		display: inline-flex;
		align-items: center;
		line-height: 1;
		font: inherit;
		font-size: 0.82rem;
		color: #3a3a3c;
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0;
		white-space: nowrap;
		white-space: nowrap;
	}
	/* Animated underline: text-decoration snaps, a scaling rule eases. */
	.settings-btn {
		position: relative;
	}
	.settings-btn::after {
		content: "";
		position: absolute;
		left: 0;
		right: 0;
		bottom: -2px;
		height: 1px;
		background: currentColor;
		transform: scaleX(0);
		transform-origin: left center;
		transition: transform 0.18s ease;
		pointer-events: none;
	}
	.settings-btn:hover::after {
		transform: scaleX(1);
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
	/* Overlay traffic lights sit at x:20–72, y:26 (see trafficLightPosition
	in tauri.conf.json). The header clears them with left padding; the
	sidebar head indents by the same amount so both "Chats" buttons start
	at the same x. */
	.app[data-shell="tauri"] header {
		padding-left: 5.75rem;
	}
	.app[data-shell="tauri"] .side-head {
		margin-left: 5.75rem;
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
	main.empty .messages {
		justify-content: center;
		/* Cap the hero zone so the composer rests near the middle,
		not pinned to the bottom. */
		max-height: 42%;
	}
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		padding: 1rem 0.5rem;
	}
	.hero {
		margin: 0;
		text-align: center;
		font-size: 1.65rem;
		font-weight: 650;
		letter-spacing: -0.01em;
	}
	.mock-note {
		margin: 0;
		color: #6e6e73;
		font-size: 0.85rem;
	}
	.lang-menus {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	main.empty .lang-menus {
		justify-content: center;
		padding: 0.55rem 1.2rem 0;
	}
	.lang-menu {
		position: relative;
	}
	.lang-menu > button {
		font-size: 0.82rem;
		border: 1px solid #c7c7cc;
		border-radius: 10px;
		background: none;
		cursor: pointer;
		padding: 0.4rem 0.8rem;
		color: #1c1c1e;
	}
	.lang-menu > button:hover {
		border-color: #1c1c1e;
	}
	.lang-list {
		position: absolute;
		z-index: 40;
		/* Open upward over the composer, never down past it. */
		bottom: calc(100% + 0.35rem);
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
		/* Shrink-wrap so short prompts don't stretch into empty space.
		Beats the centered-column rule's width:100% on specificity;
		margin-right keeps the right edge on the 46rem column. */
		width: fit-content;
		max-width: min(85%, 46rem);
		margin-right: max(0rem, calc((100% - 46rem) / 2));
	}
	article.assistant {
		align-self: center;
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
	.toast {
		position: fixed;
		top: 1rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 100;
		background: #1c1c1e;
		color: #f2f2f7;
		font-size: 0.82rem;
		padding: 0.55rem 1rem;
		border-radius: 999px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		pointer-events: none;
		white-space: nowrap;
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
	@keyframes voice-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}
	/* Pulsing dot on the message currently being read aloud. The slot
	is always reserved (hidden, not absent) so the row never reflows. */
	.speaking-dot {
		width: 0.55rem;
		height: 0.55rem;
		flex-shrink: 0;
		align-self: center;
		border-radius: 50%;
		background: #30a46c;
		visibility: hidden;
	}
	.speaking-dot.on {
		visibility: visible;
		animation: voice-pulse 1.2s ease-in-out infinite;
	}
	/* Pretty default text selection in both themes… */
	:global(::selection) {
		background: rgba(99, 102, 241, 0.28);
	}
	/* …tinted amber on the message a speak-aloud selection came from,
	restored automatically when speech ends. */
	article.speaking-sel ::selection {
		background: rgba(245, 158, 11, 0.45);
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
	/* Cursor-anchored annotation pill (ChatGPT-style): a rounded bar that
	starts as a single-line prompt and grows as you type. Enter saves,
	Shift+Enter adds a line, Escape cancels. Beats the centered-column
	group rule. */
	/* Annotation edit card: dark in both themes (same call as the
	toast) so the quoted-text mockup holds everywhere. */
	.ann-pop {
		position: fixed;
		z-index: 60;
		width: 24rem;
		max-width: calc(100vw - 1rem);
		padding: 1rem 1.1rem 0.9rem;
		border: 1px solid #38383a;
		border-radius: 20px;
		background: #1c1c1e;
		color: #f2f2f7;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
	}
	.ann-pop textarea {
		display: block;
		width: 100%;
		/* Border-box: growPill sizes height from scrollHeight (which already
		includes padding). Content-box would double-count it and push the
		text to the top with dead space below. */
		box-sizing: border-box;
		border: 0;
		background: none;
		resize: none;
		overflow-y: auto;
		font: inherit;
		font-size: 1.05rem;
		line-height: 1.4;
		color: #f2f2f7;
		padding: 0.15rem 0;
		min-height: 4.5rem;
	}
	.ann-pop textarea:focus {
		outline: none;
	}
	.ann-pop textarea::placeholder {
		color: #8e8e93;
	}
	.ann-pop-row {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin-top: 0.8rem;
	}
	.ann-pop-spacer {
		flex: 1;
	}
	.ann-tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 2.2rem;
		height: 2.2rem;
		border: 0;
		border-radius: 50%;
		background: none;
		color: #c7c7cc;
		cursor: pointer;
	}
	.ann-tool:hover {
		color: #fff;
	}
	.ann-tool.recording {
		color: #ff6b62;
	}
	.ann-tool .action-glyph {
		height: 1.25rem;
	}
	.ann-cancel {
		flex: none;
		border: 1px solid #6e6e73;
		border-radius: 999px;
		background: none;
		color: #f2f2f7;
		font: inherit;
		padding: 0.5rem 1.25rem;
		cursor: pointer;
	}
	.ann-cancel:hover {
		border-color: #aeaeb2;
	}
	.ann-save {
		flex: none;
		border: 1px solid #f2f2f7;
		border-radius: 999px;
		background: #f2f2f7;
		color: #1c1c1e;
		font: inherit;
		font-weight: 600;
		padding: 0.5rem 1.4rem;
		cursor: pointer;
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
	/* Merged pill: the wrap carries the single border; the count and ×
	buttons inside are bare segments. Later than .composer-bar button so
	the bare look wins (dark overrides below only recolor). */
	.ann-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
		border: 1px solid #c7c7cc;
		border-radius: 999px;
		background: none;
		padding: 0.2rem 0.25rem 0.2rem 0.8rem;
	}
	.ann-wrap > button {
		border: 0;
		background: none;
		padding: 0 0.45rem;
		font-size: 0.78rem;
		color: #6e6e73;
		cursor: pointer;
	}
	.ann-wrap > button:hover {
		color: #1c1c1e;
	}
	.ann-pill {
		font-weight: 650;
	}
	.ann-wrap > .ann-clear {
		border-left: 1px solid #e5e5ea;
		border-radius: 0;
		line-height: 1.2;
	}
	/* Annotation popover: collapsed to the pill, expands on hover,
	focus, or pinned click. Beats the centered-column group rule. */
	.ann-wrap .review {
		display: none;
		position: absolute;
		bottom: calc(100% + 0.5rem);
		left: 0;
		z-index: 60;
		width: max-content;
		min-width: 16rem;
		max-width: min(30rem, calc(100vw - 3rem));
		max-height: 18rem;
		overflow-y: auto;
		margin: 0;
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
	}
	.ann-wrap .review-quote {
		overflow-wrap: anywhere;
	}
	.ann-wrap:hover .review,
	.ann-wrap:focus-within .review,
	.ann-wrap.pinned .review {
		display: flex;
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
	.actions button.icon-btn {
		display: inline-flex;
		align-items: center;
		line-height: 0;
	}
	.actions button.icon-btn:hover {
		text-decoration: none;
	}
	/* The message being read aloud: its speak button reads as "stop". */
	.actions button.icon-btn.active {
		color: #1f7a4d;
	}

	.error {
		font-size: 0.8rem;
		color: #94250a;
	}
	.sending {
		color: #6e6e73;
		font-size: 0.85rem;
	}
	.tdots span {
		display: inline-block;
		animation: tdot-pulse 1.2s ease-in-out infinite;
	}
	.tdots span:nth-child(2) {
		animation-delay: 0.2s;
	}
	.tdots span:nth-child(3) {
		animation-delay: 0.4s;
	}
	@keyframes tdot-pulse {
		0%,
		100% {
			opacity: 0.2;
		}
		50% {
			opacity: 1;
		}
	}
	/* Hover state changes ease everywhere (reduced-motion keeps these;
	only positional movement is gated there). */
	button {
		transition:
			color 0.15s ease,
			background-color 0.15s ease,
			border-color 0.15s ease,
			opacity 0.15s ease;
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
		padding: 0 0.8rem 2.3rem;
		background: #fff;
		/* Fixed floor so mounting the editor never shifts layout. */
		min-height: 5.2rem;
		box-sizing: border-box;
		/* Ease the outline both in and out of hover. */
		transition: border-color 0.18s ease;
	}
	/* First message: glide the composer down instead of snapping. */
	@keyframes composer-land {
		from {
			opacity: 0.2;
			transform: translateY(-26px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	main.land .prompt,
	main.land .composer-bar {
		animation: composer-land 0.55s cubic-bezier(0.22, 0.9, 0.3, 1);
	}
	.send-btn {
		position: absolute;
		right: 0.6rem;
		bottom: 0.65rem;
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
	.send-btn:hover:not(:disabled) {
		opacity: 0.8;
	}
	.send-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.send-btn.wide {
		width: auto;
		height: auto;
		border-radius: 999px;
		font-size: 0.78rem;
		padding: 0.3rem 0.9rem;
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
	.prompt :global(.cm-editor) {
		/* Beats the CodeMirror theme's own font-size on specificity. */
		font-size: calc(0.95rem * var(--font-scale, 1));
		/* The prompt grows with typing, but never eats the messages:
		past this the editor scrolls internally. */
		max-height: 40vh;
	}
	.prompt :global(.cm-placeholder) {
		color: #8e8e93;
		/* Clicks pass through to the editor so the caret lands by
		   coordinates (start of the empty prompt), not after the hint. */
		pointer-events: none;
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
		.prompt :global(.cm-placeholder) {
			color: #636366;
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
	.lang-menus,
	.attachments,
	.review,
	.translate-panel,
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
	.prompt:hover {
		border-color: #8e8e93;
	}
	.prompt:focus-within:hover {
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
		aside ul button:hover {
			background: #2c2c2e;
		}
		aside .new:hover {
			border-color: #aeaeb2;
		}
		aside .del:hover {
			color: #e89a90;
		}
		aside .danger:hover {
			background: #2c2c2e;
		}
		.side-head .settings-btn:hover {
			color: #f2f2f7;
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
		.side-head .settings-btn {
			color: #aeaeb2;
		}
		.voice-float {
			background: #1c1c1e;
			border-color: #48484a;
			color: #98989f;
		}
		:global(::selection) {
			background: rgba(129, 140, 248, 0.4);
		}
		.voice-float.on {
			color: #f2f2f7;
			border-color: #aeaeb2;
		}
		.settings-panel {
			background: #17171a;
			border-color: #38383a;
		}
		.modal {
			background: #17171a;
			border-color: #38383a;
			color: #f2f2f7;
		}
		.modal-head button {
			border-color: #48484a;
			color: #aeaeb2;
		}
		.modal-head button:hover {
			border-color: #aeaeb2;
			color: #f2f2f7;
		}
		.keys div {
			border-color: #38383a;
		}
		.keys dt {
			color: #aeaeb2;
		}
		.keys dd {
			color: #f2f2f7;
		}
		.modal-note {
			color: #98989f;
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
		.ann-wrap {
			border-color: #48484a;
		}
		.ann-wrap > button {
			color: #98989f;
		}
		.ann-wrap > button:hover {
			color: #f2f2f7;
		}
		.ann-wrap > .ann-clear {
			border-left-color: #38383a;
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
		.ann-pop {
			background: #1c1c1e;
			border-color: #38383a;
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
		.prompt:hover {
			border-color: #636366;
		}
		.prompt:focus-within:hover {
			border-color: #aeaeb2;
		}
		.pill-btn {
			color: #98989f;
			border-color: #48484a;
		}
		.pill-btn:hover {
			border-color: #aeaeb2;
			color: #f2f2f7;
		}
		.lang-chip {
			color: #f2f2f7;
			border-color: #aeaeb2;
		}
		.lang-menu > button {
			color: #f2f2f7;
			border-color: #48484a;
		}
		.lang-menu > button:hover {
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
	/* Reduced motion is not no motion: positional movement goes (the
	landing glide, the sidebar slide, the hover underline), while
	opacity and color transitions stay so state changes still read. */
	@media (prefers-reduced-motion: reduce) {
		main.land .prompt,
		main.land .composer-bar {
			animation: none;
		}
		aside,
		.settings-panel {
			transition:
				opacity 0.12s ease,
				border-color 0.22s ease;
		}
		.settings-btn::after {
			transition: none;
		}
	}
</style>
