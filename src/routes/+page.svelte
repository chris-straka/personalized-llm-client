<script lang="ts">
	import { onMount } from "svelte";
	import { SvelteSet } from "svelte/reactivity";
	import { fade } from "svelte/transition";
	import {
		createChatState,
		formatTokens,
		activeChat,
		newChat,
		selectChat,
		setChatReplyLang,
		deleteChat,
		deleteAllChats,
		deleteMessage,
		stageMessage,
		branchFrom,
		dismissFailedAssistant,
		truncateToMessage,
		resendLast,
		tokenTotal,
		tokenSplit,
		waypoints,
		waypointLabel,
		sendMessage,
		setPasteFold,
		type ChatMsg,
		type ChatId,
		type ChatMsgId
	} from "$lib/chat";
	import {
		loadSettings,
		saveSettings,
		effectiveSystemPrompt,
		activeThinkingSupport,
		activeThinkingId
	} from "$lib/settings";
	import { cycleThinkingId } from "$lib/providers/thinking";
	import {
		LANGUAGE_MENUS,
		QUICK_LANG_CODES,
		quickKeyFor,
		replyLanguageFor,
		type LanguageMenu
	} from "$lib/languages";
	import { listProviders, createProvider } from "$lib/providers/registry";
	import { MockProvider, mockProviderEnabled } from "$lib/providers/mock";
	import { getCurrentWindow } from "@tauri-apps/api/window";
	import {
		createPromptEditor,
		PROMPT_PLACEHOLDER,
		SCROLL_PLACEHOLDER,
		sendPasteFolds,
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
		annotationCountLabel,
		withAnnotations,
		quoteFragmentText,
		newAnnotationId,
		annRefsFor,
		lockSelectionToMessage,
		type Annotation,
		type AnnotationId,
		type AnnotationMark
	} from "$lib/annotations";
	import { createRefMemo } from "$lib/aidLoading";
	import { translateSelection } from "$lib/translate";
	import {
		detectScript,
		localAidFor,
		LOCAL_AID_BUTTON,
		LOCAL_AID_SHOW_ORIGINAL,
		LOCAL_AID_ADD_TITLE,
		MODEL_AIDS,
		MODEL_AID_FOR_SCRIPT,
		extractWordAt,
		speakWord,
		ttsLangFor,
		runModelAid,
		type LocalAid
	} from "$lib/reading";
	import { isFuriganaCached } from "$lib/furigana";
	import {
		speakText,
		speechText,
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
	// Voice readback always starts off for the same reason: every launch
	// begins quiet, no matter what it was left on.
	settings.voice = false;

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
	/** Scrollbar thumb shows while a scroll is in flight, then fades. */
	let scrollIdleTimer: number | undefined;
	function noteScrolling(): void {
		selMenu = null;
		scrollBox?.classList.add("scrolling");
		window.clearTimeout(scrollIdleTimer);
		scrollIdleTimer = window.setTimeout(() => scrollBox?.classList.remove("scrolling"), 200);
	}
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
	/**
	 * Annotation being composed (comment pill open, not yet submitted):
	 * held out of `annotations` so no badge stamps and no count moves
	 * until submit. The id is minted up front so the wash and the pill
	 * already address the annotation it will become.
	 */
	let pendingAnn = $state<Annotation | null>(null);
	let reviewOpen = $state(false);
	/** Waypoint menu pinned open (hover/focus reveal it without pinning). */
	let wpOpen = $state(false);
	let wpWrap: HTMLElement | undefined = $state();
	/** Pinned menu dismisses on outside press: the trigger hides while
	the panel is up, so there is nothing left to toggle it shut. */
	$effect(() => {
		if (!wpOpen) return;
		const onDown = (e: PointerEvent) => {
			if (!(e.target instanceof Element) || !e.target.closest(".wp-wrap")) {
				wpOpen = false;
			}
		};
		window.addEventListener("pointerdown", onDown);
		return () => window.removeEventListener("pointerdown", onDown);
	});
	// The settings panel owns the pointer while open: unmounting the
	// rail above drops hover, and this closes a pinned menu with it.
	$effect(() => {
		if (settingsOpen) wpOpen = false;
	});
	/**
	 * Ticks stay invisible until the pointer comes near the stack (64px):
	 * cheap window mousemove, rAF-throttled, class toggled outside
	 * reactivity so chat never re-renders for pointer travel.
	 */
	$effect(() => {
		const el = wpWrap;
		if (!el || typeof window.matchMedia !== "function") return;
		if (window.matchMedia("(hover: none)").matches) return;
		const R = 64;
		let raf = 0;
		let near = false;
		const set = (v: boolean) => {
			if (v === near) return;
			near = v;
			el.classList.toggle("wp-near", v);
		};
		const onMove = (e: MouseEvent) => {
			if (raf) return;
			const x = e.clientX;
			const y = e.clientY;
			raf = window.requestAnimationFrame(() => {
				raf = 0;
				const r = el.getBoundingClientRect();
				set(x >= r.left - R && x <= r.right + R && y >= r.top - R && y <= r.bottom + R);
			});
		};
		const onLeave = () => {
			if (raf) {
				window.cancelAnimationFrame(raf);
				raf = 0;
			}
			set(false);
		};
		window.addEventListener("mousemove", onMove, { passive: true });
		document.documentElement.addEventListener("mouseleave", onLeave);
		return () => {
			window.removeEventListener("mousemove", onMove);
			document.documentElement.removeEventListener("mouseleave", onLeave);
			if (raf) window.cancelAnimationFrame(raf);
		};
	});
	/** Keyboard cursor over the sidebar chat list (-1 = follow mouse). */
	let sideIdx = -1;
	/** Last lone "g" timestamp (gg hops to the top of history). */
	let lastGAt = 0;
	let editingId: AnnotationId | null = $state(null);
	let editDraft = $state("");
	let highlightAnnId: AnnotationId | null = $state(null);
	/** Badge currently hovered (paints its quote wash as a preview). */
	let hoverBadgeId: string | null = $state(null);
	/** Cursor-anchored annotation pill (ChatGPT-style). Null when closed. */
	let annPop = $state<{ id: string; x: number; y: number; fresh: boolean } | null>(null);
	/** Pill fade-out in flight (unmounts when the ramp ends). */
	let annPopClosing = $state(false);
	let annPopTimer: ReturnType<typeof setTimeout> | null = null;
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
		messageId: ChatMsgId;
	} | null>(null);
	/**
	 * An unanswered selection menu never lingers: it fades out two
	 * seconds after opening (clicking away still dismisses instantly).
	 */
	let selMenuTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		if (!selMenu) return;
		if (selMenuTimer) clearTimeout(selMenuTimer);
		selMenuTimer = setTimeout(() => {
			selMenuTimer = null;
			selMenu = null;
		}, 2000);
		return () => {
			if (selMenuTimer) {
				clearTimeout(selMenuTimer);
				selMenuTimer = null;
			}
		};
	});
	let translate = $state<{
		quote: string;
		messageId: ChatMsgId;
		result: string | null;
		error: string | null;
		busy: boolean;
	} | null>(null);
	let vocalized = $state<Record<string, string>>({});
	let vocalizing = new SvelteSet<string>();
	/** Aid runs clicked mid-flight that must pin on completion. */
	let pendingPin = new SvelteSet<string>();
	/** Messages whose aid is pinned on (model-aid text or local ruby). */
	let aidPin = new SvelteSet<string>();
	/** Messages whose local aid (furigana dictionary) is loading right now. */
	let aidBusy = new SvelteSet<string>();
	/** Message currently hover-previewing its aid (null when none). */
	let aidPeek = $state<{ id: string } | null>(null);
	/**
	 * Peek lock: clicking swaps the button under a stationary cursor, and the
	 * browser re-fires mouseenter for the swap — without this, unpinning
	 * would instantly re-preview. Cleared by a genuine mouse leave, so the
	 * next enter is a real hover and may peek a loaded aid.
	 */
	let aidNoPeek = new SvelteSet<string>();
	/**
	 * Local aids pinned at least once. The first hover of an aid button is
	 * color-only; only after a first pin may hovers preview the readings.
	 */
	let aidSeen = new SvelteSet<string>();
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
		}, 8000);
	}
	function dismissToast(): void {
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = null;
		toast = null;
	}
	let stopDictation: (() => void) | null = null;
	let openLangMenu: LanguageMenu["id"] | null = $state(null);
	const activeReplyCode = $derived(
		chatState.chats.find((c) => c.id === chatState.activeChatId)?.replyLang ?? null
	);
	const activeReplyLang = $derived(
		activeReplyCode ? replyLanguageFor(activeReplyCode) : null
	);
	let settingsOpen = $state(false);
	/**
	 * Opening/closing settings shifts layout under a stationary cursor,
	 * leaving a stale pointer behind (browsers refresh the cursor on
	 * mousemove, not on our width transition). A one-frame
	 * pointer-events pulse forces a re-hit-test so the cursor matches
	 * whatever is actually underneath now.
	 */
	function pulseCursor(): void {
		const root = document.documentElement;
		root.style.pointerEvents = "none";
		requestAnimationFrame(() => {
			root.style.pointerEvents = "";
		});
	}
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

	/** Pointer-down spot for click-off-to-close (select-drags must not count). */
	let mainDown: { x: number; y: number } | null = null;
	function noteMainDown(event: PointerEvent): void {
		if (!settingsOpen) return;
		mainDown = { x: event.screenX, y: event.screenY };
	}
	/**
	 * Clicking off the settings panel into the main chat closes it.
	 * Controls tagged data-settings-toggle manage the panel themselves
	 * and are skipped; drags (text selection) are not plain clicks.
	 */
	function closeSettingsFromMain(event: MouseEvent): void {
		if (!settingsOpen) return;
		const down = mainDown;
		mainDown = null;
		if (down && Math.hypot(event.screenX - down.x, event.screenY - down.y) > 5) return;
		if (event.target instanceof Element && event.target.closest("[data-settings-toggle]")) {
			return;
		}
		settingsOpen = false;
	}

	/** Focus a sidebar chat button by list position (clamped). */
	function focusSideChat(index: number): void {
		const items = [...document.querySelectorAll("aside ul li button.side-chat")];
		if (items.length === 0) return;
		sideIdx = Math.min(Math.max(index, 0), items.length - 1);
		const el = items[sideIdx] as HTMLElement;
		el.focus();
		el.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}

	/** Opening lands keyboard users on the first chat (renders async). */
	function focusFirstSideChat(): void {
		requestAnimationFrame(() => focusSideChat(0));
	}

	/**
	 * Step through chats with the sidebar closed: +1 goes down (newer,
	 * toward the bottom of the stack), -1 goes up (older). Past the
	 * newest end, a chat with messages mints one fresh chat below it —
	 * never a second while it is still empty, so repeats can't pile up
	 * blanks.
	 */
	function stepChat(direction: 1 | -1): void {
		const chats = chatState.chats;
		if (chats.length === 0) return;
		const at = Math.max(
			chats.findIndex((c) => c.id === chatState.activeChatId),
			0
		);
		const next = at + direction;
		if (next < 0) return;
		if (next >= chats.length) {
			if (chats[at]?.messages.length === 0) {
				enterEditMode();
				return;
			}
			resetDraftExtras();
			newChat(chatState);
			scrollBox?.scrollTo({ top: 0, behavior: "smooth" });
			enterEditMode();
			return;
		}
		const target = chats[next];
		if (!target) return;
		sideIdx = next;
		selectChat(chatState, target.id);
		enterEditMode();
	}

	/** Enter the cursor chat from the keyboard and land in its prompt. */
	function enterSideChat(): void {
		const chats = chatState.chats;
		if (chats.length === 0) return;
		const item = chats[Math.min(Math.max(sideIdx, 0), chats.length - 1)];
		if (!item) return;
		sideIdx = chats.indexOf(item);
		selectChat(chatState, item.id);
		enterEditMode();
	}

	/** Unsent composer extras quote one chat's messages — never carry over. */
	function resetDraftExtras(): void {
		annotations = [];
		reviewOpen = false;
		editingId = null;
		editDraft = "";
		highlightAnnId = null;
		settleAnnPop();
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
		scrollBox?.scrollTo({ top: 0, behavior: "smooth" });
		editor?.focus();
	}

	const useMock = mockProviderEnabled();
	const chat = $derived(activeChat(chatState));
	const total = $derived(tokenTotal(chatState));
	const split = $derived(tokenSplit(chatState));
	const points = $derived(waypoints(chatState));
	const sourcesWanted = $derived(
		sourcesAsked(chat.messages.filter((m) => m.role === "user").map((m) => m.content))
	);


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

	function toggleFold(id: ChatMsgId): void {
		if (foldedIds.has(id)) foldedIds.delete(id);
		else foldedIds.add(id);
	}

	function copyPlain(text: string, note: string): void {
		const failed = "Couldn't copy to the clipboard.";
		const done = navigator.clipboard?.writeText(text);
		if (!done) {
			flashToast(failed);
			return;
		}
		void done.then(
			() => flashToast(note),
			() => flashToast(failed)
		);
	}

	function copyText(content: string, role: string): void {
		copyPlain(plainBody(content, role, sourcesWanted), "Copied as plain text");
	}

	/** Clicking the toast copies its text. Success stays silent by
	design: flashing a confirmation would overwrite the very text being
	copied. Failure still says so (guarded against clobbering a newer
	toast that landed meanwhile). */
	function copyToast(): void {
		if (!toast) return;
		const text = toast;
		const done = navigator.clipboard?.writeText(text);
		if (!done) {
			flashToast("Couldn't copy to the clipboard.");
			return;
		}
		void done.catch(() => {
			if (toast === text) flashToast("Couldn't copy to the clipboard.");
		});
	}

	function toggleThoughts(): void {
		const blocks = scrollBox?.querySelectorAll("details.ccez-thoughts");
		if (!blocks || blocks.length === 0) return;
		const open = [...blocks].some((b) => !(b as HTMLDetailsElement).open);
		blocks.forEach((b) => {
			(b as HTMLDetailsElement).open = open;
		});
	}

	/** Article element owning a DOM node, or null outside messages. */
	function articleOf(node: Node | null): Element | null {
		const element = node instanceof Element ? node : node?.parentElement;
		return element?.closest('article[id^="msg-"]') ?? null;
	}

	/** Message id owning the selection anchor, or null outside messages. */
	function selectedMessageId(selection: Selection): ChatMsgId | null {
		const article = articleOf(selection.anchorNode);
		if (!article) return null;
		const index = Number(article.id.slice(4));
		return chat.messages[index]?.id ?? null;
	}

	function currentQuote(): { quote: string; messageId: ChatMsgId } | null {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed) return null;
		const inRendered = selection.anchorNode instanceof Element
			? selection.anchorNode
			: selection.anchorNode?.parentElement;
		if (!inRendered?.closest(".rendered")) return null;
		// Clone the range and drop badge buttons and ruby readings:
		// selecting across an existing annotation would otherwise bake
		// its number into the new quote ("Kyoto1 in two sentences"),
		// and ruby would bake its readings in with the base text.
		const frag = selection.getRangeAt(0).cloneContents();
		const quote = quoteFragmentText(frag);
		if (!quote) return null;
		const messageId = selectedMessageId(selection);
		if (!messageId) return null;
		return { quote, messageId };
	}

	function onSelectEnd(event: MouseEvent): void {
		if (event.altKey) return; // Option-click folds; never a menu.
		// Selections never span messages: a drag crossing into another
		// article trims back to the anchor message's edge first.
		const live = window.getSelection();
		if (live) lockSelectionToMessage(live, articleOf);
		placeSelMenu();
	}

	function placeSelMenu(): void {
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
		let y = rect.top - 47;
		if (y < 8) y = rect.bottom + 8;
		selMenu = { x, y, quote: found.quote, messageId: found.messageId };
	}

	/** Kanji + kana (same ranges as furiganaRuby): spaceless scripts
	where a native double-click word pick is a meaningless fragment. */
	const CJKISH = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u309F\u30A0-\u30FF\u3005]/;

	/** Non-standard engine API (WebKit + Chromium): sentence breaks. */
	interface SelectionModify {
		modify(action: string, direction: string, granularity: string): void;
	}

	/** Triple-clicked CJK text selects its sentence, using the engine's
	own breaks: native word picks stop after a few characters and snag
	on mark/badge element edges, so "select the sentence" never works.
	Spaced scripts keep native word/paragraph selection. The span never
	leaves its article; engines without Selection.modify keep native
	behavior. */
	/** Text position under a click, or null over void (or where the
	engine has no caret API): callers fall back to the selection start. */
	function pointRange(x: number, y: number): { node: Node; offset: number } | null {
		try {
			const at = document.caretRangeFromPoint?.bind(document);
			const range = typeof at === "function" ? at(x, y) : null;
			if (!range) return null;
			return { node: range.startContainer, offset: range.startOffset };
		} catch {
			return null;
		}
	}

	function expandToSentence(from?: { node: Node; offset: number }): boolean {
		const live = window.getSelection();
		if (!live || live.rangeCount === 0 || live.isCollapsed) return false;
		if (!CJKISH.test(live.toString())) return false;
		const range = live.getRangeAt(0);
		const node = from?.node ?? range.startContainer;
		const offset = from?.offset ?? range.startOffset;
		const article = articleOf(node);
		if (!article) return false;
		try {
			const sel = live as unknown as SelectionModify;
			if (typeof sel.modify !== "function") return false;
			live.collapse(node, offset);
			sel.modify("extend", "backward", "sentence");
			const startNode = live.focusNode ?? node;
			const startOffset = live.focusOffset;
			live.collapse(node, offset);
			sel.modify("extend", "forward", "sentence");
			const endNode = live.focusNode ?? node;
			const endOffset = live.focusOffset;
			if (articleOf(startNode) !== article || articleOf(endNode) !== article) {
				live.collapse(node, offset);
				return false;
			}
			live.setBaseAndExtent(startNode, startOffset, endNode, endOffset);
			return true;
		} catch {
			try {
				live.collapse(node, offset);
			} catch {
				// Collapsing back failed: leave the native selection alone.
			}
			return false;
		}
	}

	function clearSelection(): void {
		window.getSelection()?.removeAllRanges();
	}

	/** Annotate at the cursor: the comment pill opens where the selection
	was — never down in the composer. Enter saves, Escape cancels. The
	annotation stays pending (no badge, no count) until submit. */
	function annotate(): void {
		if (!selMenu) return;
		if (!selMenu.quote.trim()) {
			clearSelection();
			selMenu = null;
			return;
		}
		// Starting over submits whatever is being composed first: typed
		// comments are never silently dropped.
		if (pendingAnn) commitPending();
		const pending: Annotation = {
			id: newAnnotationId(),
			messageId: selMenu.messageId,
			quote: selMenu.quote.trim(),
			comment: ""
		};
		pendingAnn = pending;
		clearSelection();
		const width = 384;
		const x = Math.min(Math.max(8, selMenu.x), window.innerWidth - width - 8);
		// The comment box sits a breath below the Annotate menu's
		// anchor: sharing selMenu.y leaves it floating high above tall
		// CJK lines.
		const y = Math.min(Math.max(8, selMenu.y + 2), window.innerHeight - 72);
		selMenu = null;
		highlightAnnId = pending.id;
		annDraft = "";
		settleAnnPop();
		annPop = { id: pending.id, x, y, fresh: true };
	}

	/** Submit the annotation being composed (Enter or Save). The id is
	kept from composition so wash, pill, and badge address one thing. */
	function commitPending(): void {
		const pending = pendingAnn;
		if (!pending) return;
		annotations = [...annotations, { ...pending, comment: annDraft }];
		pendingAnn = null;
	}

	/** Fade the pill out, then unmount it. Data writes stay synchronous
	in the caller — only the unmount (and its highlight) waits out the ramp. */
	function hideAnnPop(): void {
		if (!annPop || annPopClosing) return;
		annPopClosing = true;
		if (annPopTimer) clearTimeout(annPopTimer);
		annPopTimer = setTimeout(() => {
			annPopTimer = null;
			annPop = null;
			annPopClosing = false;
			// The highlight lives only while a textbox is open.
			highlightAnnId = null;
		}, 160);
	}

	/** Opening (or teardown) cancels a fade-out in flight. */
	function settleAnnPop(): void {
		if (annPopTimer) clearTimeout(annPopTimer);
		annPopTimer = null;
		annPopClosing = false;
	}

	function saveAnnPop(fromEnter = false): void {
		if (!annPop || annPopClosing) return;
		stopPillMic();
		if (pendingAnn && annPop.id === pendingAnn.id) commitPending();
		else annotations = editAnnotationComment(annotations, annPop.id, annDraft);
		hideAnnPop();
		// Only the Enter key needs the anti-double-send guard: a click-away
		// save involves no Enter that could leak into a send.
		if (fromEnter) sendGuardUntil = Date.now() + 500;
		editor?.focus();
	}

	/** Clicking off the pill: an empty draft cancels (no ghost empty
	annotations), a typed draft still saves — typed comments are never
	silently dropped. Enter with no text is the way to file an empty one. */
	function blurAnnPop(): void {
		if (!annPop || annPopClosing) return;
		if (annDraft.trim() === "") cancelAnnPop();
		else saveAnnPop();
	}

	function cancelAnnPop(): void {
		if (!annPop || annPopClosing) return;
		const { id, fresh } = annPop;
		stopPillMic();
		hideAnnPop();
		if (pendingAnn && id === pendingAnn.id) {
			// Never submitted: it never existed.
			pendingAnn = null;
		} else if (fresh) {
			// Cancel means "as it was": a fresh annotation never
			// existed, so it goes no matter what was typed; an existing
			// one keeps its saved comment (nothing is written until Save).
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
		// The insert cursor must never yank the messages list.
		node.focus({ preventScroll: true });
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
	function openBadge(id: AnnotationId, anchor: { x: number; y: number }): void {
		// Re-pressing the open badge closes it, like cancel: the edit
		// menu toggles instead of reopening under the cursor.
		if (annPop && !annPopClosing && annPop.id === id) {
			cancelAnnPop();
			return;
		}
		const current = annotations.find((a) => a.id === id);
		if (!current) return;
		stopPillMic();
		editingId = null;
		highlightAnnId = id;
		annDraft = current.comment;
		settleAnnPop();
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
		if (annPop?.id === id) {
			settleAnnPop();
			annPop = null;
		}
	}

	function clearAllAnnotations(): void {
		annotations = clearAnnotations();
		pendingAnn = null;
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
		const createdAnn = annotations[annotations.length - 1];
		if (createdAnn) highlightAnnId = createdAnn.id;
		translate = null;
		reviewOpen = true;
		editingId = null;
	}

	/**
	 * Badge arrays by message, memoized by content: the render effect
	 * subscribes to the array identity, so a freshly built array per
	 * render would re-run every message body on any parent change.
	 */
	const memoMarks = createRefMemo<AnnotationMark>(
		(m) => `${m.id}:${m.number}:${m.quote}:${m.preview === true ? "preview" : "saved"}`
	);
	function marksFor(messageId: ChatMsgId): AnnotationMark[] {
		const saved: AnnotationMark[] = annotations
			.filter((a) => a.messageId === messageId)
			.map((a) => ({ id: a.id, number: annotationNumber(annotations, a.id), quote: a.quote }));
		// A composed-but-unsubmitted annotation washes while its pill is
		// open, but stamps no badge (badges appear on submit only).
		if (pendingAnn && pendingAnn.messageId === messageId) {
			saved.push({
				id: pendingAnn.id,
				number: annotations.length + 1,
				quote: pendingAnn.quote,
				preview: true
			});
		}
		return memoMarks(messageId, saved);
	}

	/** Pinned or hover-peeked model-aid text for a message (tashkeel). */
	function aidedTextFor(msg: ChatMsg): string | null {
		if (aidPeek?.id === msg.id) {
			const cached = vocalized[msg.id];
			if (cached !== undefined) return cached;
		}
		if (aidPin.has(msg.id)) return vocalized[msg.id] ?? null;
		return null;
	}

	/** Text the reading aids see: baked annotation blocks are metadata,
	not prose — detecting or converting them would reserve ruby's room
	for hidden text and grow annotated history. */
	function aidDisplayText(msg: ChatMsg): string {
		return annRefsFor(msg.content)?.text ?? msg.content;
	}

	/** Local-aid override: a pinned or hover-peeked aid renders it,
	otherwise the original stands (aids are per-message only). */
	function localAidOverrideFor(msg: ChatMsg): LocalAid | null | undefined {
		const kind = localAidFor(detectScript(aidDisplayText(msg)));
		if (!kind) return undefined;
		if (aidPin.has(msg.id)) return kind;
		if (aidPeek?.id === msg.id) return kind;
		return undefined;
	}

	/**
	 * Hover in: preview the aid, but only when it is already here (cached
	 * model aid, cached furigana, pinned-before pinyin). Fetching happens
	 * on click alone — hovering must never spend a model call or start
	 * furigana's dictionary load (that work now runs in a worker, but the
	 * rule stands: hover previews, click fetches). The swap lock wins over
	 * everything: right after a click the button under a stationary cursor
	 * is new, not hovered.
	 */
	function peekAid(msg: ChatMsg, aidId: string | null): void {
		if (aidNoPeek.has(msg.id)) return;
		if (aidId) {
			if (vocalized[msg.id] === undefined) return;
		} else {
			// First hover is color-only: previews start after a first pin.
			if (!aidSeen.has(msg.id)) return;
			const display = aidDisplayText(msg);
			if (localAidFor(detectScript(display)) === "furigana" && !isFuriganaCached(display)) {
				return;
			}
		}
		aidPeek = { id: msg.id };
	}

	/**
	 * Hover out: drop the preview and release the swap lock, so the next
	 * enter counts as a genuine hover.
	 */
	function unpeekAid(msg: ChatMsg): void {
		if (aidPeek?.id === msg.id) aidPeek = null;
		aidNoPeek.delete(msg.id);
	}

	/** Track a message's local-aid load without notifying on no-ops. */
	function setAidBusy(id: ChatMsgId, loading: boolean): void {
		if (loading) {
			if (!aidBusy.has(id)) aidBusy.add(id);
		} else if (aidBusy.has(id)) {
			aidBusy.delete(id);
		}
	}

	/** Click on a local-aid button: pin its readings on this message. */
	function pinLocalAid(msg: ChatMsg): void {
		aidPin.add(msg.id);
		if (aidPeek?.id === msg.id) aidPeek = null;
		aidNoPeek.add(msg.id);
		aidSeen.add(msg.id);
	}

	/**
	 * Mouse users: leaving drops focus from the message's buttons, so a
	 * hover-only row hides instead of sticking on focus-within after a
	 * click. Keyboard focus never fires mouseleave, so tabbing through
	 * the row is unaffected.
	 */
	function releaseRowFocus(event: MouseEvent): void {
		const row = event.currentTarget;
		const active = document.activeElement;
		if (
			row instanceof HTMLElement &&
			active instanceof HTMLElement &&
			row.contains(active)
		) {
			active.blur();
		}
	}

	/**
	 * Pointer leaves the whole message: drop the hover index, any stale
	 * aid preview for it, and focus inside it. The aid swap remounts the
	 * body, which can move the actions row out from under a stationary
	 * cursor — then row-level mouseleave never fires, and without this
	 * the row stuck visible on :focus-within with a stale preview.
	 */
	function onArticleLeave(event: MouseEvent, msg: ChatMsg, i: number): void {
		if (hoveredIdx === i) hoveredIdx = -1;
		if (aidPeek?.id === msg.id) aidPeek = null;
		// The pointer genuinely left: release the swap lock with it.
		aidNoPeek.delete(msg.id);
		hoverBadgeId = null;
		releaseRowFocus(event);
	}

	/** "show original": unpin, back to the untouched message. */
	function unapplyAid(msg: ChatMsg): void {
		aidPin.delete(msg.id);
		if (aidPeek?.id === msg.id) aidPeek = null;
		aidNoPeek.add(msg.id);
	}

	/**
	 * Aid load failed (furigana worker or dictionary): release the pin so
	 * the button falls back to the aid name instead of a "show original"
	 * with nothing applied. Only an explicit pin earns a toast.
	 */
	function aidFailed(id: ChatMsgId): void {
		const pinned = aidPin.has(id);
		aidPin.delete(id);
		if (aidPeek?.id === id) aidPeek = null;
		if (pinned) flashToast("Couldn't load the readings for this message.");
	}

	async function runModelAidFor(msg: ChatMsg, aidId: string, pin: boolean): Promise<void> {
		if (vocalized[msg.id] !== undefined) {
			if (pin) {
				aidPin.add(msg.id);
				if (aidPeek?.id === msg.id) aidPeek = null;
				aidNoPeek.add(msg.id);
			}
			return;
		}
		if (vocalizing.has(msg.id)) {
			if (pin) pendingPin.add(msg.id);
			return;
		}
		const provider = resolveProvider();
		if (!provider) {
			vocalizeError = "Set an API key first — open Settings.";
			return;
		}
		vocalizeError = null;
		vocalizing.add(msg.id);
		try {
			const text = await runModelAid(provider, aidId, aidDisplayText(msg));
			vocalized = { ...vocalized, [msg.id]: text };
			const wantPin = pin || pendingPin.has(msg.id);
			pendingPin.delete(msg.id);
			if (wantPin) {
				aidPin.add(msg.id);
				if (aidPeek?.id === msg.id) aidPeek = null;
				aidNoPeek.add(msg.id);
			}
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

	/** Paste-fold toggle: replace the message (never mutate in place). */
	function togglePasteFold(msg: ChatMsg, index: number): void {
		setPasteFold(chatState, msg.id, index, !(msg.pasteFolds?.[index]?.open ?? false));
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

	/**
	 * Voice locale for a whole message: script detection first (reliable
	 * for non-Latin scripts, needs no bridge), then Apple's language
	 * recognizer for Latin scripts (French vs English), else the
	 * voice-language fallback. The reply pill's voice never leaks here:
	 * an English message with the Chinese pill on reads English.
	 */
	async function messageSpeechLang(text: string): Promise<string> {
		const stripped = text.replace(/```[\s\S]*?```/g, " ");
		const scriptLang = ttsLangFor(stripped, "");
		if (scriptLang) return scriptLang;
		return quoteLangFor(stripped, latinFallback());
	}

	async function speakReply(msg: ChatMsg): Promise<void> {
		const text = speechText(msg.content);
		if (!text) return;
		const lang = await messageSpeechLang(text);
		startSpeech(msg.id, text, lang);
	}

	/** Speak-button label. */
	function speakTitle(msg: ChatMsg): string {
		if (speakingId === msg.id) return "Stop reading aloud";
		return "Read this message aloud";
	}

	function maybeSpeakReply(): void {
		if (!settings.voice) return;
		const last = chat.messages[chat.messages.length - 1];
		if (last?.role === "assistant" && !last.error && last.content.trim()) {
			void speakReply(last);
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
	async function speakQuote(quote: string, messageId: ChatMsgId): Promise<void> {
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
		// Paste folds ride the send: same text composerText would give,
		// plus collapsed-paste spans mapped into it (covers image-marker
		// stripping and trim exactly — see sendPasteFolds).
		const { text, folds } = sendPasteFolds(editor?.getText() ?? "", editor?.getPastes() ?? []);
		const outgoing = attachments;
		const outgoingAnnotations = annotations;
		// The prompt empties the moment the message goes out — not when the
		// (possibly long) reply finishes streaming in.
		editor?.clear();
		scrollToBottom();
		await sendMessage(
			chatState,
			provider,
			effectiveSystemPrompt(settings, activeReplyCode),
			withAnnotations(text, outgoingAnnotations),
			{ attachments: outgoing, thinking: activeThinkingId(settings), pasteFolds: folds }
		);
		// Keep drafts when the reply failed so nothing silently drops.
		const sent = chat.messages[chat.messages.length - 1];
		if (sent?.role === "assistant" && !sent.error) {
			attachments = [];
			previewId = null;
			annotations = [];
			pendingAnn = null;
			reviewOpen = false;
			editingId = null;
			highlightAnnId = null;
			settleAnnPop();
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
		await resendLast(chatState, provider, effectiveSystemPrompt(settings, activeReplyCode), {
			thinking: activeThinkingId(settings)
		});
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
		scrollBox?.scrollTo({ top: scrollBox.scrollHeight, behavior: "smooth" });
	}

	function jumpTo(index: number) {
		selectedIdx = index;
		document.getElementById(`msg-${index}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
	}

	function enterScrollMode() {
		focusMode = "scroll";
		// The prompt goes fully dormant: no caret, a hop-back hint, and
		// no typing — keystrokes land on the window, where scroll mode
		// owns the J/K keys and ignores the rest.
		editor?.blur();
		editor?.setPlaceholder(SCROLL_PLACEHOLDER);
		if (selectedIdx < 0 && chat.messages.length > 0) {
			selectedIdx = chat.messages.length - 1;
		}
	}

	function enterEditMode() {
		focusMode = "edit";
		editor?.setPlaceholder(PROMPT_PLACEHOLDER);
		editor?.focus();
	}

	function cycleProvider(direction: 1 | -1) {
		const ids = listProviders(settings.customProviders).map((p) => p.id);
		const next = (ids.indexOf(settings.activeProviderId) + direction + ids.length) % ids.length;
		const id = ids[next];
		if (id === undefined) return;
		settings.activeProviderId = id;
		persistSettings();
	}

	function cycleThinking(direction: 1 | -1) {
		const support = activeThinkingSupport(settings);
		settings.thinking = {
			...settings.thinking,
			[settings.activeProviderId]: cycleThinkingId(support, activeThinkingId(settings), direction)
		};
		persistSettings();
	}

	/**
	 * Voice follow for per-chat pills. appliedPill is the code whose voice
	 * is currently installed; pillBaseVoice is the locale from before it.
	 * Switching chats releases the old pill (restoring the base unless the
	 * user picked their own meanwhile) and installs the new one.
	 */
	let appliedPill: string | null = null;
	let pillBaseVoice: string | null = null;
	$effect(() => {
		const current =
			chatState.chats.find((c) => c.id === chatState.activeChatId) ?? null;
		const code = current?.replyLang ?? null;
		if (code === appliedPill) return;
		const old = appliedPill ? replyLanguageFor(appliedPill) : null;
		if (old && pillBaseVoice !== null && settings.voiceLang === old.voice) {
			settings.voiceLang = pillBaseVoice;
			// The restored value regains its standing, deliberate or not.
			settings.voiceLangPinned = true;
			persistSettings();
		}
		appliedPill = null;
		if (!code) return;
		const lang = replyLanguageFor(code);
		if (!lang) return;
		pillBaseVoice = settings.voiceLang;
		appliedPill = code;
		settings.voiceLang = lang.voice;
		// The pill owns the voice from here: the next launch returns to
		// the system default instead of keeping the override.
		settings.voiceLangPinned = false;
		persistSettings();
	});

	/** Pill lives on the active chat; the voice-follow effect above
	installs its voice. Unknown codes never reach the field. */
	function setReplyLang(code: string): void {
		if (!replyLanguageFor(code)) return;
		setChatReplyLang(chatState, chatState.activeChatId, code);
		openLangMenu = null;
	}

	function clearReplyLang(): void {
		setChatReplyLang(chatState, chatState.activeChatId, null);
		openLangMenu = null;
	}

	/**
	 * Reset the voice language to the checked keyboard input source
	 * (⇧⌘Delete's second half). Silent on success by design; only an
	 * unrecognized layout or non-Mac runtime toasts, since the language
	 * is then left untouched and the reset would otherwise fail silently.
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
	}

	/**
	 * Drop one chat. The voice language follows the checked keyboard only
	 * when nothing with a language is left (a single blank chat remains).
	 */
	function dropChat(id: ChatId): void {
		stopVoice();
		resetDraftExtras();
		deleteChat(chatState, id);
		if (chatState.chats.length === 1 && chatState.chats[0]?.messages.length === 0) {
			void resetVoiceLangFromKeyboard();
		}
	}

	/** Drop every chat, then reset the voice language to the keyboard. */
	function dropAllChats(): void {
		stopVoice();
		resetDraftExtras();
		deleteAllChats(chatState);
		void resetVoiceLangFromKeyboard();
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
			onSubmit,
			onHopOut: enterScrollMode,
			onImagePaste: onImagePasted,
			onDocChange: (text) => {
				hasText = text.trim().length > 0;
			}
		};
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
		if (
			target instanceof HTMLElement &&
			target.closest("button, input, select, textarea, a, .selectable")
		) {
			return;
		}
		// The startDragging call stays synchronous in the mousedown dispatch —
		// awaiting first would leave the native drag gesture.
		let drag: Promise<void>;
		try {
			drag = getCurrentWindow().startDragging();
		} catch (error) {
			drag = Promise.reject(error instanceof Error ? error : new Error(String(error)));
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
			const reason: unknown = event.reason;
			flashToast(`Rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
		});
		if (!promptEl) return;
		editor = createPromptEditor(promptEl, promptOptions());
		editor.focus();
		// Mount-time focus can lose to hydration churn; retry on next frame
		// so a fresh window and a new chat both land in the prompt.
		requestAnimationFrame(() => editor?.focus());
		// First paint can measure while the webview is still settling
		// (window restore, DPR): cached line boxes go stale and the prompt
		// snaps to a new height on the next measure. Settle it up front,
		// after paint, like the window-focus path does.
		requestAnimationFrame(() => requestAnimationFrame(() => editor?.remeasure()));

		const onKey = (event: KeyboardEvent) => {
			const inEditor = (event.target as HTMLElement | null)?.closest(".cm-content");
			if ((event.metaKey || event.ctrlKey) && (event.key === "t" || event.key === "T")) {
				// Translate lookup only hijacks the combo over message text —
				// the prompt and the browser keep it everywhere else.
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
				// Capture phase (see listener below): fires before CodeMirror can
				// swallow the combo, so the shortcuts work from anywhere.
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
			if ((event.metaKey || event.ctrlKey) && !event.altKey && event.code === "KeyN") {
				// New chat from anywhere, even inside the prompt. ⇧⌘N
				// does the same: single-window app, so there is no new
				// window to open. Note: browsers reserve ⌘N for a new
				// window, so in a plain browser tab this never arrives —
				// the shell owns it.
				event.preventDefault();
				event.stopPropagation();
				doNewChat();
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
				dropChat(chat.id);
				editor?.focus();
				return;
			}
			if (
				(event.metaKey || event.ctrlKey) &&
				event.shiftKey &&
				event.altKey &&
				(event.key === "Backspace" || event.key === "Delete")
			) {
				// ⌥⌘⇧Delete drops EVERY chat (a blank one takes their
				// place, so the composer never strands) and resets the
				// voice language to the checked keyboard.
				event.preventDefault();
				event.stopPropagation();
				dropAllChats();
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
					if (!settings.sidebarCollapsed) focusFirstSideChat();
					return;
				}
				if (event.code === "BracketRight") {
					event.preventDefault();
					event.stopPropagation();
					settingsOpen = !settingsOpen;
					return;
				}
				if (event.code === "KeyH") {
					// ⇧⌘H mirrors ⌘B for the chat list.
					event.preventDefault();
					event.stopPropagation();
					toggleSidebar();
					if (!settings.sidebarCollapsed) focusFirstSideChat();
					return;
				}
				if (event.code === "KeyL") {
					// ⇧⌘L mirrors ⌘, for the settings panel.
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
				if (event.code === "KeyJ" || event.code === "KeyK") {
					// ⇧⌘J steps down (newer chat, minting one past the
					// newest end); ⇧⌘K steps up (older). Works sidebar-closed.
					event.preventDefault();
					event.stopPropagation();
					stepChat(event.code === "KeyJ" ? 1 : -1);
					return;
				}
			}
			if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
				const combo = event.key.toLowerCase();
				if (combo === "b") {
					event.preventDefault();
					event.stopPropagation();
					toggleSidebar();
					if (!settings.sidebarCollapsed) focusFirstSideChat();
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
						if (activeReplyCode === code) clearReplyLang();
						else setReplyLang(code);
						return;
					}
				}
				if (
					event.metaKey &&
					!event.ctrlKey &&
					!event.altKey &&
					!event.shiftKey &&
					(event.key === "d" || event.key === "D") &&
					!inEditor &&
					hoveredIdx >= 0 &&
					!(event.target as HTMLElement | null)?.closest("input, textarea, select")
				) {
					// ⌘D deletes the hovered message. Ctrl+D is deliberately
					// excluded: the prompt keeps it for editing and scroll
					// mode uses it to skip down.
					const target = chat.messages[hoveredIdx];
					if (target) {
						event.preventDefault();
						event.stopPropagation();
						deleteMessage(chatState, hoveredIdx);
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
				// F folds/unfolds the hovered message. The prompt owns
				// keystrokes inside it, so typing "f" there is untouched.
				const target = chat.messages[hoveredIdx];
				if (target) {
					event.preventDefault();
					toggleFold(target.id);
					return;
				}
			}
			const inSidebar = (event.target as HTMLElement | null)?.closest("aside");
			if (!settings.sidebarCollapsed && inSidebar) {
				// Open chat list owns its keys: j/k walks chats, space/l
				// enters the cursor chat and lands in its prompt.
				if (
					!event.metaKey &&
					!event.ctrlKey &&
					!event.altKey &&
					(event.key === "j" ||
						event.key === "k" ||
						event.key === "ArrowDown" ||
						event.key === "ArrowUp")
				) {
					event.preventDefault();
					const delta = event.key === "j" || event.key === "ArrowDown" ? 1 : -1;
					const chats = chatState.chats;
					const from =
						sideIdx >= 0 ? sideIdx : chats.findIndex((c) => c.id === chatState.activeChatId);
					focusSideChat(from + delta);
					return;
				}
				if (
					!event.metaKey &&
					!event.ctrlKey &&
					!event.altKey &&
					(event.key === " " || event.key === "l" || event.key === "L")
				) {
					// Space would click the focused button by default; take
					// it over so entering always lands in the prompt.
					event.preventDefault();
					enterSideChat();
					return;
				}
			}
			if (
				event.key === " " &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey &&
				!event.shiftKey &&
				settings.sidebarCollapsed &&
				!(event.target as HTMLElement | null)?.closest(
					"button, a, input, textarea, select, summary, .cm-content, [contenteditable]"
				)
			) {
				// Space mirrors Ctrl+G while the sidebar is out of the way —
				// but never from inside a control, where space belongs to
				// typing and buttons.
				event.preventDefault();
				if (focusMode === "scroll") enterEditMode();
				else enterScrollMode();
				return;
			}
			if (focusMode !== "scroll" || inEditor) return;
			if (event.key === "j" || event.key === "ArrowDown") {
				event.preventDefault();
				lastGAt = 0;
				jumpTo(Math.min(selectedIdx + 1, chat.messages.length - 1));
			} else if (event.key === "k" || event.key === "ArrowUp") {
				event.preventDefault();
				lastGAt = 0;
				jumpTo(Math.max(selectedIdx - 1, 0));
			} else if (event.key === "g" && !event.metaKey && !event.ctrlKey && !event.altKey) {
				// gg hops to the top of history (a lone g starts the beat).
				const now = Date.now();
				if (now - lastGAt < 800) {
					event.preventDefault();
					lastGAt = 0;
					jumpTo(0);
				} else lastGAt = now;
			} else if (event.key === "G" && !event.metaKey && !event.ctrlKey && !event.altKey) {
				event.preventDefault();
				lastGAt = 0;
				jumpTo(chat.messages.length - 1);
			} else if (
				event.ctrlKey &&
				!event.metaKey &&
				!event.altKey &&
				(event.key === "u" || event.key === "U")
			) {
				event.preventDefault();
				lastGAt = 0;
				jumpTo(Math.max(selectedIdx - 4, 0));
			} else if (
				event.ctrlKey &&
				!event.metaKey &&
				!event.altKey &&
				(event.key === "d" || event.key === "D")
			) {
				event.preventDefault();
				lastGAt = 0;
				jumpTo(Math.min(selectedIdx + 4, chat.messages.length - 1));
			} else if (
				event.key === "i" ||
				event.key === "Enter" ||
				(event.ctrlKey && (event.key === "g" || event.key === "G"))
			) {
				// Ctrl+G hops both ways (the editor keymap handles edit →
				// scroll; this covers scroll → edit, like I).
				event.preventDefault();
				lastGAt = 0;
				enterEditMode();
			}
		};
		const onFocusIn = (event: FocusEvent) => {
			if ((event.target as HTMLElement | null)?.closest(".cm-content")) {
				focusMode = "edit";
			}
		};
		// Badge press switches the edit box directly (A → B in one
		// click). Mousedown with preventDefault runs before the open
		// textarea's blur-save can fire, so the current pop saves and
		// the next opens synchronously — no re-stamp race eats the
		// press. The delegated click in MessageBody stays as the
		// keyboard path (Enter); after a mouse press it re-fires
		// harmlessly on the already-open annotation.
		const onBadgePress = (event: MouseEvent) => {
			if (event.button !== 0) return;
			const target = event.target instanceof Element ? event.target : null;
			const badge = target?.closest<HTMLElement>("[data-ann-badge]");
			if (!badge) return;
			event.preventDefault();
			const rect = badge.getBoundingClientRect();
			const id = (badge.dataset.annBadge ?? "") as AnnotationId;
			// A re-press toggles closed (cancel): saving first would
			// restart the fade the toggle is about to cancel.
			if (!(annPop && !annPopClosing && annPop.id === id)) saveAnnPop();
			// Same boundary as MessageBody's badge click: stamped ids.
			openBadge(id, {
				x: rect.left + rect.width / 2,
				y: rect.bottom
			});
		};
		// Double-click summons the menu for the native word pick (the
		// pick finalizes after mouseup, so mouseup alone never sees it).
		// Triple-click in CJK text grows the pick to its sentence.
		const clickGuardsPass = (event: MouseEvent): boolean => {
			if (event.altKey) return false;
			const target = event.target instanceof Element ? event.target : null;
			if (
				target?.closest(".cm-content, .sel-menu, .review, .translate-panel, button, input, textarea")
			) {
				return false;
			}
			return true;
		};
		const onDoubleClick = (event: MouseEvent) => {
			if (!clickGuardsPass(event)) return;
			const live = window.getSelection();
			if (live) lockSelectionToMessage(live, articleOf);
			placeSelMenu();
		};
		const onTripleClick = (event: MouseEvent) => {
			if (event.detail !== 3 || !clickGuardsPass(event)) return;
			const live = window.getSelection();
			if (live) lockSelectionToMessage(live, articleOf);
			// Grow the sentence under the cursor, not the paragraph's
			// first: a triple-click on a later line must select (and
			// anchor the menu to) that line's sentence.
			if (!expandToSentence(pointRange(event.clientX, event.clientY) ?? undefined)) return;
			placeSelMenu();
		};
		// Selection text at the last mousedown: a mouseup that changed
		// nothing started on blank space, so a stale highlight is dropped
		// instead of re-summoning the menu.
		let downSel = "";
		const snapSelection = (): void => {
			downSel = window.getSelection()?.toString() ?? "";
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
			const live = window.getSelection();
			const liveText = live?.toString() ?? "";
			if (!target?.closest(".rendered") && liveText !== "" && liveText === downSel) {
				live?.removeAllRanges();
				selMenu = null;
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
			// Highlighted text wins over the word under the cursor: a
			// right-click with a live message selection reads the whole
			// selection (same per-quote language as the sel-menu button).
			const quoted = currentQuote();
			if (quoted) {
				event.preventDefault();
				void speakQuote(quoted.quote, quoted.messageId);
				return;
			}
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
			if (annPop && annPopBox) annPopBox.focus({ preventScroll: true });
			else {
				// Remeasure first: occlusion or a DPR change while away
				// leaves CodeMirror's cached line boxes stale, and the
				// first keystroke would snap the prompt to a new height.
				editor?.remeasure();
				editor?.focus();
			}
		};
		// Web SpeechRecognition is service-blocked inside the Tauri
		// WKWebView (and there is no native dictation path), so the
		// Mic buttons hide there instead of toasting an error.
		canMic = micAvailable() && !tauriBackendAvailable();
		window.addEventListener("focus", onWinFocus);
		window.addEventListener("keydown", onKey, true);
		window.addEventListener("keydown", onAlt);
		window.addEventListener("keyup", onAlt);
		window.addEventListener("blur", onBlur);
		window.addEventListener("focusin", onFocusIn);
		window.addEventListener("mousedown", onBadgePress, true);
		window.addEventListener("mousedown", snapSelection, true);
		// Secondary scrollers share the main chat's fade: scroll events
		// don't bubble, so catch them on the way down and toggle the
		// same .scrolling class with the same short hold.
		const fadeTimers = new WeakMap<Element, number>();
		const onFadeScroll = (event: Event) => {
			const box = (event.target as Element | null)?.closest?.("[data-fade-scroll]");
			if (!box || box === scrollBox) return;
			box.classList.add("scrolling");
			const pending = fadeTimers.get(box);
			if (pending !== undefined) window.clearTimeout(pending);
			fadeTimers.set(
				box,
				window.setTimeout(() => {
					box.classList.remove("scrolling");
					fadeTimers.delete(box);
				}, 350)
			);
		};
		window.addEventListener("scroll", onFadeScroll, true);
		window.addEventListener("mouseup", onMouseUp);
		window.addEventListener("dblclick", onDoubleClick);
		window.addEventListener("click", onTripleClick);
		window.addEventListener("contextmenu", onContextMenu, true);
		return () => {
			window.removeEventListener("focus", onWinFocus);
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("keydown", onAlt);
			window.removeEventListener("keyup", onAlt);
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("focusin", onFocusIn);
			window.removeEventListener("mousedown", onBadgePress, true);
			window.removeEventListener("mousedown", snapSelection, true);
			window.removeEventListener("scroll", onFadeScroll, true);
			window.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("dblclick", onDoubleClick);
			window.removeEventListener("click", onTripleClick);
			window.removeEventListener("contextmenu", onContextMenu, true);
			window.clearTimeout(scrollIdleTimer);
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
	<aside class:collapsed={settings.sidebarCollapsed} inert={settings.sidebarCollapsed} data-fade-scroll>
		<div class="side-head" data-tauri-drag-region aria-hidden="true" onmousedown={dragWindow}>
		</div>
		<ul>
			{#each chatState.chats as item (item.id)}
				<li>
					<button
						type="button"
						class="side-chat"
						class:active={item.id === chatState.activeChatId}
						onclick={() => {
							sideIdx = chatState.chats.findIndex((c) => c.id === item.id);
							selectChat(chatState, item.id);
						}}
					>
						{chatLabel(item.createdAt, item.messages.length)}
					</button>
					<button
						type="button"
						class="del"
						aria-label="Delete chat"
						onclick={() => {
							dropChat(item.id);
							requestAnimationFrame(() => focusSideChat(sideIdx));
						}}>×</button
					>
				</li>
			{/each}
		</ul>
		<button
			type="button"
			class="new"
			title="New chat (⌘N or ⇧⌘N)"
			aria-label="New chat"
			onclick={() => doNewChat()}
		>
			+
		</button>
	</aside>

	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_no_noninteractive_element_interactions -->
	<!-- Click-off closes the settings panel (keyboard users get Esc and ⌘,). -->
	<main
		class:empty={chat.messages.length === 0}
		class:land={landTick}
		class:plain-user={!settings.ownBubble}
		class:hover-user={settings.hoverUserActions}
		class:hover-assistant={settings.hoverAssistantActions}
		class:alt={altHeld}
		onpointerdown={noteMainDown}
		onclick={closeSettingsFromMain}
	>
		{#if toast}
			<button type="button" class="toast" title="Click to copy" aria-live="polite" transition:fade={{ duration: 160 }} onclick={copyToast}>{toast}</button>
		{/if}
		<header role="toolbar" aria-label="App" tabindex="-1" onmousedown={dragWindow}>
			<button
				type="button"
				class="settings-btn"
				title="Toggle chat list (⌘B)"
				aria-label="Toggle chat list"
				onclick={toggleSidebar}
			>
				<span class="key-hint" aria-hidden="true">⌘B</span>
			</button>
			<span class="tokens-wrap">
				<span class="tokens selectable" title="{total} tokens total this chat">{formatTokens(split.prompt)} in / {formatTokens(split.completion)} out</span>
				{#if activeReplyLang}
					<span class="lang-chip-float" transition:fade={{ duration: 90 }}>
						<button
							type="button"
							class="lang-chip"
							title="Reply language — click to clear"
							onclick={clearReplyLang}
						>
							{activeReplyLang.name} <ActionIcon kind="close" />
						</button>
					</span>
				{/if}
			</span>
			<span class="spacer"></span>
			<div class="top-actions">
				<button
					type="button"
					class="settings-btn"
					title="New chat (⌘N or ⇧⌘N)"
					aria-label="New chat"
					onclick={doNewChat}
				>
					<span class="key-hint" aria-hidden="true">⌘N</span>
				</button>
				<button
					type="button"
					class="settings-btn"
					data-settings-toggle
					title="Toggle settings (⌘,)"
					aria-label="Toggle settings"
					aria-expanded={settingsOpen}
					onclick={() => {
						settingsOpen = !settingsOpen;
						pulseCursor();
					}}
				>
					<span class="key-hint" aria-hidden="true">⌘,</span>
				</button>
			</div>
		</header>

		{#if points.length > 3 && !settingsOpen}
			<nav aria-label="Waypoints">
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="wp-wrap"
					class:open={wpOpen}
					bind:this={wpWrap}
					onkeydown={(e) => {
						if (e.key === "Escape") wpOpen = false;
					}}
				>
					<button
						type="button"
						class="wp-btn"
						data-fade-scroll
						title="Jump to a message"
						aria-label="Jump to a message"
						aria-haspopup="true"
						aria-expanded={wpOpen}
						onclick={() => (wpOpen = !wpOpen)}
					>
						{#each points as index (index)}
							<span class="wp-tick" aria-hidden="true"></span>
						{/each}
					</button>
					<div class="wp-menu" role="menu" aria-label="Waypoints" data-fade-scroll>
						{#each points as index (index)}
							<button
								type="button"
								role="menuitem"
								title={waypointLabel(chat.messages[index]?.content ?? "", 200)}
								onclick={() => {
									jumpTo(index);
									wpOpen = false;
								}}
							>
								{waypointLabel(chat.messages[index]?.content ?? "") || `Message ${index + 1}`}
							</button>
						{/each}
					</div>
				</div>
			</nav>
		{/if}

		<div class="messages" bind:this={scrollBox} onscroll={noteScrolling}>
			{#if chat.messages.length === 0}
				<div class="empty-state">
					<h1 class="hero">What can I do for you?</h1>
					{#if useMock}
						<p class="mock-note"><strong>Mock provider active.</strong></p>
					{/if}
				</div>
			{/if}
			{#each chat.messages as msg, i (msg.id)}
				{@const sentRefs = annRefsFor(msg.content)}
				{@const refsOnly = sentRefs ? sentRefs.text.trim() === "" : false}
				{@const isFolded = refsOnly ? !foldedIds.has(msg.id) : foldedIds.has(msg.id)}
				{@const script = detectScript(sentRefs ? sentRefs.text : msg.content)}
				{@const aidId = script ? MODEL_AID_FOR_SCRIPT[script] : null}
				{@const localKind = localAidFor(script)}
				{@const streamingThis =
					chatState.sending && msg.role === "assistant" && i === chat.messages.length - 1}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
				<!-- Option-click is mouse-only by design; keyboard users get the Fold button below. -->
				<article
					id="msg-{i}"
					class:user={msg.role === "user"}
					class:assistant={msg.role === "assistant"}
					class:selected={focusMode === "scroll" && selectedIdx === i}
					class:speaking={speakingId === msg.id}
					class:speaking-sel={speakingSelection === msg.id}
					onclick={(e) => {
						if (e.altKey) toggleFold(msg.id);
					}}
					onmouseenter={() => (hoveredIdx = i)}
					onmouseleave={(event) => onArticleLeave(event, msg, i)}
				>
					{#if sentRefs && (!refsOnly || isFolded)}
						<!-- Baked annotation block, collapsed above the
						message: the count stays visible like the composer
						pill; hovering (or tabbing to) the number itself
						reveals the saved quotes. Provider context is
						unaffected — only the display is redacted. A
						refs-only message shows the pill only while folded:
						unfolded, the full block is the display. -->
						<div class="ann-refs">
							<button
								type="button"
								class="ann-refs-pill"
								aria-label={sentRefs.refs.length === 1 ? "1 annotation" : `${sentRefs.refs.length} annotations`}
							>
								{annotationCountLabel(sentRefs.refs.length)}
							</button>
							<div class="ann-refs-pop" role="tooltip">
								{#each sentRefs.refs as ref (ref.n)}
									<div class="ann-refs-item">
										<span class="ann-refs-num">{ref.n}.</span>
										<span class="ann-refs-quote">“{ref.quote}”</span>
										{#if ref.comment}
											<span class="ann-refs-comment">{ref.comment}</span>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}
					<div class:bubble={msg.role === "user"}>
						<MessageBody
							message={msg}
							streaming={streamingThis}
							sourcesWanted={sourcesWanted}
							folded={isFolded}
							foldPreview={refsOnly && sentRefs ? sentRefs.refs.map((r) => `"${r.quote}"`).join(" ") : null}
							marks={marksFor(msg.id)}
							washId={annPop?.id ?? editingId ?? hoverBadgeId}
						onBadgeHover={(id: string | null) => (hoverBadgeId = id)}
							onBadgeClick={openBadge}
							onFoldToggle={(index: number) => togglePasteFold(msg, index)}
							textOverride={aidedTextFor(msg)}
							contentOverride={sentRefs ? (refsOnly && !isFolded ? null : sentRefs.text) : null}
							aidPreview={aidPeek?.id === msg.id && !aidPin.has(msg.id)}
							aidOverride={localAidOverrideFor(msg)}
							onAidLoadingChange={(loading: boolean) => setAidBusy(msg.id, loading)}
							onAidError={() => aidFailed(msg.id)}
						/>
					</div>
					{#if msg.attachments && msg.attachments.length > 0}
						<div class="sent-files">
							{#each msg.attachments as att (att.id)}
								<span title="{att.name} · ~{att.tokens} tokens">📎 {att.name}</span>
							{/each}
						</div>
					{/if}
					{#if !(streamingThis && msg.content.trim() === "")}
					<div class="actions" role="group" aria-label="Message actions" onmouseleave={releaseRowFocus}>
						<button
							type="button"
							class="icon-btn"
							class:folded={isFolded}
							data-tip="Fold this message (F or Option-click)"
							aria-label={isFolded ? "Unfold this message" : "Fold this message"}
							onclick={() => toggleFold(msg.id)}
						>
							<ActionIcon kind="fold" />
						</button>
						<button
							type="button"
							class="icon-btn"
							data-tip="Copy as plain text"
							aria-label="Copy as plain text"
							onclick={() => copyText(msg.content, msg.role)}
						>
							<ActionIcon kind="copy" />
						</button>
						<button
							type="button"
							class="icon-btn"
							data-tip="Branch from here"
							aria-label="Branch from here"
							onclick={() => branchFrom(chatState, i)}
						>
							<ActionIcon kind="branch" />
						</button>
						<button
							type="button"
							class="icon-btn"
							class:active={speakingId === msg.id}
							data-tip={speakTitle(msg)}
							aria-label={speakTitle(msg)}
							aria-pressed={speakingId === msg.id}
							onclick={() => {
								if (speakingId === msg.id) stopVoice();
								else void speakReply(msg);
							}}
						>
							<ActionIcon kind="speak" />
						</button>
						<button
							type="button"
							class="icon-btn"
							data-tip="Delete this message (⌘D)"
							aria-label="Delete this message (⌘D)"
							onclick={() => deleteMessage(chatState, i)}
						>
							<ActionIcon kind="delete" />
						</button>
						{#if msg.role === "assistant" && !streamingThis}
							<!-- Reading aids live here, right of delete: hover
							previews, click pins (show original unpins). -->
							{#if aidId}
								{#if aidPin.has(msg.id)}
									<button
										type="button"
										data-tip="Show original"
										onclick={() => unapplyAid(msg)}
									>
										show original
									</button>
								{:else}
									{@const aid = MODEL_AIDS[aidId]}
									{#if aid}
										<button
											type="button"
											data-tip={aid.title}
											disabled={vocalizing.has(msg.id)}
											aria-busy={vocalizing.has(msg.id)}
											onmouseenter={() => peekAid(msg, aidId)}
											onmouseleave={() => unpeekAid(msg)}
											onclick={() => void runModelAidFor(msg, aidId, true)}
										>
											{#if vocalizing.has(msg.id)}
												{aid.button}<span class="tdots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
											{:else}
												{aid.button}
											{/if}
										</button>
									{/if}
								{/if}
							{:else if localKind}
								{@const showOriginal = LOCAL_AID_SHOW_ORIGINAL[localKind]}
								{#if aidPin.has(msg.id)}
									{#if aidBusy.has(msg.id)}
										<button
											type="button"
											data-tip="{LOCAL_AID_BUTTON[localKind]}..."
											onclick={() => unapplyAid(msg)}
										>
											{LOCAL_AID_BUTTON[localKind]}<span class="tdots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
										</button>
									{:else}
										<button
											type="button"
											data-tip={showOriginal}
											onclick={() => unapplyAid(msg)}
										>
											{showOriginal}
										</button>
									{/if}
								{:else}
									<button
										type="button"
										data-tip={LOCAL_AID_ADD_TITLE[localKind]}
										onmouseenter={() => peekAid(msg, null)}
										onmouseleave={() => unpeekAid(msg)}
										onclick={() => pinLocalAid(msg)}
									>
										{LOCAL_AID_BUTTON[localKind]}{#if aidBusy.has(msg.id)}<span class="tdots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>{/if}
									</button>
								{/if}
							{/if}
						{/if}
						{#if msg.role === "user"}
							<button
								type="button"
								class="icon-btn"
								data-tip="Rerun from here — deletes everything after this message"
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
						<!-- Last in the row, always mounted (hidden when idle)
						so it never shoves the buttons around. -->
						<span
							class="speaking-dot"
							class:on={speakingId === msg.id}
							role="status"
							aria-label="Speaking this message"
						></span>
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
					<button
						type="button"
						class="link"
						data-settings-toggle
						onclick={() => {
						settingsOpen = true;
						pulseCursor();
					}}
					>
						Settings</button
					>.
				{:else}
					Set an API key first —
					<button
						type="button"
						class="link"
						data-settings-toggle
						onclick={() => {
						settingsOpen = true;
						pulseCursor();
					}}
					>
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
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="prompt"
			class:has-anns={annotations.length > 0}
			class:has-mic={canMic}
			bind:this={promptEl}
			ondragover={(e) => e.preventDefault()}
			ondrop={(e) => {
				e.preventDefault();
				const files = [...(e.dataTransfer?.files ?? [])];
				if (files.length > 0) void addFiles(files);
			}}
		>
			<div class="prompt-tools">
				{#if annotations.length > 0}
					<div class="ann-wrap" class:pinned={reviewOpen}>
						<button
							type="button"
							class="ann-pill"
							title="Review annotations"
							aria-label={annotations.length === 1 ? "1 annotation" : `${annotations.length} annotations`}
							aria-expanded={reviewOpen}
							onclick={() => (reviewOpen = !reviewOpen)}
						>
							{annotationCountLabel(annotations.length)}
						</button>
						<div class="review" role="dialog" aria-label="Annotations" data-fade-scroll>
							<div class="review-tools">
								<button
									type="button"
									aria-label="Delete all annotations"
									title="Delete all annotations"
									onclick={clearAllAnnotations}
								>
									Clear all
								</button>
							</div>
							{#each annotations as ann, n (ann.id)}
								<div class="review-item" class:highlight={highlightAnnId === ann.id}>
									<div class="review-head">
										<span class="review-num">{n + 1}.</span>
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
											<span class="review-label">note:</span>
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
											<span class="review-label">note:</span>
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
				<button
					type="button"
					class="attach-btn"
					title="Attach images or text files"
					aria-label="Attach images or text files"
					onclick={() => attachInput?.click()}
				>
					<ActionIcon kind="attach" />
				</button>
				{#if canMic}
					<button
						type="button"
						class="mic-btn"
						class:recording={dictating}
						title={dictating ? "Stop dictation" : "Dictate into the prompt"}
						aria-label={dictating ? "Stop dictation" : "Dictate into the prompt"}
						aria-pressed={dictating}
						onclick={toggleMic}
					>
						<ActionIcon kind="mic" />
					</button>
				{/if}
				<button
					type="button"
					class="voice-float"
					class:on={settings.voice}
					title="Toggle voice readback (Ctrl+⌥+S)"
					aria-label="Toggle voice readback"
					aria-pressed={settings.voice}
					onclick={toggleVoice}
				>
					<ActionIcon kind="speak" />
				</button>
			</div>
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
										class:selected={activeReplyCode === lang.code}
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
	</main>

	{#if selMenu}
		<div
			class="sel-menu"
			style="left: {selMenu.x}px; top: {selMenu.y}px"
			role="menu"
			transition:fade={{ duration: 150 }}
		>
			<button type="button" onclick={annotate}>Annotate</button>
		</div>
	{/if}

	{#if annPop}
		<!-- Mousedown on the buttons keeps textarea focus: without it the
		blur-save fires first and Cancel/Delete can never win the race. -->
		<div
			class="ann-pop"
			class:fresh={annPop.fresh}
			class:closing={annPopClosing}
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
				onblur={() => blurAnnPop()}
			></textarea>
			{#if annPop.fresh}
				{#if canMic}
					<button
						type="button"
						class="ann-tool"
						class:recording={pillDictating}
						class:gone={!(pillDictating || annDraft.trim().length === 0)}
						aria-label={pillDictating ? "Stop dictation" : "Dictate comment"}
						aria-pressed={pillDictating}
						aria-hidden={!(pillDictating || annDraft.trim().length === 0)}
						tabindex={pillDictating || annDraft.trim().length === 0 ? 0 : -1}
						title="Dictate comment"
						onmousedown={(e) => e.preventDefault()}
						onclick={togglePillMic}
					>
						<ActionIcon kind="mic" />
					</button>
				{/if}
			{:else}
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
				{#if canMic}
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
				{/if}
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
			{/if}
		</div>
	{/if}

	<aside
		class="settings-panel"
		class:closed={!settingsOpen}
		data-fade-scroll
		aria-label="Settings"
		inert={!settingsOpen}
	>
		<!-- Fixed-width inner: the panel clips instead of reflowing text mid-collapse. -->
		<div class="settings-inner">
			<SettingsPanel
			settings={settings}
			onClose={() => {
			settingsOpen = false;
			pulseCursor();
		}}
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
			<div class="modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-heading" data-fade-scroll>
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
				<p class="modal-note">Chat list (⌘B), new chat (⌘N), settings (⌘,), and send (Enter) are labeled on their buttons.</p>
				<dl class="keys">
					<div><dt>New line</dt><dd>Shift+Enter</dd></div>
					<div><dt>Stage message, no reply</dt><dd>⌥+Enter (seen at the next send, in order)</dd></div>
					<div><dt>Shortcuts show/hide</dt><dd>⇧⌘/</dd></div>
					<div><dt>Switch model / key</dt><dd>Ctrl+⌥+← / →</dd></div>
					<div><dt>Thinking level</dt><dd>Ctrl+⌥+↓ / ↑ (cycles this model's levels)</dd></div>
					<div><dt>Hop out / back in</dt><dd>Ctrl+G or Space (there and back)</dd></div>
					<div><dt>Scroll messages</dt><dd>J / K · gg top · G bottom · Ctrl+U / Ctrl+D skip · Space to write again</dd></div>
					<div><dt>Chat list</dt><dd>⌘B, then J / K · Space or L enters its prompt</dd></div>
					<div><dt>Newer / older chat</dt><dd>⇧⌘J / ⇧⌘K (J mints one past the newest)</dd></div>
					<div><dt>Voice readback on/off</dt><dd>Ctrl+⌥+S</dd></div>
					<div><dt>Speak hovered word</dt><dd>Right-click the word</dd></div>
					<div><dt>Speak highlight</dt><dd>Select text, then right-click it</dd></div>
					<div><dt>Thoughts show/hide</dt><dd>Ctrl+O</dd></div>
					<div><dt>Translate selection</dt><dd>⌘+T (to English; feeds annotation)</dd></div>
					<div><dt>Stop voice / close menus</dt><dd>Esc (outside the prompt)</dd></div>
					<div><dt>Delete a message</dt><dd>⌘D (hover the message first) or its Delete button</dd></div>
					<div><dt>Fold / unfold message</dt><dd>F or Option-click (hover the message first)</dd></div>
					<div><dt>Rerun a prompt</dt><dd>Rerun button (deletes everything after; Branch keeps it)</dd></div>
					<div><dt>Reply language</dt><dd>⌘1…⌘0 (repeat the key to clear)</dd></div>
					<div><dt>Delete this chat</dt><dd>⌘+⇧+Delete</dd></div>
					<div><dt>Delete every chat</dt><dd>⌥+⌘+⇧+Delete</dd></div>
				</dl>
				<h3>Prompt and message scroll</h3>
				<p class="modal-note">
					The prompt is a plain insert box: type, Enter sends
					(Shift+Enter is a newline; inside code both are newlines).
					Ctrl+G (or Space, outside the prompt) hops out to message
					scroll (J/K, gg top, G bottom); I, Enter, Space, or Ctrl+G
					hops back in. J/K also walks the chat list after ⌘B, and
					⇧⌘J / ⇧⌘K steps between chats.
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

	aside .new {
		border-color: #c7c7cc;
	}
	.side-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		/* 0.8rem aside padding + 0.1rem here = the header's 0.9rem. */
		margin-top: 0.1rem;
		/* No controls left (single ⌘B toggle lives in the header): keep
		a grabbable drag strip where the button row was. */
		min-height: 1.25rem;
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
		/* The inline-flex buttons center this; the old -0.1em lift sat
		the kbd box visibly too high. */
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
		padding: 1.2rem 0.7rem 2rem;
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
		width: 20.6rem;
		flex-shrink: 0;
		/* Right-docked panels clip from the left: the header (the close
		target) stays put while collapsing, so it lands back under the cursor. */
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
		width: min(52rem, calc(100vw - 3rem));
		max-height: min(38rem, calc(100vh - 3rem));
		overflow-y: auto;
		background: #fff;
		color: #1c1c1e;
		border: 1px solid #e5e5ea;
		border-radius: 14px;
		box-shadow: 0 12px 48px rgba(0, 0, 0, 0.25);
		padding: 0.9rem 1.4rem 1rem;
		box-sizing: border-box;
	}
	.modal-head {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		margin-bottom: 0.35rem;
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
		display: grid;
		grid-template-columns: 1fr 1fr;
		column-gap: 2rem;
	}
	.keys div {
		display: flex;
		gap: 0.7rem;
		padding: 0.26rem 0;
		border-top: 1px solid #e5e5ea;
		font-size: 0.8rem;
	}
	/* Two-column grid: the whole first row skips the divisor. */
	.keys div:nth-child(-n + 2) {
		border-top: 0;
	}
	.keys dt {
		flex: 0 0 8rem;
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
		/* Chrome, not content: no I-beam, no text selection for the
		native window-drag region to fight over. Buttons keep their
		own pointer cursor. */
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
	}
	/* The right-hand pair (new chat, settings) sits closer together
	than the header's general 1rem rhythm. */
	.top-actions {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}
	/* Chrome recedes so the chat leads: the language pill and waypoint
	ticks rest dimmed until hovered or focused. */
	.lang-chip {
		opacity: 0.55;
		/* Ease the dim in and out (color included); the persistent layer
		keeps the chip's × glyph from re-rasterizing sideways on hover. */
		transition:
			opacity 0.18s ease,
			color 0.18s ease;
		transform: translateZ(0);
	}
	.lang-chip:hover,
	.lang-chip:focus-visible {
		opacity: 1;
	}
	/* Copyable chrome: the model label and token count take the I-beam
	and select like content, and never light up on hover. The header
	stays a drag surface everywhere else (see dragWindow). */
	.selectable {
		user-select: text;
		-webkit-user-select: text;
		cursor: text;
	}
	/* Hidden until the pointer comes near (JS toggles .wp-near by
	distance); nearness alone brings the stack to a dim rest.
	Clickable only while visible. */
	.wp-btn {
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.18s ease;
	}
	/* :global — toggled from JS (mousemove distance), invisible to the
	compiler, so scoping must not prune it. */
	.wp-wrap:global(.wp-near) .wp-btn {
		opacity: 0.35;
		pointer-events: auto;
	}
	.wp-btn:focus-visible {
		opacity: 1;
		pointer-events: auto;
	}
	/* While the panel is up it covers the tick stack, so the trigger
	rests with it: no doubled chrome, and on hover-off the ticks fade
	back only after the menu is gone. Focus keeps its button (the
	:not guard) so keyboard users never tab onto an invisible toggle. */
	.wp-wrap:hover .wp-btn:not(:focus-visible),
	.wp-wrap:focus-within .wp-btn:not(:focus-visible),
	.wp-wrap.open .wp-btn:not(:focus-visible) {
		opacity: 0;
		pointer-events: none;
	}
	@media (hover: none) {
		.wp-btn {
			opacity: 0.35;
			pointer-events: auto;
		}
	}
	.tokens {
		color: #6e6e73;
		white-space: nowrap;
	}
	/* Anchor for the reply-language pill: the pill floats over the
	spacer instead of sitting in flow, so popping it in never moves
	the header. The float (not the button) carries the fade, leaving
	the button's own hover-dim opacity transition alone. */
	.tokens-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
	}
	.lang-chip-float {
		position: absolute;
		left: 100%;
		margin-left: 1rem;
		top: 50%;
		transform: translateY(-50%);
		display: inline-flex;
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

	/* Kbd-only chrome buttons: dim at rest, ease to ink on hover and
	back on leave. No underline anywhere. */
	.settings-btn {
		display: inline-flex;
		align-items: center;
		line-height: 1;
		font: inherit;
		font-size: 0.82rem;
		color: #6e6e73;
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0;
		white-space: nowrap;
		transition: color 0.18s ease;
	}
	.settings-btn:hover {
		color: #1c1c1e;
	}
	.settings-btn .key-hint {
		margin-left: 0;
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
	empty sidebar head indents by the same amount so the chat list
	starts at the same x. */
	.app[data-shell="tauri"] header {
		padding-left: 5.75rem;
		/* Sit the top chrome a touch lower so it centers on the
		native traffic lights instead of riding above them. */
		padding-top: 1.15rem;
	}
	.app[data-shell="tauri"] .side-head {
		margin-left: 5.75rem;
		margin-top: 0.35rem;
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
	/* Waypoint jump menu: a hamburger floating at the viewport's
	middle-right, revealing the message list on hover, focus, or
	pinned click. No strip — the bar is gone. */
	nav[aria-label="Waypoints"] {
		position: fixed;
		right: 1.75rem;
		top: 50%;
		transform: translateY(-50%);
		z-index: 40;
		border: 0;
		padding: 0;
		overflow: visible;
	}
	.wp-wrap {
		position: relative;
	}
	/* One tick per message: the stack grows with the chat, then scrolls. */
	.wp-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		max-height: 4rem;
		overflow-y: auto;
		border: 0;
		background: none;
		padding: 0.3rem 0.15rem;
		cursor: pointer;
		user-select: none;
		-webkit-user-select: none;
	}
	.wp-tick {
		display: block;
		flex-shrink: 0;
		width: 1.3rem;
		height: 3px;
		border-radius: 2px;
		background: currentColor;
	}
	/* The open panel overlaps the tick stack (no dead gap): sliding the
	pointer down off the ticks lands straight on the menu. */
	.wp-menu {
		position: absolute;
		right: 0;
		top: 0;
		z-index: 50;
		min-width: 12rem;
		max-width: 20rem;
		max-height: 60vh;
		overflow-y: auto;
		padding: 0.4rem;
		border: 1px solid #c7c7cc;
		border-radius: 16px;
		background: #fff;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
		/* Fade out first, then hide: the delayed visibility flip keeps
		the panel painted for the whole opacity ramp. */
		opacity: 0;
		visibility: hidden;
		transition:
			opacity 0.18s ease,
			visibility 0s linear 0.18s;
	}
	.wp-wrap:hover .wp-menu,
	.wp-wrap:focus-within .wp-menu,
	.wp-wrap.open .wp-menu {
		/* Reveal now, fade in: the incoming transition governs. */
		opacity: 1;
		visibility: visible;
		transition:
			opacity 0.18s ease,
			visibility 0s;
	}
	.wp-menu button {
		display: block;
		width: 100%;
		text-align: left;
		font-size: 0.85rem;
		color: #1c1c1e;
		border: 0;
		border-radius: 10px;
		background: none;
		cursor: pointer;
		padding: 0.45rem 0.7rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		user-select: none;
		-webkit-user-select: none;
		transition: background-color 0.18s ease;
	}
	.wp-menu button:hover {
		background: #f1f1f4;
	}
	.messages {
		flex: 1;
		overflow-y: auto;
		/* Selection starts at message text only: dragging empty space
		between messages is a plain pointer drag (arrow, no I-beam, no
		stray selection). .rendered re-enables both; buttons keep
		their own pointer cursor. */
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
		/* Fast wheel, eased programmatic jumps. The scrollbar snaps in
		(the .scrolling override below shortens the transition while
		scroll events land) and drifts out slowly once they stop. */
		scroll-behavior: smooth;
		scrollbar-width: thin;
		scrollbar-color: transparent transparent;
		transition: scrollbar-color 0.6s ease;
		padding: 1rem 1.2rem;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
	}
	/* The chat scrollbar stays out of the way: invisible until a scroll
	is in flight (JS toggles .scrolling while scroll events land). */
	.messages::-webkit-scrollbar {
		width: 8px;
	}
	.messages::-webkit-scrollbar-track {
		background: transparent;
	}
	.messages::-webkit-scrollbar-thumb {
		background: transparent;
		border-radius: 4px;
		transition: background-color 0.6s ease;
	}
	.messages:global(.scrolling) {
		scrollbar-color: rgba(142, 142, 147, 0.55) transparent;
		transition: scrollbar-color 0.12s ease;
	}
	.messages:global(.scrolling)::-webkit-scrollbar-thumb {
		background: rgba(142, 142, 147, 0.55);
		transition: background-color 0.12s ease;
	}
	/* Every other scroller fades exactly like the main chat: invisible
	until a scroll is in flight (one capture-phase listener below toggles
	.scrolling with the same short hold). */
	[data-fade-scroll] {
		scrollbar-width: thin;
		scrollbar-color: transparent transparent;
		transition: scrollbar-color 0.6s ease;
	}
	[data-fade-scroll]::-webkit-scrollbar {
		width: 8px;
		height: 8px;
	}
	[data-fade-scroll]::-webkit-scrollbar-track {
		background: transparent;
	}
	[data-fade-scroll]::-webkit-scrollbar-thumb {
		background: transparent;
		border-radius: 4px;
		transition: background-color 0.6s ease;
	}
	[data-fade-scroll]:global(.scrolling) {
		scrollbar-color: rgba(142, 142, 147, 0.55) transparent;
		transition: scrollbar-color 0.12s ease;
	}
	[data-fade-scroll]:global(.scrolling)::-webkit-scrollbar-thumb {
		background: rgba(142, 142, 147, 0.55);
		transition: background-color 0.12s ease;
	}
	/* The two sidebars collapse on width transitions of their own, which
	the shared fade shorthand above would replace: restate the full lists
	here so the scrollbar fade joins the collapse instead of killing it. */
	aside[data-fade-scroll] {
		transition:
			width 0.22s ease,
			opacity 0.18s ease,
			padding 0.22s ease,
			border-width 0.22s ease,
			scrollbar-color 0.6s ease;
	}
	.settings-panel[data-fade-scroll] {
		transition:
			width 0.22s ease,
			opacity 0.12s ease,
			padding 0.22s ease,
			border-color 0.22s ease,
			scrollbar-color 0.6s ease;
	}
	aside[data-fade-scroll]:global(.scrolling) {
		transition:
			width 0.22s ease,
			opacity 0.18s ease,
			padding 0.22s ease,
			border-width 0.22s ease,
			scrollbar-color 0.12s ease;
	}
	.settings-panel[data-fade-scroll]:global(.scrolling) {
		transition:
			width 0.22s ease,
			opacity 0.12s ease,
			padding 0.22s ease,
			border-color 0.22s ease,
			scrollbar-color 0.12s ease;
	}
	/* Same clobber, smaller victims: the waypoint tick stack and its menu
	carry data-fade-scroll for their own overflow, which ate the opacity
	fades. Restate both lists here. */
	.wp-btn[data-fade-scroll] {
		transition:
			opacity 0.18s ease,
			scrollbar-color 0.6s ease;
	}
	.wp-btn[data-fade-scroll]:global(.scrolling) {
		transition:
			opacity 0.18s ease,
			scrollbar-color 0.12s ease;
	}
	.wp-menu[data-fade-scroll] {
		transition:
			opacity 0.18s ease,
			visibility 0s linear 0.18s,
			scrollbar-color 0.6s ease;
	}
	.wp-menu[data-fade-scroll]:global(.scrolling) {
		transition:
			opacity 0.18s ease,
			visibility 0s linear 0.18s,
			scrollbar-color 0.12s ease;
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
		transition: border-color 0.15s ease;
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
		/* Full extent, never a scrollbar: the longest menu is 15 items
		and the list opens upward over the messages. */
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
		transition: background-color 0.15s ease;
	}
	.lang-list button:hover,
	.lang-list button:focus-visible {
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
		/* Text starts only at the message body: dragging anywhere else
		(empty space, action rows) is a plain pointer drag, never an
		I-beam selection. .rendered re-enables both below. */
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
	}
	article.user {
		align-self: flex-end;
		/* Shrink-wrap so short prompts don't stretch into empty space.
		Beats the centered-column rule's width:100% on specificity;
		margin-right keeps the right edge on the 46rem column. */
		width: fit-content;
		max-width: min(85%, 46rem);
		margin-right: max(0rem, calc((100% - 46rem) / 2));
		/* No background or padding here: the bubble wraps the text only,
		so the action row below sits outside it. */
		padding: 0;
	}
	/* Own-message bubble: shrink-wraps the text (never the wider action
	row underneath) and docks hard right, so the side padding matches on
	both sides. Slightly tighter on top, where the text sat low. */
	article.user .bubble {
		background: #f1f1f4;
		border-radius: 1.75rem;
		padding: 0.45rem 1rem 0.55rem;
		text-align: right;
		width: fit-content;
		margin-left: auto;
	}
	/* Structured content stays left-aligned inside own messages: code
	and tables read badly right-aligned. */
	article.user :global(.rendered pre),
	article.user :global(.rendered table),
	article.user :global(.ccez-code) {
		text-align: left;
	}
	article.assistant {
		align-self: center;
		padding-left: 0;
		padding-right: 0;
	}
	/* Unshaded own messages read like replies: no bubble, same flow. */
	main.plain-user article.user .bubble {
		background: none;
		padding: 0.5rem 0 0.6rem;
		text-align: left;
		width: auto;
		margin-left: 0;
	}
	article.selected {
		outline: 2px solid #3a3a3c;
		outline-offset: 2px;
	}
	/* Holding Option arms message click actions (fold/unfold): the
	pointer says clickable where the I-beam says selectable. */
	main.alt article,
	main.alt article * {
		cursor: pointer;
	}
	.sent-files {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.35rem;
		font-size: 0.75rem;
		color: #6e6e73;
	}
	/* Sent-message annotation refs: the baked block collapses to the
	count (like the composer pill); hover or Tab reveals the saved
	quotes in a card above. Content-only — provider context keeps the
	full block. */
	/* Baked-refs count floats above the message (overlay, never
	in-flow): annotated history keeps the exact dimensions of plain
	history. No circle, no border — just the number, quiet. */
	.ann-refs {
		position: absolute;
		top: -0.9rem;
		left: 0.8rem;
		display: flex;
		margin: 0;
	}
	article.user .ann-refs {
		left: auto;
		right: 0.8rem;
	}
	.ann-refs-pill {
		position: relative;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: #6e6e73;
		font-size: 0.72rem;
		font-weight: 650;
		line-height: 1.4;
		padding: 0 0.1rem;
		cursor: default;
	}
	.ann-refs-pop {
		position: absolute;
		bottom: calc(100% + 0.4rem);
		left: 0;
		z-index: 40;
		min-width: 14rem;
		max-width: 24rem;
		background: #1c1c1e;
		color: #f2f2f7;
		border-radius: 10px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		padding: 0.55rem 0.75rem;
		font-size: 0.8rem;
		line-height: 1.45;
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s ease;
	}
	article.user .ann-refs-pop {
		left: auto;
		right: 0;
	}
	/* The number itself summons the card — not the row around it. The
	invisible bridge keeps it open while crossing into the card. */
	.ann-refs-pill::after {
		content: "";
		position: absolute;
		left: 0;
		right: 0;
		bottom: 100%;
		height: 0.5rem;
	}
	.ann-refs-pill:hover + .ann-refs-pop,
	.ann-refs-pill:focus-visible + .ann-refs-pop,
	.ann-refs-pop:hover {
		opacity: 1;
		pointer-events: auto;
	}
	.ann-refs-item {
		display: flex;
		gap: 0.45rem;
		padding: 0.2rem 0;
	}
	.ann-refs-item + .ann-refs-item {
		border-top: 1px solid rgba(255, 255, 255, 0.14);
	}
	.ann-refs-num {
		font-weight: 700;
		flex-shrink: 0;
	}
	.ann-refs-quote {
		overflow-wrap: anywhere;
	}
	.ann-refs-comment {
		color: #c7c7cc;
		overflow-wrap: anywhere;
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
	.toast {
		position: fixed;
		top: 0.5rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 100;
		background: #1c1c1e;
		color: #f2f2f7;
		font: inherit;
		font-size: 0.82rem;
		padding: 0.55rem 1rem;
		border: 0;
		border-radius: 999px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		cursor: pointer;
		white-space: nowrap;
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
	/* The pill fades in on mount and back out on close (the closing
	class waits out the ramp before the {#if} unmounts it). */
	@keyframes ann-pop-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
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
		animation: ann-pop-in 0.16s ease;
	}
	.ann-pop.closing {
		animation: none;
		opacity: 0;
		transition: opacity 0.16s ease;
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
	.ann-tool :global(.action-glyph) {
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
	/* Fresh pill keeps the mic mounted and cross-fades it, so the
	textarea never reflows when typing starts. Faded buttons are out of
	the pointer and tab order. */
	.ann-pop .ann-tool {
		transition: opacity 0.2s ease;
	}
	.ann-pop .gone {
		opacity: 0;
		pointer-events: none;
	}
	/* Fresh annotation: the compact pill (textarea + mic) rather than
	the edit card. Enter files it; clicking off cancels an empty draft. */
	.ann-pop.fresh {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 19rem;
		padding: 0.55rem 0.6rem 0.55rem 1rem;
		border-radius: 999px;
	}
	.ann-pop.fresh textarea {
		flex: 1;
		min-width: 0;
		min-height: 0;
		font-size: 1rem;
		padding: 0.15rem 0;
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
	buttons inside are bare segments. Later than the prompt tool buttons
	so the bare look wins (dark overrides below only recolor). */
	.ann-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
		border: 1px solid #c7c7cc;
		border-radius: 999px;
		background: none;
		padding: 0.2rem 0.35rem;
	}
	.ann-wrap > button {
		border: 0;
		background: none;
		padding: 0 0.3rem;
		font-size: 0.78rem;
		color: #6e6e73;
		cursor: pointer;
		/* Controls, not content: labels stay out of selections. */
		user-select: none;
		-webkit-user-select: none;
	}
	.ann-wrap > button:hover {
		color: #1c1c1e;
	}
	.ann-pill {
		font-weight: 650;
	}
	/* Clear-all lives at the top of the popup, right-aligned. */
	.review-tools {
		display: flex;
		justify-content: flex-end;
		padding: 0.1rem 0.2rem 0.35rem;
	}
	.review-tools button {
		border: 0;
		background: none;
		cursor: pointer;
		font-size: 0.75rem;
		color: #6e6e73;
		padding: 0.1rem 0.3rem;
	}
	.review-tools button:hover {
		color: #94250a;
	}
	/* Annotation popover: collapsed to the pill, expands on hover,
	focus, or pinned click. Beats the centered-column group rule.
	Flush against the pill (no gap): the pointer travels straight
	from badge to popup without crossing dead hover space. */
	.ann-wrap .review {
		display: none;
		position: absolute;
		bottom: 100%;
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
		transition: opacity 0.18s ease;
	}
	/* Hover-only actions, per side: the row fades in when the pointer is
	over the message or the row itself (or keyboard focus lands inside
	either). Opacity only — the buttons never move. Touch always shows
	it — there is no hover to wait for. */
	main.hover-user article.user .actions,
	main.hover-assistant article.assistant .actions {
		opacity: 0;
		/* Pre-create the compositor layer so the fade blends an
		already-rasterized row: without this the row is re-rasterized
		when the fade starts and the icons visibly shimmer mid-fade
		(worst at fractional offsets, e.g. with the settings panel
		narrowing the column). Applies shown or hidden — the layer
		must exist in both states or the switch still happens. */
		will-change: opacity;
	}
	main.hover-user article.user:hover .actions,
	main.hover-user article.user:focus-within .actions,
	main.hover-user article.user .actions:hover,
	main.hover-user article.user .actions:focus-within,
	main.hover-assistant article.assistant:hover .actions,
	main.hover-assistant article.assistant:focus-within .actions,
	main.hover-assistant article.assistant .actions:hover,
	main.hover-assistant article.assistant .actions:focus-within {
		opacity: 1;
	}
	/* Hovering the refs count never summons the row: the pill is the
	article's child, so without this the row would rise under it. */
	main.hover-user article.user:has(.ann-refs-pill:hover) .actions,
	main.hover-assistant article.assistant:has(.ann-refs-pill:hover) .actions {
		opacity: 0;
	}
	/* A message being read aloud keeps its row up while the audio runs:
	the green stop button must stay clickable after the pointer leaves. */
	main.hover-user article.user.speaking .actions,
	main.hover-assistant article.assistant.speaking .actions {
		opacity: 1;
	}
	@media (hover: none) {
		main.hover-user article.user .actions,
		main.hover-assistant article.assistant .actions {
			opacity: 1;
		}
	}
	/* Own messages pack to the right edge: block, text column, and row. */
	article.user .actions {
		justify-content: flex-end;
	}
	/* The always-mounted speaking slot reserves room on the far left of
	own rows, mirroring the far-right slot on assistant rows. */
	article.user .speaking-dot {
		order: -1;
	}
	/* Row tooltips hang below the buttons and render in one rise-and-settle
	(single-run keyframes on a static transform): unlike the native title
	bubble, nothing can fire a second nudge while the pointer stays put.
	Absolute, so they never push the row around. The 2s hold means
	brush-past hovers stay quiet; reduced-motion users get a plain fade. */
	@keyframes tip-rise {
		from {
			opacity: 0;
			translate: -50% 4px;
		}
		to {
			opacity: 1;
			translate: -50% 0;
		}
	}
	.actions button[data-tip] {
		position: relative;
	}
	.actions [data-tip]::after {
		content: attr(data-tip);
		position: absolute;
		top: calc(100% + 0.35rem);
		left: 50%;
		translate: -50% 0;
		z-index: 60;
		background: #1c1c1e;
		color: #f2f2f7;
		font-size: 0.75rem;
		line-height: 1.4;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		white-space: nowrap;
		opacity: 0;
		pointer-events: none;
	}
	.actions [data-tip]:hover::after,
	.actions [data-tip]:focus-visible::after {
		animation: tip-rise 0.15s ease-out 2s backwards;
		opacity: 1;
	}
	@media (prefers-reduced-motion: reduce) {
		.actions [data-tip]:hover::after,
		.actions [data-tip]:focus-visible::after {
			animation: none;
			transition: opacity 0.12s ease 2s;
		}
	}
	/* Text and icon buttons share one stable box: padding makes a real
	hit area, hover is a color shift only (no underline, no background),
	and no box property changes between states — hovering can't nudge
	the row. */
	.actions button {
		font-size: 0.75rem;
		line-height: 1.5;
		color: #6e6e73;
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0.15rem 0.5rem;
		flex-shrink: 0;
		white-space: nowrap;
	}
	.actions button:hover {
		color: #1c1c1e;
		text-decoration: none;
	}
	/* Loading buttons hold their look while the dots pulse. */
	.actions button:disabled {
		cursor: default;
		opacity: 0.8;
	}
	.actions .icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 0;
		padding: 0.2rem;
		color: #6e6e73;
		text-decoration: none;
	}
	.actions .icon-btn:hover {
		color: #1c1c1e;
		text-decoration: none;
	}
	/* The message being read aloud: its speak button reads as "stop". */
	.actions .icon-btn.active {
		color: #1f7a4d;
	}
	/* Fold chevron points right while collapsed. Glyph-only transform,
	so no box moves (the row-reveal stylesheet test forbids motion on
	that row's selectors — keep its selector text out of these rules). */
	button.icon-btn :global(svg) {
		transition: transform 0.18s ease;
	}
	button.icon-btn.folded :global(svg) {
		transform: rotate(-90deg);
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
	only the landing glide and the hover underline are gated there). */
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
		margin: 0.6rem 1.2rem 1.1rem;
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
	main.land .prompt {
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
		cursor: not-allowed;
	}
	.send-btn.wide {
		width: auto;
		height: auto;
		border-radius: 999px;
		font-size: 0.78rem;
		padding: 0.3rem 0.9rem;
	}
	/* Voice readback toggle: the same borderless icon treatment as the
	attach button. On state reads green like a playing message row. */
	/* Attach + Voice ride top-right of the prompt as one cluster, so the
	icon never drifts from the pill at any text size. */
	.prompt-tools {
		position: absolute;
		top: 0.45rem;
		right: 0.6rem;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.attach-btn,
	.voice-float,
	.mic-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 0;
		color: #6e6e73;
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0.2rem;
		transition: color 0.18s ease;
	}
	.attach-btn:hover,
	.voice-float:hover,
	.mic-btn:hover {
		color: #1c1c1e;
	}
	.voice-float.on {
		color: #1f7a4d;
	}
	/* Dictation in progress reads red, like the old pill's dot. */
	.mic-btn.recording {
		color: #c0362c;
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
	/* The mic icon widens the tools cluster: hold the first line clear
	of it, but only while it is actually mounted. */
	.prompt.has-mic :global(.cm-content) {
		padding-right: 6.5rem;
	}
	/* Annotation count badge joins the tools cluster: hold the first
	line clear of the wider row while any annotations exist. */
	.prompt.has-anns :global(.cm-content) {
		padding-right: 7rem;
	}
	.prompt.has-mic.has-anns :global(.cm-content) {
		padding-right: 8.9rem;
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
		/* Hint text, not content: never part of a selection. */
		user-select: none;
		-webkit-user-select: none;
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
	.app[data-focus-mode="scroll"] :global(.cm-cursorLayer) {
		/* Scroll mode shows no prompt cursor at all (see enterScrollMode). */
		display: none;
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
		/* !important throughout: the CodeMirror theme object injects its
		light rules after this stylesheet, so only importance wins. */
		:global(.cm-paste-marker) {
			background: #2c2c2e !important;
			border-color: #48484a !important;
			color: #f2f2f7 !important;
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
	.lang-menus,
	.attachments,
	.review,
	.translate-panel,
	.error-banner {
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

		aside .new {
			border-color: #48484a;
		}
		header {
			border-color: #38383a;
		}
		.settings-btn {
			color: #98989f;
		}
		.settings-btn:hover {
			color: #f2f2f7;
		}
		.voice-float {
			color: #98989f;
		}
		.voice-float:hover {
			color: #f2f2f7;
		}
		:global(::selection) {
			background: rgba(129, 140, 248, 0.4);
		}
		.voice-float.on {
			color: #7cc3a3;
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
		.wp-menu {
			background: #1c1c1e;
			border-color: #48484a;
		}
		.wp-menu button {
			color: #f2f2f7;
		}
		.wp-menu button:hover {
			background: #2c2c2e;
		}
		article.user .bubble {
			background: #2c2c2e;
		}
		main.plain-user article.user .bubble {
			background: none;
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
		/* Same specificity as the light-theme hover above, so dark wins. */
		.actions .icon-btn:hover {
			color: #f2f2f7;
		}
		/* The message being read aloud: green stop button, held on hover
		(the equal-specificity hover above would otherwise strip it). */
		.actions .icon-btn.active,
		.actions .icon-btn.active:hover {
			color: #7cc3a3;
		}
		.attach-btn:hover,
		.voice-float:hover,
		.mic-btn:hover {
			color: #f2f2f7;
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
		.ann-wrap {
			border-color: #48484a;
		}
		.ann-wrap > button {
			color: #98989f;
		}
		.ann-wrap > button:hover {
			color: #f2f2f7;
		}
		.review-tools button {
			color: #98989f;
		}
		.review-tools button:hover {
			color: #e89a90;
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
		.lang-list button:focus-visible,
		.lang-list button.selected {
			background: #2c2c2e;
		}
		.badge {
			color: #aeaeb2;
			border-color: #48484a;
		}

		.send-btn {
			background: #f2f2f7;
			border-color: #f2f2f7;
			color: #1c1c1e;
		}
	}
</style>
