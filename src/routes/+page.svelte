<script lang="ts">
	import { onMount, tick } from "svelte";
	import { SvelteMap, SvelteSet } from "svelte/reactivity";
	import { fade } from "svelte/transition";
	import {
		createChatState,
		formatTokens,
		activeChat,
		newChat,
		selectChat,
		setChatReplyLang,
		chatVoiceReadback,
		setChatVoice,
		deleteChat,
		deleteAllChats,
		deleteMessage,
		stageMessage,
		branchFrom,
		dismissFailedAssistant,
		truncateToMessage,
		editMessageContent,
		resendLast,
		tokenTotal,
		tokenSplit,
		waypoints,
		waypointLabel,
		sendMessage,
		setPasteFold,
		visibleMessageCount,
		isSending,
		type ChatMsg,
		type ChatId,
		type ChatMsgId
	} from "$lib/chat";
	import {
		loadSettings,
		saveSettings,
		effectiveSystemPrompt,
		activeThinkingSupport,
		activeThinkingId,
		resolveTheme,
		systemLocale,
		CHAT_WIDTH_DEFAULT,
		CHAT_WIDTH_MIN,
		CHAT_WIDTH_MAX,
		type AppSettings
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
	import { invoke } from "@tauri-apps/api/core";
	import { listen } from "@tauri-apps/api/event";
	import {
		createPromptEditor,
		PROMPT_PLACEHOLDER,
		SCROLL_PLACEHOLDER,
		ANDROID_PROMPT_PLACEHOLDER,
		ANDROID_SCROLL_PLACEHOLDER,
		sendPasteFolds,
		type PromptEditor,
		type PromptEditorOptions,
		type SubmitKind
	} from "$lib/editor";
	import { createTextareaEditor } from "$lib/textarea-editor";
	import {
		SCROLLKEY_LINE_PX,
		ggArmed,
		halfPageDy,
		holdIsTap,
		isEscapeHold,
		messageEdgeScrollTop,
		scrollHoldVelocity,
		stepScrollTop,
		unselectedScrollIntent
	} from "$lib/scrollkeys";
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
		imageMarkerInsert,
		countMarkerLines,
		removeMarkerLine,
		type Attachment
	} from "$lib/attachments";
		import {
		addAnnotation,
		duplicateAnnotationId,
		editAnnotationComment,
		deleteAnnotation,
		clearAnnotations,
		annotationNumber,
		annotationCountLabel,
		withAnnotations,
		quoteFragmentText,
		equationBodyOf,
		redactedCopyText,
		newAnnotationId,
		annRefsFor,
		lockSelectionToMessage,
		quoteTextNodes,
		occurrenceAtPosition,
		snapSelectionToWordEdges,
		placeAnnPopX,
		REFS_ONLY_BODY,
		lineStartOffset,
		clampDragAnchorToFocusLine,
		reviewEditKey,
		loadDraftAnnotations,
		saveDraftAnnotations,
		type Annotation,
		type AnnotationId,
		type AnnotationMark
	} from "$lib/annotations";
	import { createRefMemo } from "$lib/aidLoading";
	import { hoverTranslateWithProvider } from "$lib/builtinAi";
	import { switchChatWithTransition } from "$lib/viewTransitions";
	import { getInspectData, shouldShowInspect } from "$lib/inspect";
	import {
		clampSideviewWidth,
		hideSideview,
		layoutSideviewViews,
		navigateSideview,
		openSideview,
		resolveBrowserUrl,
		sideviewLayout
	} from "$lib/sideview";
	import {
	isAndroidUserAgent,
	isIOSUserAgent,
	isCoarsePointer,
	isTouchTablet,
	currentPlatform,
	modKeyLabel,
	altKeyLabel,
	edgeSwipeTarget,
	contentSwipeTarget,
	twoFingerSwipeDir,
	isThreeFingerTap,
	type EdgePanel,
	type FingerTrack
} from "$lib/platform";
	import {
		detectScript,
		detectScripts,
		localAidsFor,
		hasAmbiguousAidLine,
		preferredLocalAid,
		LOCAL_AID_BUTTON,
		LOCAL_AID_SHOW_ORIGINAL,
		LOCAL_AID_ADD_TITLE,
		MODEL_AIDS,
		MODEL_AID_FOR_SCRIPT,
		ttsLangFor,
		runModelAid,
		aidTargetLines,
		spliceAidResult,
		resolveAidKinds,
		type LocalAid
	} from "$lib/reading";
	import { isFuriganaCached } from "$lib/furigana";
	import { buildSearchDocs, chatMatchesQuery, type SearchHit } from "$lib/chatSearch";
	import { ChatSearchStore, createSearchWorker } from "$lib/chatSearchStore";
	import {
		clipboardReadAvailable,
		readClipboardImageFiles,
		type ClipboardItemLike
	} from "$lib/touchPaste";
	import {
		captureScreenToFile,
		consumeLaunchFiles,
		downloadMarkdownFile,
		dropFilesFromDataTransfer,
		exportChatMarkdown,
		fileSaveAccessAvailable,
		grabVideoFrame,
		isPermissionDismissal,
		screenshotCaptureAvailable,
		splitLaunchFiles,
		type LaunchQueueLike,
		type SaveHandleLike,
		type SavePickerOptions
	} from "$lib/intake";
	import { isKeyboardOpen, keyboardOverlapPx } from "$lib/viewportReflow";
import { isPromptIdle } from "$lib/chrome";
	import {
		speakText,
		speakMultilingual,
		speechText,
		replyLangFor,
		webVoiceAvailable,
		effectiveSpeechLang,
		stopSpeaking,
		micAvailable,
		dictateOnce,
		type SpeakCallbacks
	} from "$lib/voice";
	import {
		speakNative,
		speakNativeMulti,
		stopNative,
		friendlyNativeError,
		nativeTtsSupported,
		quoteLangFor,
		quoteLangForContext,
		currentKeyboardInputSource
	} from "$lib/nativeTts";
	import { startNativeDictation } from "$lib/nativeDictate";
	import {
		acquireStudyWakeLock,
		clearStudyBadge,
		ensureReplyNotificationPermission,
		notifyReplyDone,
		releaseStudyWakeLock,
		setStudyBadge,
		vibrateTick,
		type WakeLockRelease
	} from "$lib/studyMedia";
	import { recognizeImageText, friendlyOcrError } from "$lib/nativeOcr";
	import { voiceLocaleForInputSource } from "$lib/keyboardLang";
	import { joinExternalDraft } from "$lib/externalText";
	import {
		listenDeepLinks,
		isSummonHotkey,
		studySheetMarkdown,
		sheetTitle,
		shareStudySheet,
		printStudySheet,
		desktopSleepBlock,
		desktopSleepUnblock,
		exportStudySheet
	} from "$lib/desktop";

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
			// The top-of-effect snapshot (a synchronous settings read, so
			// the effect subscribes) freezes the debounced save.
			saveSettingsNow(snapshot);
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
	/** App root (pinned to the visual height while the phone keyboard is up). */
	let appEl: HTMLElement | undefined = $state();
	/** Scrollbar thumb shows while a scroll is in flight, then fades. */
	let scrollIdleTimer: number | undefined;
	function noteScrolling(): void {
		selMenu = null;
		if (scrollBox) stick = nearBottom(scrollBox);
		scrollBox?.classList.add("scrolling");
		window.clearTimeout(scrollIdleTimer);
		scrollIdleTimer = window.setTimeout(() => {
			scrollBox?.classList.remove("scrolling");
			updateWpPos();
		}, 200);
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
	/**
	 * Draft annotations for the active chat, restored from storage on
	 * launch: unsent quotes survive a restart (sending still bakes and
	 * clears, switching chats still starts clean — the save below
	 * records the empty list either way).
	 */
	let annotations = $state<Annotation[]>(loadDraftAnnotations(chatState.activeChatId));
	$effect(() => {
		saveDraftAnnotations(
			chatState.activeChatId,
			annotations,
			chatState.chats.map((c) => c.id)
		);
	});
	/**
	 * Search index stays fresh: any chat/message/draft change re-indexes
	 * (debounced) into the Worker + IndexedDB snapshot. The synchronous
	 * reads subscribe the effect; the schedule call is the debounced
	 * side effect.
	 */
	$effect(() => {
		const fingerprint = chatState.chats
			.map((c) => `${c.id}:${c.messages.length}:${c.messages.map((m) => m.content.length).join(",")}`)
			.join("|");
		const draftCount = annotations.length;
		void fingerprint;
		void draftCount;
		scheduleSearchIndex();
	});
	/**
	 * Annotation being composed (comment pill open, not yet submitted):
	 * held out of `annotations` so no badge stamps and no count moves
	 * until submit. The id is minted up front so the wash and the pill
	 * already address the annotation it will become.
	 */
	let pendingAnn = $state<Annotation | null>(null);
	let reviewOpen = $state(false);
	/** Focus refs: the review overlay opens through CSS :focus-within on
	touch, so focus must always land on a live node inside .ann-wrap —
	never on an unmounting button (focus drops to <body> and the whole
	overlay closes). */
	let annPill: HTMLButtonElement | null = $state(null);
	let editBox: HTMLTextAreaElement | null = $state(null);
	function focusPill(): void {
		annPill?.focus({ preventScroll: true });
	}
	/** Waypoint menu pinned open (hover/focus reveal it without pinning). */
	let wpOpen = $state(false);
	let wpWrap: HTMLElement | undefined = $state();
	/** 1-based position of the nearest waypoint at/above the viewport top
	(feeds the touch pill and the sheet's current-item highlight). */
	let wpPos = $state(1);
	/** Touch Y at swipe start for the sheet's pull-down-to-dismiss. */
	let wpTouchY: number | null = null;
	function updateWpPos(): void {
		const box = scrollBox;
		if (!box || points.length === 0) {
			wpPos = 1;
			return;
		}
		const top = box.scrollTop;
		let n = 0;
		for (let k = 0; k < points.length; k++) {
			const el = box.querySelector<HTMLElement>(`#msg-${points[k]}`);
			if (el && el.offsetTop - top <= 120) n = k + 1;
			else break;
		}
		wpPos = Math.max(1, n);
	}
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
	// The pill's position tracks the chat itself (new messages, chat
	// switches), not just scrolls: the synchronous reads subscribe the
	// effect, and the DOM re-read settles after paint, when article
	// boxes are final.
	$effect(() => {
		const total = points.length + viewChat.messages.length;
		requestAnimationFrame(() => {
			if (total === 0) wpPos = 1;
			else updateWpPos();
		});
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
	/** Sidebar chat-list filter text (mobile swipe opens the list on it). */
	let sideSearch = $state("");
	/** Sidebar search input (tapping it focuses with the keyboard up). */
	let sideSearchEl: HTMLInputElement | undefined = $state();
	/** Last lone "g" timestamp (gg hops to the top of history). */
	let lastGAt = 0;
	/** Held scroll key (j/k/d/u glide): pacing state, null when idle. */
	let scrollHold: { key: string; velocity: number; downAt: number; lastT: number; raf: number } | null = null;
	/**
	 * Escape keydown timestamp for the fullscreen hold: releasing
	 * after ESCAPE_HOLD_MS exits fullscreen, a quicker tap keeps the
	 * keydown dismiss path exactly as today. 0 when no press is held.
	 */
	let escDownAt = 0;
	/**
	 * Command palette (Ctrl+P / Cmd+P): full-text search across chats
	 * and annotations. Null when closed.
	 */
	let searchOpen = $state(false);
	let searchQuery = $state("");
	let searchHits = $state<SearchHit[]>([]);
	let searchBusy = $state(false);
	let searchCursor = $state(0);
	let searchInputEl: HTMLInputElement | undefined = $state();
	/** Search documents snapshot (Worker + IndexedDB, in-memory fallback). */
	let searchStore: ChatSearchStore | null = null;
	let searchIndexTimer: ReturnType<typeof setTimeout> | null = null;
	let searchQueryTimer: ReturnType<typeof setTimeout> | null = null;
	/** Touch paste-images in flight (Async Clipboard read). */
	let pasting = $state(false);
	let editingId: AnnotationId | null = $state(null);
	let editDraft = $state("");
	/** Own message loaded into the composer for editing (null when the
	composer is a fresh send). Enter rewrites it in place; Esc cancels. */
	let editingMsgId: ChatMsgId | null = $state(null);
	let highlightAnnId: AnnotationId | null = $state(null);
	/** Badge currently hovered (paints its quote wash as a preview). */
	let hoverBadgeId: string | null = $state(null);
	/** Cursor-anchored annotation pill (ChatGPT-style). Null when closed. */
	let annPop = $state<{ id: string; x: number; y: number; fresh: boolean } | null>(null);
	/** Last badge a mousedown press opened (or toggled): its trailing
	click re-fire is the same gesture, never a new one. Plain field —
	only the handlers below touch it, never the template. */
	let lastBadgePress: { id: AnnotationId; at: number } | null = null;
	/** Pill fade-out in flight (unmounts when the ramp ends). */
	let annPopClosing = $state(false);
	let annPopTimer: ReturnType<typeof setTimeout> | null = null;
	let annDraft = $state("");
	let annPopBox: HTMLTextAreaElement | undefined = $state();
	/** The Enter that saves an annotation must never double as a send. */
	let sendGuardUntil = 0;
	let selMenu = $state<{
		x: number;
		y: number;
		/** Highlight rect (viewport px): centers the create box when narrow. */
		left: number;
		w: number;
		quote: string;
		messageId: ChatMsgId;
	} | null>(null);
	/**
	 * An unanswered selection menu never lingers (clicking away still
	 * dismisses instantly). Touch holds it 1.8x longer: a thumb takes
	 * longer to reach than a cursor.
	 */
	let selMenuTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		if (!selMenu) return;
		if (selMenuTimer) clearTimeout(selMenuTimer);
		// Phones: the dock tracks the native bubble — while a highlight
		// is live the bubble is up, so hold the dock past the timer
		// (like a held press holds the action row). Collapsing the
		// selection still clears it at once via selectionchange below.
		const arm = (): void => {
			selMenuTimer = setTimeout(
				() => {
					selMenuTimer = null;
					if (androidUI && (window.getSelection()?.toString() ?? "") !== "") {
						arm();
						return;
					}
					selMenu = null;
				},
				androidUI ? 4500 : 2500
			);
		};
		arm();
		return () => {
			if (selMenuTimer) {
				clearTimeout(selMenuTimer);
				selMenuTimer = null;
			}
		};
	});
	/**
	 * Last press that began inside the selection menu: whatever
	 * selection churn follows belongs to the menu (button taps collapse
	 * the highlight on release), so the selectionchange auto-dismiss
	 * below stands down for it. Annotate runs off the stored quote.
	 */
	let menuPressAt = 0;
	function noteMenuPress(): void {
		menuPressAt = Date.now();
	}
	let menuBtnTouchStart: { x: number; y: number } | null = null;
	function noteMenuBtnTouch(event: TouchEvent): void {
		const t = event.changedTouches[0];
		menuBtnTouchStart = t ? { x: t.clientX, y: t.clientY } : null;
		menuPressAt = Date.now();
	}
	/**
	 * Touch activation for menu buttons: a tap that starts near a
	 * selection handle is swallowed as a handle nudge (the handle
	 * blinks, no click ever arrives), so waiting for onclick strands
	 * the button. Run off touchend instead; preventDefault eats the
	 * compat mouse sequence. Mouse and keyboard keep onclick.
	 */
	function menuBtnTouch(event: TouchEvent, run: () => void): void {
		const t = event.changedTouches[0];
		const start = menuBtnTouchStart;
		menuBtnTouchStart = null;
		menuPressAt = Date.now();
		if (!t || !start) return;
		if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 14) return;
		event.preventDefault();
		run();
	}
	function annotateTouch(event: TouchEvent): void {
		menuBtnTouch(event, annotate);
	}
	function inspectTouch(event: TouchEvent): void {
		menuBtnTouch(event, openInspect);
	}
	let translate = $state<{
		quote: string;
		messageId: ChatMsgId;
		result: string | null;
		error: string | null;
		busy: boolean;
		/** "builtin" = free on-device Translator served, no key spent. */
		via: "builtin" | "fallback" | null;
	} | null>(null);
	let vocalized = $state<Record<string, string>>({});
	let vocalizing = new SvelteSet<string>();
	/** Aid runs clicked mid-flight that must pin on completion. */
	let pendingPin = new SvelteSet<string>();
	/** Messages whose aid is pinned on (model-aid text or local ruby). */
	let aidPin = new SvelteSet<string>();
	/**
	 * Local aids pinned per message (model pins set no kinds). Each kind
	 * renders only its own lines, so furigana and pinyin pin
	 * independently and both stay up together on mixed messages. Model
	 * aids (tashkeel) compose with them instead of replacing them.
	 */
	let aidKindPin = new SvelteMap<string, LocalAid[]>();
	/** Messages with the model aid (tashkeel) pinned: its vocalized
	text shows while pinned local kinds render onto it. */
	let aidModelPin = new SvelteSet<string>();
	/** Pinned local kinds for a message (never a live reference). */
	function pinnedKinds(id: string): LocalAid[] {
		return aidKindPin.get(id) ?? [];
	}
	/** Messages whose local aid (furigana dictionary) is loading right now. */
	let aidBusy = new SvelteSet<string>();
	/** Message currently hover-previewing its aid (null when none). */
	let aidPeek = $state<{ id: string; kind?: LocalAid } | null>(null);
	/**
	 * Peek lock: clicking swaps the button under a stationary cursor, and the
	 * browser re-fires mouseenter for the swap — without this, unpinning
	 * would instantly re-preview. Cleared by a genuine mouse leave, so the
	 * next enter is a real hover and may peek a loaded aid.
	 */
	let aidNoPeek = new SvelteSet<string>();
	/**
	 * Local aids clicked at least once, per message and kind. The first
	 * hover of an aid button is color-only; only after that kind was
	 * clicked (pinned) may its hovers preview the readings — pinning
	 * furigana must never unlock pinyin's hover.
	 */
	let aidSeen = new SvelteSet<string>();
	/** Preview-unlock key for one message's local-aid kind. */
	function aidSeenKey(id: string, kind: LocalAid): string {
		return `${id}:${kind}`;
	}
	let vocalizeError: string | null = $state(null);
	let speakingId: string | null = $state(null);
	/** Message a speak-aloud selection came from (tints its selection). */
	let speakingSelection: string | null = $state(null);
	/** Screen wake lock held while read-aloud/TTS plays (study sessions). */
	let studyWakeLock: WakeLockRelease | null = null;
	/** Release the read-aloud wake lock (stop, natural end, teardown). */
	function releaseStudyWake(): void {
		releaseStudyWakeLock(studyWakeLock);
		studyWakeLock = null;
	}
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
		let restored = false;
		const restore = (): void => {
			if (restored) return;
			restored = true;
			root.style.pointerEvents = "";
		};
		// rAF owns the restore (one painted frame); the timeout is a
		// backstop for surfaces that never produce one (headless test
		// shells), where a stuck none would eat every later click.
		requestAnimationFrame(() => restore());
		setTimeout(restore, 100);
	}
	let shortcutsOpen = $state(false);
	/**
	 * Inspect overlay: the single Han character under review, or null
	 * when closed. Same modal-veil/modal pattern as the shortcuts
	 * overlay. Set from openInspect (selection menu), cleared by Esc,
	 * backdrop click, or the × button.
	 */
	let inspectChar = $state<string | null>(null);
	/** Current step of the schematic stroke preview (1-based). */
	let inspectStroke = $state(1);
	const inspectData = $derived(inspectChar ? getInspectData(inspectChar) : null);
	$effect(() => {
		// Schematic stroke-step preview: advances through the stroke
		// count on a timer until the KanjiVG path-data follow-up lands.
		// Reduced-motion users get a static first step instead.
		const total = inspectData?.strokeCount;
		if (!inspectChar || !total) return;
		inspectStroke = 1;
		let reduced = false;
		try {
			reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		} catch {
			reduced = false;
		}
		if (reduced) return;
		const timer = setInterval(() => {
			inspectStroke = inspectStroke >= total ? 1 : inspectStroke + 1;
		}, 600);
		return () => clearInterval(timer);
	});
	/** Open the Inspect overlay for the live selection (single Han char only). */
	function openInspect(): void {
		if (!selMenu) return;
		const quote = selMenu.quote.trim();
		if (!shouldShowInspect(quote, settings.inspectEnabled)) return;
		inspectChar = quote;
		clearSelection();
		selMenu = null;
	}
	/**
	 * Android (phone) UI: the shortcuts modal shows touch gestures
	 * instead of key chords, and edge swipes open the sidebars. Set
	 * once on mount from the user agent — never reactive, never
	 * persisted.
	 */
	let androidUI = $state(false);
	/**
	 * iOS subset of the phone UI: Apple gives apps no way to add items
	 * to the system selection menu (Android's floating toolbar API has
	 * no iOS equivalent), so our Annotate button floats above the
	 * highlight while Apple's own bubble keeps its below slot.
	 */
	let iosUI = $state(false);

	/**
	 * Touch copy drops key-chord parentheticals: no Option key, no
	 * hover, no right-click on a phone (it backs out of the app).
	 */
	function tip(desktop: string, mobile: string): string {
		return androidUI ? mobile : desktop;
	}
	/**
	 * Modifier labels for the shortcuts modal and tooltips: macOS shows
	 * the ⌘/⌥/⇧ glyphs, Windows/Linux show Ctrl/Alt/Shift. The key
	 * handlers accept both metaKey and ctrlKey (altKey either way), so
	 * whichever label shows names a combo the handler takes. Mac-first
	 * default: set properly on mount from navigator (see below).
	 */
	let isMac = $state(true);
	const mod = $derived(modKeyLabel(isMac));
	const altm = $derived(altKeyLabel(isMac));
	/** Composer hints: touch wording on phones, shortcut wording elsewhere. */
	function promptPlaceholder(): string {
		return androidUI ? ANDROID_PROMPT_PLACEHOLDER : PROMPT_PLACEHOLDER;
	}
	function scrollPlaceholder(): string {
		return androidUI ? ANDROID_SCROLL_PLACEHOLDER : SCROLL_PLACEHOLDER;
	}
	let hasText = $state(false);
	let altHeld = $state(false);
	// Quiet to send: while a reply streams, the lib drops every send
	// and stage — but only after doSend/stage already emptied the
	// composer. Gating here keeps the button dead AND the draft intact,
	// so Enter during Thinking is a no-op instead of a lost message.
	// Per-chat lock: a reply streaming in another chat never deadens
	// this composer's send — only this chat's own stream gates it.
	const canSubmit = $derived(
		!isSending(chatState) && (hasText || attachments.length > 0 || annotations.length > 0)
	);

	function toggleSidebar(): void {
		settings.sidebarCollapsed = !settings.sidebarCollapsed;
		persistSettings();
		// Touch draws one sidebar at a time: an opening chats list
		// dismisses the settings panel (and vice versa below).
		if (!settings.sidebarCollapsed && androidUI && settingsOpen) settingsOpen = false;
	}

	/**
	 * Sidebar chat list filtered by the sidebar search box. Matches the
	 * chat label plus every message body (substring per token), so a
	 * swipe-opened list narrows as you type.
	 */
	function sideVisibleChats(): (typeof chatState.chats)[number][] {
		const query = sideSearch.trim();
		if (!query) return chatState.chats;
		return chatState.chats.filter((item) =>
			chatMatchesQuery(
				chatLabel(item.createdAt, visibleMessageCount(chatState, item)),
				item.messages.map((m) => m.content),
				query
			)
		);
	}

	/** Focus the sidebar search box (tap path: keyboard comes up). */
	function focusSideSearch(): void {
		sideSearchEl?.focus();
	}

	/**
	 * Full-text search palette (Ctrl+P / Cmd+P): ranks chats, messages,
	 * and annotation drafts through the index Worker (IndexedDB
	 * snapshot, in-memory fallback where either is unavailable).
	 */
	function ensureSearchStore(): ChatSearchStore {
		if (!searchStore) {
			let factory: (() => Worker) | undefined;
			try {
				factory = createSearchWorker;
				// Probe first: constructing here throws in runtimes
				// without Workers, and the store falls back silently.
				const probe = factory();
				probe.terminate();
			} catch {
				factory = undefined;
			}
			searchStore = new ChatSearchStore(factory);
			void searchStore.restore();
		}
		return searchStore;
	}

	function currentSearchDocs(): Parameters<typeof buildSearchDocs>[0] {
		return chatState.chats.map((c) => ({
			id: c.id,
			createdAt: c.createdAt,
			messages: c.messages.map((m) => ({ id: m.id, content: m.content }))
		}));
	}

	function scheduleSearchIndex(): void {
		if (searchIndexTimer) clearTimeout(searchIndexTimer);
		searchIndexTimer = setTimeout(() => {
			searchIndexTimer = null;
			try {
				const seen: string[] = [];
				const anns: Parameters<typeof buildSearchDocs>[1] = [];
				for (const chat of chatState.chats) {
					let drafts: Annotation[] = [];
					try {
						drafts =
							chat.id === chatState.activeChatId
								? annotations
								: loadDraftAnnotations(chat.id);
					} catch {
						drafts = [];
					}
					for (const ann of drafts) {
						const key = `${chat.id}:${ann.id}`;
						if (seen.includes(key)) continue;
						seen.push(key);
						anns.push({
							chatId: chat.id,
							messageId: ann.messageId,
							quote: ann.quote,
							comment: ann.comment
						});
					}
				}
				void ensureSearchStore()
				.index(buildSearchDocs(currentSearchDocs(), anns))
				.then(() => {
					// The palette may have queried before this snapshot
					// landed (fast typists beat the 500ms debounce): an
					// open query re-runs against the fresh snapshot.
					if (searchOpen && searchQuery.trim()) runSearchQuery();
				});
			} catch {
				// Search never breaks the chat: stale snapshot stays live.
			}
		}, 500);
	}

	function openSearch(): void {
		searchOpen = true;
		searchCursor = 0;
		scheduleSearchIndex();
		requestAnimationFrame(() => searchInputEl?.focus());
	}

	function closeSearch(): void {
		searchOpen = false;
		searchQuery = "";
		searchHits = [];
		searchBusy = false;
		if (searchQueryTimer) {
			clearTimeout(searchQueryTimer);
			searchQueryTimer = null;
		}
		editor?.focus();
	}

	/**
	 * Browser side panel (Cmd+T): a second OS webview docked right
	 * in the same Tauri window — exactly one tab, a plain browser
	 * with an address bar, no Translate framing. Shrinking the main
	 * webview changes what window.innerWidth reports, so the full
	 * window width is tracked across resizes instead of re-read
	 * (see below).
	 */
	let sideviewOpen = $state(false);
	/** Address-bar text; the single tab's URL derives from it (empty = home). */
	let browserAddress = $state("");
	let browserInputEl: HTMLInputElement | null = $state(null);
	/** Why the DOM fallback strip is showing (shell refusal); null when clean. */
	let sideviewError: string | null = $state(null);
	/** True while the native tab is docked (shell granted the webview). */
	let sideviewHosted = $state(false);
	/** DOM fallback strip when no shell webview is available. */
	let sideviewFallback = $state(false);
	let sideviewFullW: number | null = null;
	let sideviewFullH: number | null = null;
	let sideviewSideW = 0;
	let sideviewOverlaid = false;
	const sideviewUrl = $derived(resolveBrowserUrl(browserAddress));
	/** Edge-drag resize in flight (fallback strip handle). */
	let sideviewDrag: { startX: number; startW: number } | null = $state(null);

	/** Full window viewport, reconstructing the docked-off width. */
	function sideviewViewport(): { width: number; height: number } {
		const height = sideviewFullH ?? window.innerHeight;
		if (!sideviewHosted || sideviewFullW === null) {
			return { width: window.innerWidth, height };
		}
		if (sideviewOverlaid) return { width: window.innerWidth, height: window.innerHeight };
		return { width: window.innerWidth + sideviewSideW, height: window.innerHeight };
	}

	function noteSideviewLayout(layout: ReturnType<typeof sideviewLayout>): void {
		sideviewSideW = layout.side.width;
		sideviewOverlaid = layout.overlay;
	}

	/** Focus the address bar: Cmd+T lands typing there, out of the prompt. */
	function focusBrowserAddress(): void {
		browserInputEl?.focus();
		browserInputEl?.select();
	}

	async function setSideviewOpen(open: boolean, focusAddress = false): Promise<void> {
		try {
			if (open) {
				sideviewOpen = true;
				sideviewError = null;
				const viewport = sideviewViewport();
				sideviewFullW = viewport.width;
				sideviewFullH = viewport.height;
				const layout = sideviewLayout(
					viewport.width,
					viewport.height,
					settings.sideviewWidthPx
				);
				const hosted = await openSideview(sideviewUrl, layout);
				if (hosted) noteSideviewLayout(layout);
				sideviewHosted = hosted;
				sideviewFallback = !hosted;
				if (!hosted && tauriBackendAvailable()) {
					// A shell exists but refused the webview: say so
					// instead of failing silent. Plain browsers get
					// the strip's static note, not an error.
					sideviewError =
						"The desktop shell would not dock the browser tab, so this is a link strip instead.";
				}
				if (focusAddress) focusBrowserAddress();
			} else {
				sideviewOpen = false;
				sideviewFallback = false;
				if (sideviewHosted) {
					sideviewHosted = false;
					await hideSideview(
						sideviewFullW ?? window.innerWidth,
						sideviewFullH ?? window.innerHeight
					);
				}
				sideviewFullW = null;
				sideviewFullH = null;
			}
		} catch {
			// The panel never breaks the chat: fall back to the DOM
			// strip on open, and drop state on close.
			if (open) {
				sideviewHosted = false;
				sideviewFallback = true;
			} else {
				sideviewHosted = false;
				sideviewFallback = false;
				sideviewFullW = null;
				sideviewFullH = null;
			}
		}
	}

	/**
	 * Address-bar go: resolve the input and move the single tab to
	 * it. The fallback strip just repoints its link (same derived
	 * URL); a shell refusal flips to the strip with the reason shown.
	 */
	async function submitBrowserAddress(): Promise<void> {
		if (!sideviewOpen) return;
		sideviewError = null;
		if (!sideviewHosted) return;
		try {
			const viewport = sideviewViewport();
			sideviewFullW = viewport.width;
			sideviewFullH = viewport.height;
			const layout = sideviewLayout(
				viewport.width,
				viewport.height,
				settings.sideviewWidthPx
			);
			// The JS Webview API exposes no navigate: recreate the
			// single tab at the resolved URL.
			const hosted = await navigateSideview(sideviewUrl, layout);
			if (hosted) {
				noteSideviewLayout(layout);
			} else {
				sideviewHosted = false;
				sideviewFallback = true;
				sideviewError =
					"The desktop shell would not move the browser tab, so this is a link strip instead.";
			}
		} catch {
			sideviewHosted = false;
			sideviewFallback = true;
			sideviewError =
				"The desktop shell would not move the browser tab, so this is a link strip instead.";
		}
	}

	/**
	 * Memorize the edge-dragged panel width. Live-drags update the
	 * setting; the save lands on release (see the handle's
	 * pointerup) so a drag writes once.
	 */
	function dragSideviewTo(clientX: number): void {
		if (!sideviewDrag) return;
		settings.sideviewWidthPx = clampSideviewWidth(
			sideviewDrag.startW + (sideviewDrag.startX - clientX)
		);
	}

	$effect(() => {
		// Window resizes re-dock both webviews while the native tab
		// is up. Browser fallback needs no geometry (plain DOM flow).
		if (!sideviewOpen || !sideviewHosted) return;
		const onResize = () => {
			const viewport = sideviewViewport();
			sideviewFullW = viewport.width;
			sideviewFullH = viewport.height;
			const layout = sideviewLayout(
				viewport.width,
				viewport.height,
				settings.sideviewWidthPx
			);
			noteSideviewLayout(layout);
			void layoutSideviewViews(layout);
		};
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	});

	function runSearchQuery(): void {
		if (searchQueryTimer) clearTimeout(searchQueryTimer);
		const query = searchQuery;
		if (!query.trim()) {
			searchHits = [];
			searchBusy = false;
			return;
		}
		searchBusy = true;
		searchQueryTimer = setTimeout(() => {
			searchQueryTimer = null;
			void ensureSearchStore()
				.query(query, 30)
				.then((hits) => {
					searchHits = hits;
					searchCursor = 0;
					searchBusy = false;
				})
				.catch(() => {
					searchHits = [];
					searchBusy = false;
				});
		}, 120);
	}

	/** Chat switching wrapped in a View Transition where supported
	 * (instant cut elsewhere) — identical end state either way. */
	function transitionToChat(id: Parameters<typeof selectChat>[1]): void {
		const from = chatState.activeChatId;
		void switchChatWithTransition(() => {
			// Draft annotations belong to one chat: file the leaving
			// chat's away, then restore the entering chat's. Doing both
			// inside the transition keeps the autosave effect (which
			// also keys on activeChatId) from ever filing one chat's
			// drafts under another's id.
			saveDraftAnnotations(from, annotations, chatState.chats.map((c) => c.id));
			selectChat(chatState, id);
			annotations = loadDraftAnnotations(id);
		});
	}

	/** Jump to a palette hit: its chat, scrolled to its message. */
	function enterSearchHit(hit: SearchHit): void {
		const chat = chatState.chats.find((c) => c.id === hit.doc.chatId);
		if (!chat) return;
		previewChatId = null;
		transitionToChat(chat.id);
		searchOpen = false;
		searchQuery = "";
		searchHits = [];
		if (hit.doc.msgId) {
			const index = chat.messages.findIndex((m) => m.id === hit.doc.msgId);
			if (index >= 0) {
				requestAnimationFrame(() => {
					document
						.getElementById(`msg-${index}`)
						?.scrollIntoView({ block: "center", behavior: "smooth" });
				});
			}
		}
		editor?.focus();
	}

	function moveSearchCursor(delta: 1 | -1): void {
		if (searchHits.length === 0) return;
		searchCursor =
			((searchCursor + delta) % searchHits.length + searchHits.length) % searchHits.length;
	}

	/**
	 * Touch paste-images button: reads images off the Async Clipboard
	 * into the existing attachments path (`addFiles`). Text-only or
	 * denied clipboards toast instead of failing silently.
	 */
	async function pasteImagesFromClipboard(): Promise<void> {
		if (pasting) return;
		pasting = true;
		try {
			const files = await readClipboardImageFiles(() =>
				(navigator.clipboard as unknown as { read: () => Promise<ClipboardItemLike[]> }).read()
			);
			await addFiles(files);
		} catch (error) {
			attachError = error instanceof Error ? error.message : String(error);
		} finally {
			pasting = false;
		}
	}

	/**
	 * Screenshot-to-chat: one getDisplayMedia frame straight into the
	 * existing attachments path (same marker line as pasted images, so
	 * send strips it and the image travels as an attachment). The
	 * button only renders where getDisplayMedia exists; a dismissed
	 * picker stays silent, real failures land in attachError.
	 */
	let screenshotting = $state(false);

	async function captureScreenshot(): Promise<void> {
		if (screenshotting) return;
		screenshotting = true;
		try {
			const file = await captureScreenToFile(
				(options) => navigator.mediaDevices.getDisplayMedia(options),
				grabVideoFrame
			);
			await addFiles([file]);
			editor?.insertText(imageMarkerInsert(editor.getText()));
		} catch (error) {
			if (!isPermissionDismissal(error)) {
				attachError = error instanceof Error ? error.message : String(error);
			}
		} finally {
			screenshotting = false;
		}
	}

	/**
	 * Export the active chat as Markdown: File System Access picker
	 * where available, download blob fallback otherwise. A dismissed
	 * picker stays silent.
	 */
	async function exportCurrentChat(): Promise<void> {
		try {
			const picker = fileSaveAccessAvailable()
				? ((window as unknown as {
						showSaveFilePicker?: (options: SavePickerOptions) => Promise<SaveHandleLike>;
					}).showSaveFilePicker?.bind(window) ?? null)
				: null;
			const how = await exportChatMarkdown(chat, {
				picker,
				download: downloadMarkdownFile
			});
			flashToast(how === "picker" ? "Chat saved" : "Chat downloaded");
		} catch (error) {
			if (!isPermissionDismissal(error)) flashToast("Couldn't export this chat.");
		}
	}



	/** Open the settings panel, dismissing the chats list on touch. */
	function openSettingsPanel(): void {
		settingsOpen = true;
		if (androidUI && !settings.sidebarCollapsed) {
			settings.sidebarCollapsed = true;
			persistSettings();
		}
	}

	/** Toggle the settings panel with the same one-sidebar rule. */
	function toggleSettingsPanel(): void {
		if (settingsOpen) settingsOpen = false;
		else openSettingsPanel();
	}

	/**
	 * Whether the user picked their own idle timeout: captured once at
	 * startup, before the autosave effect can backfill defaults into
	 * storage (any settings change persists the whole object, so a
	 * later read cannot tell default from deliberate). Phones default
	 * to never hiding until the user chooses a timeout.
	 * (Mirrors the private storage key in settings.ts.)
	 */
	const idleTimeoutCustomized: boolean = (() => {
		try {
			const raw = window.localStorage.getItem("ccez-studio-settings-v1");
			if (!raw) return false;
			return typeof (JSON.parse(raw) as { promptIdleSec?: unknown }).promptIdleSec === "number";
		} catch {
			return false;
		}
	})();
	/**
	 * Idle-hide for the main prompt: any mouse, keyboard, touch, or
	 * wheel input stamps lastInputAt and shows the composer instantly;
	 * a 500ms ticker hides it (slides down out of view) once the
	 * effective timeout elapses with no input. The timeout and mobile
	 * reads subscribe the effect, so a settings change or the phone
	 * detection landing re-arms the ticker. An empty chat never hides:
	 * with no text to uncover, the prompt and its attachment strip
	 * stay put. (Skipping short-but-nonempty threads too is the chrome
	 * pile's idle-hide checkbox, with its own contract test.)
	 */
	let lastInputAt = $state(Date.now());
	let promptIdle = $state(false);
	function noteInput(): void {
		lastInputAt = Date.now();
		promptIdle = false;
	}
	$effect(() => {
		const setting = settings.promptIdleSec ?? 6;
		const idleSec = !androidUI ? setting : idleTimeoutCustomized ? setting : 0;
		const on = (): void => noteInput();
		window.addEventListener("pointermove", on, { passive: true });
		window.addEventListener("pointerdown", on, { passive: true });
		window.addEventListener("keydown", on);
		window.addEventListener("wheel", on, { passive: true });
		window.addEventListener("touchstart", on, { passive: true });
		const timer = window.setInterval(() => {
			if (!isPromptIdle(lastInputAt, Date.now(), idleSec)) return;
			if (viewChat.messages.length === 0) return;
			promptIdle = true;
		}, 500);
		return () => {
			window.removeEventListener("pointermove", on);
			window.removeEventListener("pointerdown", on);
			window.removeEventListener("keydown", on);
			window.removeEventListener("wheel", on);
			window.removeEventListener("touchstart", on);
			window.clearInterval(timer);
		};
	});
	/**
	 * Sleep prevention during speech/streaming (desktop shell only):
	 * one backend claim stays live while a voice reads
	 * (`speakingId`) or a reply streams (`chatState.sending`). The
	 * bridge refcounts, so overlap never unblocks early; a stale
	 * resolve after stop releases instead of holding. Outside the
	 * shell the call resolves null — never a toast, never a throw.
	 */
	let sleepClaim: number | null = null;
	let sleepWanted = false;
	$effect(() => {
		const active = speakingId !== null || chatState.sending;
		if (active) {
			sleepWanted = true;
			void desktopSleepBlock("Ccez Studio speech or reply streaming").then((id) => {
				if (id === null) return;
				if (sleepWanted) sleepClaim = id;
				else void desktopSleepUnblock(id);
			});
		} else {
			sleepWanted = false;
			if (sleepClaim !== null) {
				const id = sleepClaim;
				sleepClaim = null;
				void desktopSleepUnblock(id);
			}
		}
	});
	/** UI text scale in 10% steps (50–600% desktop, 50–400% phones). */
	function adjustFontScale(delta: number): void {
		const cap = androidUI ? 4 : 6;
		const next = Math.min(cap, Math.max(0.5, Math.round((settings.fontScale + delta) * 10) / 10));
		if (next === settings.fontScale) return;
		settings.fontScale = next;
		persistSettings();
		flashToast(`Text size ${Math.round(next * 100)}%`);
	}
	/** Chat-column width in 2rem steps (desktop only — phones fix it
	at 46rem). Shift siblings of the text-size chords, above. */
	function adjustChatWidth(delta: number): void {
		if (androidUI) return;
		const current = settings.chatWidth ?? CHAT_WIDTH_DEFAULT;
		const next = Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, current + delta));
		if (next === current) {
			flashToast(`Chat width ${current} rem (limit)`);
			return;
		}
		settings.chatWidth = next;
		persistSettings();
		flashToast(`Chat width ${next} rem`);
	}

	/** Pointer-down spot for click-off-to-close (select-drags must not count). */
	let mainDown: { x: number; y: number } | null = null;
	function noteMainDown(event: PointerEvent): void {
		mainDown = { x: event.screenX, y: event.screenY };
	}
	/**
	 * Clicking into the main chat closes the sidebars: the settings
	 * panel and the chats list both collapse, so the click lands on a
	 * full-width conversation. Controls tagged data-settings-toggle
	 * manage the panel themselves and are skipped; drags (text
	 * selection) are not plain clicks.
	 */
	function closeSettingsFromMain(event: MouseEvent): void {
		if (!settingsOpen && settings.sidebarCollapsed) return;
		const down = mainDown;
		mainDown = null;
		if (down && Math.hypot(event.screenX - down.x, event.screenY - down.y) > 5) return;
		if (settingsOpen) {
			if (event.target instanceof Element && event.target.closest("[data-settings-toggle]")) {
				return;
			}
			settingsOpen = false;
		}
		if (!settings.sidebarCollapsed) {
			settings.sidebarCollapsed = true;
			persistSettings();
		}
	}

	/**
	 * Resolved color scheme on <html>: "system" mirrors the OS live
	 * (the listener re-runs the effect's cleanup on mode change, so
	 * only system subscribes), pins hold regardless. The dark CSS
	 * gates on this attribute — never on media queries — so one rule
	 * set serves all three modes.
	 */
	$effect(() => {
		const mode = settings.theme;
		const query = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = (): void => {
			document.documentElement.dataset.theme = resolveTheme(mode, query.matches);
		};
		apply();
		if (mode === "system") query.addEventListener("change", apply);
		return () => query.removeEventListener("change", apply);
	});

	/**
	 * Hide-messages mode (touch): every body stays hidden until its
	 * message is tapped — the open one shows text and buttons, then
	 * closes itself after 3s. Tapping controls never toggles.
	 */
	let shownActionsId: ChatMsgId | null = $state(null);
	/** The floating row flips above its message when the last rows have
	no room below (scroll containers clip the overlay otherwise). */
	let actionsAbove = $state(false);
	let shownActionsTimer: ReturnType<typeof setTimeout> | null = null;
	/** (Re)arm the 3s auto-dismiss for one reveal. */
	function armActionsTimer(id: ChatMsgId): void {
		if (shownActionsTimer) clearTimeout(shownActionsTimer);
		shownActionsTimer = setTimeout(() => {
			if (shownActionsId !== id) {
				shownActionsTimer = null;
				return;
			}
			// A loading aid (tashkeel run, furigana conversion) or
			// running audio owns the row like a held press: closing
			// now would strand the spinner with no buttons, or the
			// stop button out of reach mid-utterance. Re-arm and let
			// a later tick close it after the work lands.
			if (aidBusy.has(id) || vocalizing.has(id) || speakingId === id || speakingSelection === id) {
				armActionsTimer(id);
				return;
			}
			shownActionsId = null;
			shownActionsTimer = null;
		}, 3000);
	}
	/** A press inside an open row owns it: tap-and-hold must not watch
	its button vanish on the usual timer. Release re-arms it. */
	function holdActionsOpen(): void {
		if (shownActionsTimer) clearTimeout(shownActionsTimer);
		shownActionsTimer = null;
	}
	function releaseActionsHold(): void {
		if (shownActionsId === null) return;
		armActionsTimer(shownActionsId);
	}
	function toggleMessageActions(id: ChatMsgId, event: MouseEvent): void {
		if (!settings.hideMessages && !(androidUI && settings.hideButtons)) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest("button, a, input, textarea, select, summary")) return;
		if (shownActionsTimer) clearTimeout(shownActionsTimer);
		shownActionsTimer = null;
		if (shownActionsId === id) {
			shownActionsId = null;
			actionsAbove = false;
			return;
		}
		shownActionsId = id;
		const el = event.currentTarget;
		const boxRect = scrollBox?.getBoundingClientRect();
		actionsAbove =
			el instanceof HTMLElement &&
			boxRect !== undefined &&
			el.getBoundingClientRect().bottom + 64 > boxRect.bottom;
		// The tap can land mid-frame with keyboard or viewport churn:
		// settle a re-measure after paint (same settle the send paths
		// use) so the composer can't strand at zero height, and the
		// extra paint invalidates a stale tile the fade left behind
		// on phone GPUs.
		requestAnimationFrame(() => requestAnimationFrame(() => editor?.remeasure()));
		armActionsTimer(id);
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
	function stepChat(direction: 1 | -1, focus = true): void {
		previewChatId = null;
		const chats = chatState.chats;
		if (chats.length === 0) return;
		const at = Math.max(
			chats.findIndex((c) => c.id === chatState.activeChatId),
			0
		);
		const next = at + direction;
		if (next < 0) return;
		// Touch steps never take focus: landing in the prompt would pop
		// the keyboard on every swipe. Keyboard steps keep the old path.
		if (next >= chats.length) {
			if (chats[at]?.messages.length === 0) {
				if (focus) enterEditMode();
				return;
			}
			// File the leaving chat's drafts away first: resetDraftExtras
			// empties `annotations`, and the autosave effect would then
			// persist the empty list under the old id (draft restore
			// on return would come back blank).
			saveDraftAnnotations(chatState.activeChatId, annotations, chats.map((c) => c.id));
			resetDraftExtras();
			newChat(chatState);
			scrollBox?.scrollTo({ top: 0, behavior: "smooth" });
			if (focus) enterEditMode();
			restartStepSlide(direction);
			return;
		}
		const target = chats[next];
		if (!target) return;
		sideIdx = next;
		transitionToChat(target.id);
		// Every switch lands at the top the same way minting one does —
		// stepping older used to jump with no motion at all.
		scrollBox?.scrollTo({ top: 0, behavior: "smooth" });
		if (focus) enterEditMode();
		restartStepSlide(direction);
	}

	/**
	 * Chat-step slide (touch swipes): the incoming chat glides in from
	 * the swipe side instead of jumping. Null-then-frame restarts the
	 * keyframes even for same-direction repeats; the animationend
	 * handler clears the class. Phone-only via the classes below —
	 * desktop steps instant.
	 */
	let chatStepDir: 1 | -1 | null = $state(null);
	function restartStepSlide(direction: 1 | -1): void {
		chatStepDir = null;
		requestAnimationFrame(() => {
			chatStepDir = direction;
		});
	}

	/** Enter the cursor chat from the keyboard, close the list, and land in its prompt. */
	function enterSideChat(): void {
		const chats = chatState.chats;
		if (chats.length === 0) return;
		const item = chats[Math.min(Math.max(sideIdx, 0), chats.length - 1)];
		if (!item) return;
		sideIdx = chats.indexOf(item);
		transitionToChat(item.id);
		settings.sidebarCollapsed = true;
		persistSettings();
		enterEditMode();
	}

	/**
	 * Delete key on a focused sidebar chat: drop it and land on the chat
	 * below (deleteChat slides there, or mints a blank when the list
	 * empties). The list re-renders async, so clamp the cursor now and
	 * focus the laid-out row on the next frame.
	 */
	function deleteSideChat(): void {
		const chats = chatState.chats;
		if (chats.length === 0) return;
		const at = Math.min(Math.max(sideIdx, 0), chats.length - 1);
		const item = chats[at];
		if (!item) return;
		dropChat(item.id);
		sideIdx = Math.min(Math.max(at, 0), chatState.chats.length - 1);
		requestAnimationFrame(() => focusSideChat(sideIdx));
	}

	/** Unsent composer extras quote one chat's messages — never carry over. */
	function resetDraftExtras(): void {
		annotations = [];
		reviewOpen = false;
		editingId = null;
		editDraft = "";
		editingMsgId = null;
		editor?.setPlaceholder(promptPlaceholder());
		highlightAnnId = null;
		settleAnnPop();
		annPop = null;
		annDraft = "";
		attachments = [];
		// Pills are gone: their tags go too, or a stale marker would
		// reconcile away the next chat's first image.
		markerSyncMuted = true;
		try {
			if (editor && countMarkerLines(editor.getText()) > 0) {
				editor.setText(stripImageMarkers(editor.getText()));
			}
			prevMarkerCount = 0;
		} finally {
			markerSyncMuted = false;
		}
		selMenu = null;
		translate = null;
	}

	function doNewChat(): void {
		previewChatId = null;
		stopVoice();
		// File the leaving chat's drafts away before resetDraftExtras
		// empties them — otherwise the autosave effect files the empty
		// list under the old chat's id and return-restore comes back
		// blank (same ordering as transitionToChat's save-before-load).
		saveDraftAnnotations(
			chatState.activeChatId,
			annotations,
			chatState.chats.map((c) => c.id)
		);
		resetDraftExtras();
		newChat(chatState);
		scrollBox?.scrollTo({ top: 0, behavior: "smooth" });
		// Phones stay out of the prompt: auto-focus pops the keyboard
		// over the composer instead of pushing it up. Tap in when ready.
		if (!androidUI) editor?.focus();
	}

	const useMock = mockProviderEnabled();
	const chat = $derived(activeChat(chatState));
	/**
	 * Hover preview: the sidebar row under the cursor shows its chat in
	 * the main column until the hover leaves. The composer, annotations,
	 * and active chat never switch — the preview is read-only (its
	 * action row and selection menu stay off) so every hovered index
	 * still addresses the real chat.
	 */
	let previewChatId: ChatId | null = $state(null);
	const previewChat = $derived(
		previewChatId && previewChatId !== chatState.activeChatId
			? (chatState.chats.find((c) => c.id === previewChatId) ?? null)
			: null
	);
	const viewChat = $derived(previewChat ?? chat);
	const previewing = $derived(previewChat !== null);
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
			if (!editor) return;
			markerSyncMuted = true;
			try {
				editor.insertText(imageMarkerInsert(editor.getText()));
				prevMarkerCount = countMarkerLines(editor.getText());
			} finally {
				markerSyncMuted = false;
			}
		});
	}

	/**
	 * Image pill <-> `[Pasted image]` tag two-way removal. Pill → tag:
	 * dropping the pill removes one marker line from the draft. Tag →
	 * pill lives in `promptOptions().onDocChange`: when the marker count
	 * falls, the newest image attachments go with it. `markerSyncMuted`
	 * bridges the two (programmatic edits must not reconcile against
	 * themselves); `prevMarkerCount` is the last reconciled count.
	 */
	let markerSyncMuted = false;
	let prevMarkerCount = 0;

	/**
	 * Attachment-card copy (icon-only, reusing the message-button copy
	 * glyph): text attachments copy their inlined text; images copy the
	 * image bytes (ClipboardItem) so a paste lands the picture, not a
	 * data URL. Toasts read "Copied" like every other copy path.
	 */
	function copyAttachment(att: Attachment): void {
		if (att.kind === "text" && att.text !== null) {
			copyPlain(att.text, "Copied");
			return;
		}
		if (att.kind === "image" && att.dataUrl) {
			const failed = "Couldn't copy to the clipboard.";
			if (!navigator.clipboard?.write) {
				flashToast(failed);
				return;
			}
			void (async () => {
				try {
					const blob = await (await fetch(att.dataUrl as string)).blob();
					await navigator.clipboard.write([
						new ClipboardItem({ [blob.type || "image/jpeg"]: blob })
					]);
					flashToast("Copied");
				} catch {
					flashToast(failed);
				}
			})();
			return;
		}
		flashToast("Nothing to copy yet.");
	}

	function removeAttachment(id: string): void {
		const removed = attachments.find((a) => a.id === id);
		attachments = attachments.filter((a) => a.id !== id);
		if (previewId === id) previewId = null;
		if (removed?.kind === "image" && editor) {
			markerSyncMuted = true;
			try {
				editor.setText(removeMarkerLine(editor.getText()));
				prevMarkerCount = countMarkerLines(editor.getText());
			} finally {
				markerSyncMuted = false;
			}
		}
	}

	/**
	 * On-device OCR for one attached image (macOS Vision bridge): the
	 * recognized text is inserted into the composer as selectable text,
	 * so it flows into the existing pinyin/furigana pipeline when sent.
	 * Outside the Mac shell the bridge rejects and the friendly error
	 * lands in `attachError` — never a throw into UI teardown.
	 */
	let ocrBusyId: string | null = $state(null);

	async function recognizeAttachment(att: Attachment): Promise<void> {
		if (ocrBusyId !== null || att.kind !== "image" || !att.dataUrl) return;
		ocrBusyId = att.id;
		attachError = null;
		try {
			// No language hint: the backend's learner default covers
			// English + CJK scripts. Passing the Latin TTS fallback
			// here restricted Vision to English, so Chinese paragraphs
			// missed entirely and surfaced as red errors.
			const result = await recognizeImageText(att.dataUrl, null);
			const text = result.text.trim();
			if (!text) {
				attachError = "No text found in this image.";
			} else {
				editor?.insertText(`${text}\n`);
				flashToast("Recognized text inserted");
			}
		} catch (error) {
			attachError = friendlyOcrError(error instanceof Error ? error.message : String(error));
		} finally {
			ocrBusyId = null;
		}
	}

	function toggleFold(id: ChatMsgId): void {
		if (foldedIds.has(id)) foldedIds.delete(id);
		else foldedIds.add(id);
	}

	function copyPlain(text: string, note: string): void {
		const failed = "Couldn't copy to the clipboard.";
		if (!navigator.clipboard) {
			flashToast(failed);
			return;
		}
		void navigator.clipboard.writeText(text).then(
			() => flashToast(note),
			() => flashToast(failed)
		);
	}

	function copyText(content: string, role: string): void {
		// Message copy excludes baked annotations (metadata, not prose);
		// refs-only messages fall back to their quotes, never "".
		copyPlain(redactedCopyText(plainBody(content, role, sourcesWanted)), "Copied");
	}

	/** Copy one annotation (either overlay): quote plus comment, no numbers. */
	function copyAnnotation(quote: string, comment: string): void {
		const text = comment.trim() ? `"${quote}" — ${comment.trim()}` : `"${quote}"`;
		copyPlain(text, "Copied");
	}

	/**
	 * Cut the hovered message: the clipboard write must land first —
	 * deleting up front would strand the text when copying fails.
	 */
	function cutHoverMessage(index: number): void {
		const target = chat.messages[index];
		if (!target) return;
		const text = plainBody(target.content, target.role, sourcesWanted);
		const done = navigator.clipboard?.writeText(text);
		if (done === undefined) {
			flashToast("Couldn't copy to the clipboard.");
			return;
		}
		void done.then(
			() => {
				deleteMessage(chatState, index);
				flashToast("Cut to clipboard");
			},
			() => flashToast("Couldn't copy to the clipboard.")
		);
	}

	/** Clicking the toast copies its text. Success stays silent by
	design: flashing a confirmation would overwrite the very text being
	copied. Failure still says so (guarded against clobbering a newer
	toast that landed meanwhile). */
	function copyToast(): void {
		if (!toast) return;
		const text = toast;
		if (!navigator.clipboard) {
			flashToast("Couldn't copy to the clipboard.");
			return;
		}
		void navigator.clipboard.writeText(text).catch(() => {
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
		// Math picks normalize to the whole equation: a partial glyph
		// pick quotes a shard that never re-matches, so when both ends
		// sit in one equation the range expands over its body first.
		const anchorBody = equationBodyOf(selection.anchorNode);
		if (anchorBody && equationBodyOf(selection.focusNode) === anchorBody) {
			try {
				const whole = document.createRange();
				whole.selectNodeContents(anchorBody);
				selection.removeAllRanges();
				selection.addRange(whole);
			} catch {
				// A disturbed range keeps the partial pick below.
			}
		}
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

	function onSelectEnd(event: MouseEvent, cursorX?: number): void {
		if (event.altKey) return; // Option-click folds; never a menu.
		// Selections never span messages: a drag crossing into another
		// article trims back to the anchor message's edge first.
		const live = window.getSelection();
		if (live) lockSelectionToMessage(live, articleOf);
		// The create marker never splits a word in half: boundaries cut
		// mid-word snap out to the word's edges before the menu reads
		// the quote (CJK has no word characters, so it never snaps).
		if (live) snapSelectionToWordEdges(live);
		placeSelMenu(cursorX);
	}

	function placeSelMenu(cursorX?: number): void {
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
		const width = 320;
		// The menu docks near the cursor that finished the gesture, not
		// the selection's start — a full-sentence pick shouldn't strand
		// it lines above where the pointer is.
		const at = cursorX ?? rect.left;
		// The popup sits down and left of the cursor that finished the
		// gesture (never under it), still clamped to the viewport.
		const x = Math.min(Math.max(8, at - 16), window.innerWidth - width - 8);
		// Android: the OS text toolbar (Copy / Translate / Read Aloud)
		// docks above the selection, so ours goes below it instead of
		// underneath it — except near the screen bottom, where above
		// wins and may share space with the OS bar. iOS docks its
		// bubble below the selection, so ours takes the above slot
		// like desktop — one popup on each side, never stacked.
		let y: number;
		if (androidUI && !iosUI) {
			// Well clear of the selection handles (~24px below text).
			y = rect.bottom + 30;
			if (y + 44 > window.innerHeight) y = Math.max(8, rect.top - 47);
		} else if (iosUI) {
			// Above slot (Apple's bubble owns below); only a cramped
			// top edge drops it below, still clear of the handles and
			// the native bubble, and clamped on screen.
			y = rect.top - 47;
			if (y < 8) y = rect.bottom + 30;
			if (y + 44 > window.innerHeight) y = Math.max(8, window.innerHeight - 52);
		} else {
			y = rect.top - 41;
			if (y < 8) y = rect.bottom + 14;
		}
		selMenu = { x, y, left: rect.left, w: rect.width, quote: found.quote, messageId: found.messageId };
	}

	function clearSelection(): void {
		window.getSelection()?.removeAllRanges();
	}

	/**
	 * Which repeat of a quote the live selection starts in: resolves the
	 * range start against the message's rendered text nodes and counts
	 * the stripped occurrence holding it. Never throws — selection APIs
	 * disagree across engines, and anything odd keeps 0 (first match).
	 */
	function occurrenceFromSelection(messageId: ChatMsgId, quote: string): number {
		try {
			const selection = window.getSelection();
			if (!selection || selection.rangeCount === 0) return 0;
			const range = selection.getRangeAt(0);
			let node: Node | null = range.startContainer;
			let offset = range.startOffset;
			// Whole-node starts (triple-click paragraphs) resolve to
			// their first text: the occurrence holding the span's start.
			if (!(node instanceof Text)) {
				const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
				const firstText = walker.nextNode();
				if (!(firstText instanceof Text)) return 0;
				node = firstText;
				offset = 0;
			}
			const index = chat.messages.findIndex((m) => m.id === messageId);
			if (index === -1) return 0;
			const root = document.querySelector(`article#msg-${index} .rendered`);
			if (!(root instanceof HTMLElement)) return 0;
			const nodes = quoteTextNodes(root);
			const nodeIndex = node instanceof Text ? nodes.indexOf(node) : -1;
			if (nodeIndex === -1) return 0;
			return occurrenceAtPosition(
				nodes.map((n) => n.textContent ?? ""),
				quote,
				nodeIndex,
				offset
			);
		} catch {
			return 0;
		}
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
		const quote = selMenu.quote.trim();
		// Repeats disambiguate here, from the live selection: the
		// last "c" in "ccc" records occurrence 2, so its badge
		// lands where the highlight was. Anything unresolvable
		// keeps 0 (first match, the old behavior).
		const at = occurrenceFromSelection(selMenu.messageId, quote);
		// Same span twice would stack two badges on one anchor (and
		// hovering them oscillates): open the review on the existing
		// one instead of filing a twin.
		const dupe = duplicateAnnotationId(annotations, selMenu.messageId, quote, at);
		if (dupe) {
			clearSelection();
			selMenu = null;
			highlightAnnId = dupe;
			reviewOpen = true;
			flashToast("Already annotated");
			return;
		}
		const pending: Annotation = {
			id: newAnnotationId(),
			messageId: selMenu.messageId,
			quote,
			comment: "",
			at
		};
		pendingAnn = pending;
		clearSelection();
		const width = popWidth();
		// The comment box sits a breath below the Annotate menu's
		// anchor: sharing selMenu.y leaves it floating high above tall
		// CJK lines. Narrow highlights center the box over themselves;
		// wide ones keep the end-of-selection placement. The Annotate
		// button itself never moves (stays at the cursor end).
		// Phone: the keyboard eats the lower screen, so the composer
		// pins high and centered instead of at the selection — it is
		// never covered, wherever the quote sits.
		const x = androidUI
			? Math.max(8, (window.innerWidth - width) / 2)
			: placeAnnPopX({
					cursorX: selMenu.x,
					highlightLeft: selMenu.left,
					highlightWidth: selMenu.w,
					popWidth: width,
					viewportWidth: window.innerWidth
				});
		let y = Math.min(Math.max(8, selMenu.y + 2), window.innerHeight - 72);
		if (androidUI) {
			y = Math.max(8, window.innerHeight * 0.12);
		}
		selMenu = null;
		highlightAnnId = pending.id;
		annDraft = "";
		settleAnnPop();
		annPop = { id: pending.id, x, y, fresh: true };
		vibrateTick(6);
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
		// field-sizing: content sizes the pill in CSS (capped at 168px
		// there); only measure by hand where it is unsupported.
		const cssOwnsHeight =
			typeof CSS !== "undefined" && CSS.supports("field-sizing: content");
		const fit = () => {
			if (cssOwnsHeight) return;
			node.style.height = "auto";
			node.style.height = `${Math.min(node.scrollHeight, 168)}px`;
		};
		node.addEventListener("input", fit);
		fit();
		// A grown box drops its corner radius (see .ann-pop.tall): the
		// full pill radius reads over-rounded once the field is tall.
		// Measured on the field itself: the card chrome differs
		// between the fresh pill and the edit card, but both fields
		// grow 1 line toward the same 168px cap, so one threshold
		// splits short from tall for both. clientHeight counts
		// CSS-owned growth too, not just the hand-measured fallback.
		const card = node.closest(".ann-pop");
		const TALL_PX = 100;
		const mark = () => {
			const h = node.clientHeight ?? 0;
			card?.classList.toggle("tall", h > TALL_PX);
		};
		mark();
		const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(mark);
		if (card && ro) ro.observe(node);
		return {
			destroy: () => {
				node.removeEventListener("input", fit);
				ro?.disconnect();
			}
		};
	}

	/** Annotation popover width: the desktop card, clamped to fit narrow
	phones — without the clamp x goes negative and it runs off-screen. */
	function popWidth(): number {
		return Math.min(384, window.innerWidth - 16);
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
		// Narrow phones are narrower than the desktop card: clamp first
		// or x goes negative and the popover runs off-screen.
		const width = popWidth();
		let x = Math.min(Math.max(8, anchor.x - width / 2), window.innerWidth - width - 8);
		const height = 240;
		let y = anchor.y + 8;
		if (y + height > window.innerHeight - 8) y = Math.max(8, anchor.y - height - 8);
		if (androidUI) {
			// Same keyboard rule as the create composer: high and
			// centered, never under the keyboard.
			x = Math.max(8, (window.innerWidth - width) / 2);
			y = Math.max(8, window.innerHeight * 0.12);
		}
		annPop = { id, x, y, fresh: false };
	}

	/**
	 * Delegated badge click (MessageBody): the keyboard path, plus the
	 * trailing click of a press gesture. A press's own click re-fire —
	 * same badge within the tap window — is the gesture just handled,
	 * not a re-press: running the toggle would shut the menu the press
	 * opened (the iOS tap bug). Anything else toggles as before.
	 */
	function openBadgeClick(id: AnnotationId, anchor: { x: number; y: number }): void {
		if (lastBadgePress && lastBadgePress.id === id && Date.now() - lastBadgePress.at < 800) return;
		openBadge(id, anchor);
	}

	function saveEdit(id: string): void {
		annotations = editAnnotationComment(annotations, id, editDraft);
		editingId = null;
		highlightAnnId = null;
		// The Save button unmounts with the edit box: park focus on the
		// pill or the overlay drops on touch (see focus refs above).
		focusPill();
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
			busy: !!provider,
			via: null
		};
		clearSelection();
		selMenu = null;
		if (!provider) return;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 30000);
		try {
			// Lookup targets English; anything else goes in the chat itself.
			// Free on-device Translator serves where present; the keyed
			// helper is the fallback (see builtinAi.hoverTranslate).
			const hovered = await hoverTranslateWithProvider(
				provider,
				found.quote,
				"English",
				controller.signal
			);
			if (translate && translate.quote === found.quote) {
				translate = { ...translate, result: hovered.text, via: hovered.via, busy: false };
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
		const dupe = duplicateAnnotationId(annotations, translate.messageId, translate.quote, 0);
		if (dupe) {
			highlightAnnId = dupe;
			translate = null;
			reviewOpen = true;
			editingId = null;
			flashToast("Already annotated");
			return;
		}
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
		(m) => `${m.id}:${m.number}:${m.quote}:${m.at ?? 0}:${m.preview === true ? "preview" : "saved"}`
	);
	function marksFor(messageId: ChatMsgId): AnnotationMark[] {
		const saved: AnnotationMark[] = annotations
			.filter((a) => a.messageId === messageId)
			.map((a) => ({ id: a.id, number: annotationNumber(annotations, a.id), quote: a.quote, at: a.at ?? 0 }));
		// A composed-but-unsubmitted annotation washes while its pill is
		// open, but stamps no badge (badges appear on submit only).
		if (pendingAnn && pendingAnn.messageId === messageId) {
			saved.push({
				id: pendingAnn.id,
				number: annotations.length + 1,
				quote: pendingAnn.quote,
				at: pendingAnn.at ?? 0,
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
		// Model and local aids compose: vocalized text shows whenever
		// the model pin is on, with pinned local kinds rendered onto it
		// (each on its own lines). The cache survives unpin for one
		// click back.
		if (aidModelPin.has(msg.id)) return vocalized[msg.id] ?? null;
		return null;
	}

	/** Text the reading aids see: baked annotation blocks are metadata,
	not prose — detecting or converting them would reserve ruby's room
	for hidden text and grow annotated history. */
	function aidDisplayText(msg: ChatMsg): string {
		return annRefsFor(msg.content)?.text ?? msg.content;
	}

	/**
	 * Local-aid overrides: pinned kinds render (each on its own lines),
	 * plus a hover-peeked kind previewed alongside them; empty renders
	 * the original (aids are per-message only). Kinds the message no
	 * longer offers (edited text) filter out instead of lingering.
	 */
	/**
	 * Local aids a message offers: every script's own aid, plus the
	 * chat reply pill's aid when the text holds kanji-only lines no
	 * script test can own (preferred first — it names the chat's
	 * language). Without a pill, or without ambiguous lines, this is
	 * exactly the script-only list as before.
	 */
	function offeredLocalAids(text: string): LocalAid[] {
		const kinds = localAidsFor(detectScripts(text));
		const preferred = preferredLocalAid(activeReplyCode);
		if (preferred && hasAmbiguousAidLine(text) && !kinds.includes(preferred)) kinds.unshift(preferred);
		return kinds;
	}

	/**
	 * Aid-kind arrays by message, memoized like the badge arrays: the
	 * body effect subscribes to the array identity, so a fresh array
	 * per parent render (any hover near an aid button) rebuilt every
	 * body and re-stamped its badges — flickering text with several
	 * marks mounted. Same content returns the same reference.
	 */
	const memoAids = createRefMemo<LocalAid>((kind) => kind);
	function localAidsOverrideFor(msg: ChatMsg): LocalAid[] {
		const kinds = offeredLocalAids(aidDisplayText(msg));
		const peek = aidPeek?.id === msg.id ? (aidPeek.kind ?? null) : null;
		return memoAids(msg.id, resolveAidKinds(kinds, pinnedKinds(msg.id), peek));
	}

	/**
	 * Hover in: preview the aid, but only when it is already here (cached
	 * model aid, cached furigana, kind clicked before). Fetching happens
	 * on click alone — hovering must never spend a model call or start
	 * furigana's dictionary load (that work now runs in a worker, but the
	 * rule stands: hover previews, click fetches). The swap lock wins over
	 * everything: right after a click the button under a stationary cursor
	 * is new, not hovered.
	 */
	function peekAid(msg: ChatMsg, aidId: string | null, kind?: LocalAid): void {
		if (aidNoPeek.has(msg.id)) return;
		if (aidId) {
			if (vocalized[msg.id] === undefined) return;
		} else {
			// First hover is color-only: previews start after that kind's
			// first click (pin), never a sibling kind's.
			if (kind === undefined || !aidSeen.has(aidSeenKey(msg.id, kind))) return;
			if (kind === "furigana" && !isFuriganaCached(aidDisplayText(msg))) {
				return;
			}
		}
		// Same preview already showing: re-assigning a fresh object
		// re-renders every body for nothing (hovering near the button
		// re-fires enter without leaving).
		const nextKind = kind ?? null;
		if (aidPeek?.id === msg.id && (aidPeek.kind ?? null) === nextKind) return;
		aidPeek = kind === undefined ? { id: msg.id } : { id: msg.id, kind };
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

	/** Click on a local-aid button: pin its kind (others stay as pinned). */
	function pinLocalAid(msg: ChatMsg, kind: LocalAid): void {
		const kinds = pinnedKinds(msg.id);
		if (!kinds.includes(kind)) aidKindPin.set(msg.id, [...kinds, kind]);
		aidPin.add(msg.id);
		// A model run still in flight must not steal the pin back when
		// it lands: the local click is the latest intent.
		pendingPin.delete(msg.id);
		if (aidPeek?.id === msg.id) aidPeek = null;
		aidNoPeek.add(msg.id);
		aidSeen.add(aidSeenKey(msg.id, kind));
	}

	/** Per-kind "show original": unpin one kind, keep the other pinned
	(and a pinned model aid showing). */
	function unpinLocalAid(msg: ChatMsg, kind: LocalAid): void {
		const kinds = pinnedKinds(msg.id).filter((pinned) => pinned !== kind);
		if (kinds.length === 0) {
			aidKindPin.delete(msg.id);
			if (!aidModelPin.has(msg.id)) aidPin.delete(msg.id);
		} else aidKindPin.set(msg.id, kinds);
		if (aidPeek?.id === msg.id) aidPeek = null;
		aidNoPeek.add(msg.id);
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

	/** Model "show original": drop the vocalized text, keep any pinned
	local kinds up on their own lines. */
	function unpinModelAid(msg: ChatMsg): void {
		aidModelPin.delete(msg.id);
		if (pinnedKinds(msg.id).length === 0) aidPin.delete(msg.id);
		if (aidPeek?.id === msg.id) aidPeek = null;
		aidNoPeek.add(msg.id);
	}

	/**
	 * Aid load failed (furigana worker or dictionary): only the furigana
	 * conversion reports failure (pinyin renders synchronously), so drop
	 * just that kind — a pinned pinyin stays up. The last kind out
	 * releases the pin, falling back to the aid name instead of a "show
	 * original" with nothing applied. Only an explicit pin earns a toast.
	 */
	function aidFailed(id: ChatMsgId, reason?: string): void {
		const kinds = pinnedKinds(id);
		const had = kinds.includes("furigana");
		const kept = kinds.filter((kind) => kind !== "furigana");
		if (kept.length === 0) {
			aidKindPin.delete(id);
			if (!aidModelPin.has(id)) aidPin.delete(id);
		} else aidKindPin.set(id, kept);
		if (aidPeek?.id === id) aidPeek = null;
		// The reason ships in the toast: a bare failure gives nothing to
		// report back when it only reproduces on a phone.
		if (had)
			flashToast(
				reason
					? `Couldn't load the readings for this message (${reason}).`
					: "Couldn't load the readings for this message."
			);
	}

	async function runModelAidFor(msg: ChatMsg, aidId: string, pin: boolean): Promise<void> {
		if (vocalized[msg.id] !== undefined) {
			if (pin) {
				aidPin.add(msg.id);
				// Compose, never replace: pinned local kinds stay up
				// on their own lines.
				aidModelPin.add(msg.id);
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
			// Multilingual messages vocalize Arabic lines only: the rest
			// never crosses to the model (faster, cheaper), and the
			// result splices back so other scripts stay byte-identical.
			// A shape mismatch falls back to the whole-text replace.
			const full = aidDisplayText(msg);
			const targets = aidTargetLines(full);
			const lines = full.split("\n");
			const partial = targets.length > 0 && targets.length < lines.length;
			const input = partial ? targets.map((i) => lines[i] ?? "").join("\n") : full;
			const text = await runModelAid(provider, aidId, input);
			const spliced = partial ? spliceAidResult(full, targets, text) : null;
			vocalized = { ...vocalized, [msg.id]: spliced ?? text };
			const wantPin = pin || pendingPin.has(msg.id);
			pendingPin.delete(msg.id);
			// Compose, never replace: a local pin placed mid-flight (or
			// before) keeps its kinds; the run still caches either way.
			if (wantPin) {
				aidPin.add(msg.id);
				aidModelPin.add(msg.id);
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
		releaseStudyWake();
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

	/** The error banner clears itself like the toast: a failed read
	shouldn't lecture from the bottom of the screen forever. */
	let voiceErrorTimer: ReturnType<typeof setTimeout> | null = null;
	function setVoiceError(message: string | null): void {
		if (voiceErrorTimer) clearTimeout(voiceErrorTimer);
		voiceErrorTimer = null;
		voiceError = message;
		if (message) {
			voiceErrorTimer = setTimeout(() => {
				if (voiceError === message) voiceError = null;
				voiceErrorTimer = null;
			}, 8000);
		}
	}

	/**
	 * Bumped when the voice inventory arrives: getVoices() returns []
	 * until the engine loads (notably slow in phone WebViews), and every
	 * speak gate reads through webVoices, so the bump re-renders them
	 * from disabled to live.
	 */
	let webVoiceVersion = $state(0);
	/** Installed web voices (best-effort: [] reads as "unknown"). */
	function webVoices(): Array<{ lang: string }> {
		// Reactive subscription to the inventory bump (never negative).
		if (webVoiceVersion < 0) return [];
		try {
			if (typeof speechSynthesis === "undefined") return [];
			return speechSynthesis.getVoices();
		} catch {
			return [];
		}
	}

	/**
	 * Sync speech locale for a message: the same sentence routing
	 * speakReply uses, minus the async recognizer (Latin-script text
	 * lands on the voice-language fallback either way on devices
	 * without the bridge), resolved through the stand-in map (Latin
	 * reads Italian, Sanskrit Hindi). Feeds the no-voice gate below.
	 */
	function messageSpeechLang(msg: ChatMsg): string {
		return effectiveSpeechLang(replyLangFor(speechText(msg.content), latinFallback()), webVoices());
	}

	/**
	 * Whether attempting speech makes sense: the web engine with no
	 * installed voice for the locale (Latin with no Latin voice, …)
	 * would only raise the error banner, so callers disable or skip
	 * instead. Native availability is bridge-side and stays on the
	 * error path; an unloaded inventory never disables.
	 */
	function speechAttemptable(lang: string): boolean {
		if (settings.voiceEngine !== "web") return true;
		return webVoiceAvailable(lang, webVoices());
	}

	/** Speak-button state per message (a playing message always offers Stop). */
	function messageSpeakable(msg: ChatMsg): boolean {
		return speechAttemptable(messageSpeechLang(msg));
	}

	function startSpeech(id: string, text: string, lang: string | ((sentence: string) => string), quiet = false): void {
		stopSpeaking();
		stopNative();
		setVoiceError(null);
		speakingId = id;
		// Study sessions: keep the screen on while the utterance plays.
		// A stale acquire resolving after stop/end releases immediately
		// instead of holding the lock (see resetVoice).
		void acquireStudyWakeLock().then((lock) => {
			if (!lock) return;
			if (speakingId === id) {
				releaseStudyWake();
				studyWakeLock = lock;
			} else {
				lock.release();
			}
		});
		const useNative = settings.voiceEngine === "native";
		const speakWeb = (cb: SpeakCallbacks): boolean =>
			typeof lang === "function" ? speakMultilingual(text, lang, cb) : speakText(text, lang, cb);
		const speakNat = (cb: SpeakCallbacks): boolean =>
			typeof lang === "function"
				? speakNativeMulti(text, lang, cb, settings.nativeVoiceId)
				: speakNative(text, lang, cb, settings.nativeVoiceId);
		let fellBack = false;
		const callbacks: SpeakCallbacks = {
			onEnd: resetVoice,
			onError: (message) => {
				if (useNative && !fellBack) {
					// The bridge failed: say why, then read this utterance
					// with web voices rather than leaving silence (quiet
					// background readbacks skip the notice, not the retry).
					fellBack = true;
					if (!quiet) setVoiceError(`${friendlyNativeError(message)} Falling back to web voices.`);
					const ok = speakWeb({
						onEnd: resetVoice,
						onError: (webMessage) => {
							if (!quiet) setVoiceError(webMessage);
							resetVoice();
						}
					});
					if (!ok) resetVoice();
					return;
				}
				if (!quiet) setVoiceError(useNative ? friendlyNativeError(message) : message);
				resetVoice();
			}
		};
		const ok = useNative ? speakNat(callbacks) : speakWeb(callbacks);
		if (!ok) {
			resetVoice();
			// An empty inventory means no TTS engine/data on the device
			// (check the OS text-to-speech settings); voices present but
			// throwing is a different fault. Say which.
			if (!quiet) {
				setVoiceError(
					!useNative && webVoices().length === 0
						? "No voices on this device — check its text-to-speech settings."
						: "Voice not available."
				);
			}
		}
	}

	/**
	 * Voice locale per sentence: non-Latin scripts resolve sync from the
	 * sentence itself (reliable, needs no bridge); Latin sentences share
	 * one recognizer pass (`latinLang`), since French vs English look
	 * alike. The reply pill's voice never leaks here: an English message
	 * with the Chinese pill on reads English.
	 */
	function speechLangsFor(latinLang: string): (sentence: string) => string {
		const cache = new SvelteMap<string, string>();
		return (sentence: string) => {
			const hit = cache.get(sentence);
			if (hit !== undefined) return hit;
			// Stand-ins resolve per sentence too: a Latin sentence with
			// no Latin voice reads Italian rather than failing.
			const lang = effectiveSpeechLang(ttsLangFor(sentence, "") || latinLang, webVoices());
			cache.set(sentence, lang);
			return lang;
		};
	}

	async function speakReply(msg: ChatMsg, quiet = false): Promise<void> {
		const text = speechText(msg.content);
		if (!text) return;
		if (!speechAttemptable(messageSpeechLang(msg))) {
			if (!quiet) setVoiceError("No voice for this language.");
			return;
		}
		const stripped = text.replace(/```[\s\S]*?```/g, " ");
		startSpeech(msg.id, text, speechLangsFor(await quoteLangFor(stripped, latinFallback())), quiet);
	}

	/** Speak-button label. */
	function speakTitle(msg: ChatMsg): string {
		if (speakingId === msg.id) return "Stop reading aloud";
		return "Read this message aloud";
	}

	function maybeSpeakReply(inChat = chat): void {
		if (!chatVoiceReadback(inChat, settings.voice)) return;
		// Pinned to the chat that was sent from: completing while the
		// user looks elsewhere must not read back some other chat's
		// last message.
		const last = inChat.messages[inChat.messages.length - 1];
		if (last?.role === "assistant" && !last.error && last.content.trim()) {
			// Background readback stays silent throughout: no banner for
			// something the user never asked to hear, including a runtime
			// failure after an attemptable-looking voice.
			if (!speechAttemptable(messageSpeechLang(last))) return;
			void speakReply(last, true);
		}
	}

	/**
	 * Backgrounded long-reply ping (study sessions): when a reply
	 * finishes while the window is hidden/backgrounded, a
	 * permission-gated notification + badge carries its head. Silent
	 * when focused, silent for short replies and failures.
	 */
	function maybeNotifyReplyDone(msg: ChatMsg | undefined): void {
		if (!msg || msg.role !== "assistant" || msg.error) return;
		const body = msg.content.trim();
		if (!body) return;
		if (notifyReplyDone("Reply finished", body)) setStudyBadge(1);
	}

	/**
	 * Effective readback for the visible chat: its own override when
	 * set, else the global default (off at every launch). Reactive —
	 * switching chats re-renders the toggle with that chat's state.
	 */
	function voiceOn(): boolean {
		return chatVoiceReadback(chat, settings.voice);
	}

	function setVoiceEnabled(on: boolean): void {
		// Per-chat setting: the toggle writes this chat's override
		// (persisted with the chats), never the global default — other
		// chats keep theirs.
		setChatVoice(chatState, chatState.activeChatId, on);
		if (!on) stopVoice();
	}

	function toggleVoice(): void {
		// Global stop, always in reach: message audio keeps playing
		// after its row fades (or the user scrolls away from it), and
		// on phones there is no other stop in view. This never flips
		// the readback setting — it only stills the current utterance.
		if (speakingId !== null) {
			stopVoice();
			return;
		}
		setVoiceEnabled(!voiceOn());
	}

	/** Raw speech-recognition errors translated into something actionable. */
	// Mic errors arrive already translated (friendlyMicError in $lib/voice,
	// mapped inside dictateOnce) — callers toast the message directly.

	/**
	 * Highlight-to-speak: only what was selected, only when asked. The quote
	 * keeps its own language (script detection, then Apple's recognizer for
	 * Latin scripts), so a French highlight gets a French voice even when
	 * the message around it is English.
	 */
	async function speakQuote(quote: string, messageId: ChatMsgId, keepMenu = false): Promise<void> {
		// The highlight stays: hearing the quote shouldn't clear the
		// selection it came from. Touch auto-read keeps the menu too,
		// so Annotate stays one tap away after listening.
		const gateLang = effectiveSpeechLang(ttsLangFor(quote, latinFallback()), webVoices());
		if (!speechAttemptable(gateLang)) {
			selMenu = null;
			setVoiceError("No voice for this language.");
			return;
		}
		if (!keepMenu) selMenu = null;
		speakingSelection = messageId;
		// Two kanji identify nothing on their own (Han reads Chinese by
		// default): the quote's sentence picks a Japanese voice when the
		// highlight sits in one.
		const context = speechText(chat.messages.find((m) => m.id === messageId)?.content ?? quote);
		const lang = effectiveSpeechLang(await quoteLangForContext(quote, context, latinFallback()), webVoices());
		startSpeech("selection", quote, speechLangsFor(lang));
	}

	/** Pill-mic dictation into the annotation comment box. */
	let pillDictating = $state(false);
	let stopPillDictation: (() => void) | null = null;
	function stopPillMic(): void {
		stopPillDictation?.();
		stopPillDictation = null;
		pillDictating = false;
	}
	/**
	 * Native-first dictation: the OS recognizer where one exists
	 * (Android/macOS/Windows shell), web SpeechRecognition otherwise.
	 * Resolves a stop function, or null when neither path can listen
	 * (the caller toasts). Native hard errors (denied, busy) surface
	 * directly and skip the web attempt.
	 */
	let micStarting = false;
	async function dictateNativeFirst(
		onResult: (transcript: string) => void,
		onError: (message: string) => void
	): Promise<(() => void) | null> {
		micStarting = true;
		try {
			const outcome = await startNativeDictation(latinFallback(), {
				onFinal: onResult,
				onError
			});
			if (outcome.kind === "started") return outcome.stop;
			if (outcome.kind === "error") {
				onError(outcome.message);
				return null;
			}
		} catch {
			// Bridge blew up mid-start; the web path gets its chance below.
		} finally {
			micStarting = false;
		}
		return dictateOnce(latinFallback(), onResult, onError);
	}
	async function togglePillMic(): Promise<void> {
		if (micStarting) return;
		if (stopPillDictation) {
			stopPillMic();
			return;
		}
		dismissToast();
		const stop = await dictateNativeFirst(
			(transcript) => {
				annDraft =
					annDraft === "" || annDraft.endsWith(" ") ? annDraft + transcript : `${annDraft} ${transcript}`;
				stopPillMic();
			},
			(message) => {
				flashToast(message);
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

	async function toggleMic(): Promise<void> {
		if (micStarting) return;
		if (dictating) {
			stopDictation?.();
			stopDictation = null;
			dictating = false;
			return;
		}
		dismissToast();
		const stop = await dictateNativeFirst(
			(transcript) => {
				editor?.insertText(transcript.endsWith(" ") ? transcript : `${transcript} `);
				dictating = false;
				stopDictation = null;
			},
			(message) => {
				flashToast(message);
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

	/**
	 * Immediate settings save. Keys mirror to secret storage first, then
	 * the shell persists blanks (the browser keeps working as before).
	 * Every save path must use this: a bare saveSettings(settings) would
	 * write live in-memory keys to disk next to the Keychain copy.
	 */
	function saveSettingsNow(source?: AppSettings): void {
		const snapshot = source ?? $state.snapshot(settings);
		void (async () => {
			await persistSecrets(snapshot);
			saveSettings(tauriBackendAvailable() ? withBlankedKeys(snapshot) : snapshot);
		})();
	}

	function persistSettings() {
		saveSettingsNow();
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
		vibrateTick(8);
		clearStudyBadge();
		// Permission-gated background ping: ask from the send gesture
		// while the window is focused, so a later backgrounded long
		// reply may notify. No-op unless undecided.
		void ensureReplyNotificationPermission();
		if (editingMsgId) {
			// Saving an edit rewrites the message in place and resends it:
			// everything from the edited message on is answered fresh. If
			// the edited message vanished mid-edit, fall through below and
			// send the composer text as a fresh message instead.
			const target = chat.messages.find((m) => m.id === editingMsgId);
			if (target && target.role === "user") {
				const index = chat.messages.indexOf(target);
				saveMessageEdit();
				// A reply already streaming keeps its run: truncating under
				// it would orphan the stream, so the resend waits for quiet
				// (the save itself still lands).
				if (!chatState.sending) rerunFrom(index);
				else scrollToBottom();
				return;
			}
			editingMsgId = null;
			editor?.setPlaceholder(promptPlaceholder());
		}
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
		// (possibly long) reply finishes streaming in. The annotation pill
		// and count go with it: the block is already baked into the sent
		// message, so nothing waits on the reply. Attachment pills clear
		// with it (`outgoing` already captured them for the send).
		editor?.clear();
		attachments = [];
		previewId = null;
		annotations = [];
		pendingAnn = null;
		reviewOpen = false;
		editingId = null;
		highlightAnnId = null;
		settleAnnPop();
		annPop = null;
		// Origin chat object (stable by reference): the post-send reads
		// below must not follow a chat switch mid-stream.
		const sentFrom = chat;
		// sendMessage appends the user message (plus the thinking
		// placeholder) synchronously; the scroll waits a tick for the
		// render, or it measures the old height and lands short.
		const sending = sendMessage(
			chatState,
			provider,
			effectiveSystemPrompt(settings, activeReplyCode),
			withAnnotations(text, outgoingAnnotations),
			{ attachments: outgoing, thinking: activeThinkingId(settings), pasteFolds: folds }
		);
		scrollAfterRender();
		await sending;
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
		maybeSpeakReply(sentFrom);
		maybeNotifyReplyDone(chat.messages[chat.messages.length - 1]);
		// The reply's layout churn (hero unmount, list growth, keyboard
		// transitions on phones) can strand the emptied composer's cached
		// line boxes at zero height: settle a re-measure after paint, like
		// the mount path does, so it holds one line without a keystroke.
		requestAnimationFrame(() => requestAnimationFrame(() => editor?.remeasure()));
	}

	async function resend() {
		const provider = resolveProvider();
		if (!provider) {
			missingKey = true;
			return;
		}
		missingKey = false;
		stopVoice();
		const resentFrom = chat;
		await resendLast(chatState, provider, effectiveSystemPrompt(settings, activeReplyCode), {
			thinking: activeThinkingId(settings)
		});
		scrollToBottom();
		maybeSpeakReply(resentFrom);
		maybeNotifyReplyDone(chat.messages[chat.messages.length - 1]);
		// Same settle as a fresh send: the reply's layout churn can
		// strand the composer's cached line boxes at zero height.
		requestAnimationFrame(() => requestAnimationFrame(() => editor?.remeasure()));
	}

	/** The tall composer dwarfs a one-line draft: taps on its empty
	floor focus the editor instead of dying on the container. Buttons,
	fields, and the annotation review keep their own clicks. */
	function focusPromptFloor(event: MouseEvent): void {
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest("button, input, textarea, select, a, .ann-wrap")) return;
		editor?.focus();
	}

	function onSubmit(kind: SubmitKind) {
		// The annotation pill owns Enter while open, and the Enter that
		// saved it must not double as a send right after.
		if (annPop) return;
		// Keyboard sends bypass the dead button: hold the draft while a
		// reply streams (same gate the button uses — see canSubmit).
		if (!canSubmit) return;
		if (kind === "send" && Date.now() < sendGuardUntil) return;
		if (kind === "stage") {
			// ⌥+Enter: most recent message, no reply; the next submit
			// carries the full history in order.
			stageMessage(chatState, composerText(), attachments);
			attachments = [];
			previewId = null;
			editor?.clear();
			scrollAfterRender();
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

	/** Composer placeholder while an own message is being edited. */
	const EDIT_PLACEHOLDER = "Editing message — Enter saves + resends, Esc cancels";

	/**
	 * Pencil (or E) on an own message: pull its display text into the
	 * composer for editing. Enter rewrites the message in place and
	 * resends it (later messages are replaced by the fresh reply); Esc
	 * cancels. The baked annotation block is provider context, not
	 * composer text, so only the prose returns; its refs come back as
	 * pending annotations so saving re-bakes the same context.
	 * Attachments ride along too. No-op mid-send.
	 */
	function editMessage(index: number) {
		if (chatState.sending) return;
		const msg = chat.messages[index];
		if (!msg || msg.role !== "user") return;
		const refs = annRefsFor(msg.content);
		annotations = refs
			? refs.refs.map((r) => ({
					id: newAnnotationId(),
					messageId: msg.id,
					quote: r.quote,
					comment: r.comment
				}))
			: [];
		attachments = msg.attachments ? [...msg.attachments] : [];
		editingMsgId = msg.id;
		reviewOpen = false;
		editingId = null;
		highlightAnnId = null;
		settleAnnPop();
		annPop = null;
		// Message content carries no marker lines (send strips them):
		// recount instead of reconciling, or the just-loaded image
		// attachments would drop as "deleted tags".
		markerSyncMuted = true;
		try {
			editor?.setText(refs ? refs.text : msg.content);
			prevMarkerCount = countMarkerLines(editor?.getText() ?? "");
		} finally {
			markerSyncMuted = false;
		}
		editor?.setPlaceholder(EDIT_PLACEHOLDER);
		editor?.focus();
		scrollToBottom();
	}

	/** Esc during an edit: drop the draft, keep history untouched. */
	function cancelMessageEdit(): void {
		editor?.clear();
		resetDraftExtras();
	}

	/**
	 * Enter while editing: rewrite the edited message in place (text plus
	 * re-baked annotations, attachments, folds). The caller resends from
	 * it unless a reply is already streaming.
	 */
	function saveMessageEdit(): void {
		const id = editingMsgId;
		if (id) {
			const { text, folds } = sendPasteFolds(editor?.getText() ?? "", editor?.getPastes() ?? []);
			editMessageContent(chatState, id, withAnnotations(text, annotations), {
				attachments,
				pasteFolds: folds
			});
		}
		editor?.clear();
		resetDraftExtras();
	}

	/** Stick-to-bottom: submit/resend/stage pins the view to the newest
	content; scrolling up unpins (history never yanks), coming back to
	the bottom re-pins. A finger held on the messages freezes all
	auto-scroll: the in-flight smooth scroll cancels in place and stream
	growth never yanks mid-hold. Plain lets: nothing binds to them. */
	let stick = true;
	let holding = false;
	const STICK_PX = 64;
	function nearBottom(box: HTMLElement): boolean {
		return box.scrollHeight - box.scrollTop - box.clientHeight <= STICK_PX;
	}
	/** Held finger freezes auto-scroll: cancel the in-flight smooth
	scroll in place; stream growth queues nothing mid-hold. */
	function freezeScroll(): void {
		holding = true;
		const box = scrollBox;
		if (box) box.scrollTo({ top: box.scrollTop, behavior: "instant" });
	}
	/** Finger up: stay exactly where held (re-derive stick from the
	real position, so a later stream can't yank from stale state). */
	function releaseScroll(): void {
		holding = false;
		if (scrollBox) stick = nearBottom(scrollBox);
	}
	function scrollToBottom() {
		stick = true;
		// Resisted at submit: a held finger means stay, not scroll.
		if (holding) return;
		scrollBox?.scrollTo({ top: scrollBox.scrollHeight, behavior: "smooth" });
	}
	/**
	 * Scroll after just-appended content renders: measuring in the same
	 * tick reads the pre-append height and strands the new message below
	 * the viewport (the send landed short on phones). tick() flushes the
	 * append first, so the scroll sees the message — and the thinking
	 * placeholder appended with it.
	 */
	function scrollAfterRender(): void {
		void tick().then(() => scrollToBottom());
	}
	let lastStreamLen = 0;
	/** Stream-follow: while a reply streams into the visible chat, stay
	pinned to the newest token — but only while stuck. Instant, never
	queued behind the submit smooth-scroll. */
	$effect(() => {
		const sending = chatState.sending;
		const msgs = viewChat.messages;
		const last = msgs[msgs.length - 1];
		const len = sending && last?.role === "assistant" ? last.content.length : 0;
		if (len <= lastStreamLen) {
			lastStreamLen = len;
			return;
		}
		lastStreamLen = len;
		const box = scrollBox;
		if (stick && !holding && box) box.scrollTo({ top: box.scrollHeight, behavior: "instant" });
	});

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
		editor?.setPlaceholder(scrollPlaceholder());
		if (selectedIdx < 0 && chat.messages.length > 0) {
			selectedIdx = chat.messages.length - 1;
		}
	}

	function enterEditMode() {
		focusMode = "edit";
		editor?.setPlaceholder(promptPlaceholder());
		editor?.focus();
	}

	/**
	 * Unselected-state chat scrolling (desktop, nothing selected):
	 * smooth line/half-page steps and top/bottom jumps. The hovered
	 * message edge (z/Z) measures in viewport space, like the
	 * double-tap path above.
	 */
	function scrollChatBy(dy: number): void {
		scrollBox?.scrollBy({ top: dy, behavior: "smooth" });
	}
	/**
	 * Start a frame-paced glide: pixels accrue per rAF tick from the first
	 * frame, so holding never fires the cancel-and-restart stutter that
	 * per-keydown smooth scrollBy calls produce under key repeat.
	 */
	function startScrollHold(key: string, velocity: number): void {
		stopScrollHold();
		if (!scrollBox) return;
		const hold = { key, velocity, downAt: Date.now(), lastT: performance.now(), raf: 0 };
		scrollHold = hold;
		const tick = (t: number) => {
			if (scrollHold !== hold || !scrollBox) return;
			scrollBox.scrollTop = stepScrollTop(scrollBox.scrollTop, hold.velocity, t - hold.lastT);
			hold.lastT = t;
			hold.raf = requestAnimationFrame(tick);
		};
		hold.raf = requestAnimationFrame(tick);
	}
	/** Release a held key: quick taps land one discrete step, holds just stop. */
	function releaseScrollHold(event: KeyboardEvent): void {
		const hold = scrollHold;
		if (!hold || event.key !== hold.key) return;
		cancelAnimationFrame(hold.raf);
		scrollHold = null;
		if (holdIsTap(hold.downAt, Date.now()) && scrollBox) {
			scrollChatBy(
				hold.key === "d" || hold.key === "u"
					? halfPageDy(scrollBox.clientHeight, hold.velocity > 0 ? 1 : -1)
					: Math.sign(hold.velocity) * SCROLLKEY_LINE_PX
			);
		}
	}
	function stopScrollHold(): void {
		if (scrollHold) cancelAnimationFrame(scrollHold.raf);
		scrollHold = null;
	}
	function scrollChatTop(): void {
		scrollBox?.scrollTo({ top: 0, behavior: "smooth" });
	}
	function scrollChatBottom(): void {
		if (scrollBox) scrollBox.scrollTo({ top: scrollBox.scrollHeight, behavior: "smooth" });
	}
	function scrollHoveredEdge(edge: "start" | "end"): void {
		const el = document.getElementById(`msg-${hoveredIdx}`);
		const box = scrollBox;
		if (!el || !box) return;
		const boxRect = box.getBoundingClientRect();
		const elRect = el.getBoundingClientRect();
		box.scrollTo({
			top: messageEdgeScrollTop({
				scrollTop: box.scrollTop,
				boxTop: boxRect.top,
				elTop: elRect.top,
				elHeight: elRect.height,
				viewH: box.clientHeight,
				edge
			}),
			behavior: "smooth"
		});
	}
	/**
	 * Fullscreen exit for a HELD Escape (timer threshold in
	 * scrollkeys.ts). Device-only path: the Tauri window fullscreen
	 * (menu/green light) and the browser Fullscreen API both need a
	 * real window — unit tests pin only the hold threshold, and this
	 * is unverified on device (no playwright coverage for window
	 * chrome). Failures fall through silently: there is simply no
	 * fullscreen to exit.
	 */
	async function exitFullscreenFromHold(): Promise<void> {
		try {
			if (tauriBackendAvailable()) {
				const win = getCurrentWindow();
				if (await win.isFullscreen()) await win.setFullscreen(false);
				return;
			}
		} catch {
			// Fall through to the web Fullscreen API.
		}
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
		} catch {
			// Nothing fullscreen to exit.
		}
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
		// The pill owns the voice from here, unpinned: a launch without
		// the pill falls back to the system default, while the persisted
		// pill reinstalls its override on launch.
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
	 * (⇧⌘Delete's second half). Anything unknown — no source id (the
	 * bridge is down in browser preview) or an unrecognized layout —
	 * stays silent and leaves the language untouched: routine chat
	 * deletions must never toast.
	 */
	async function resetVoiceLangFromKeyboard(): Promise<void> {
		const sourceId = await currentKeyboardInputSource();
		if (!sourceId) return;
		const locale = voiceLocaleForInputSource(sourceId);
		if (!locale) return;
		settings.voiceLang = locale;
		persistSettings();
	}

	/**
	 * Drop one chat. The voice language follows the checked keyboard only
	 * when nothing with a language is left (a single blank chat remains).
	 */
	function dropChat(id: ChatId): void {
		stopVoice();
		if (id === chatState.activeChatId) {
			// Dropping the open chat discards its drafts (stored entry
			// pruned via the empty save), then the neighbor that slides
			// into its place restores its own filed drafts.
			saveDraftAnnotations(
				id,
				[],
				chatState.chats.map((c) => c.id).filter((c) => c !== id)
			);
			resetDraftExtras();
			deleteChat(chatState, id);
			annotations = loadDraftAnnotations(chatState.activeChatId);
		} else {
			// Dropping a background chat must not touch the open
			// composer's in-memory drafts or attachments: only prune the
			// deleted id out of storage.
			deleteChat(chatState, id);
			saveDraftAnnotations(
				chatState.activeChatId,
				annotations,
				chatState.chats.map((c) => c.id)
			);
		}
		if (chatState.chats.length === 1 && chatState.chats[0]?.messages.length === 0) {
			void resetVoiceLangFromKeyboard();
		}
	}

	/** Drop every chat, then reset the voice language to the keyboard. */
	function dropAllChats(): void {
		stopVoice();
		resetDraftExtras();
		deleteAllChats(chatState);
		// Every filed draft died with its chat: prune the whole record
		// so the fresh blank starts clean even in storage.
		saveDraftAnnotations(chatState.activeChatId, [], [chatState.activeChatId]);
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
				// Tag → pill half of two-way removal: the user deleted
				// marker lines by hand, so the newest image attachments
				// go with them (newest first — pastes stack in order).
				if (markerSyncMuted) return;
				const now = countMarkerLines(text);
				if (now < prevMarkerCount) {
					let drop = prevMarkerCount - now;
					const kept = [...attachments];
					for (let i = kept.length - 1; i >= 0 && drop > 0; i--) {
						if (kept[i]?.kind === "image") {
							kept.splice(i, 1);
							drop--;
						}
					}
					attachments = kept;
					if (previewId && !attachments.some((a) => a.id === previewId)) {
						previewId = null;
					}
				}
				prevMarkerCount = now;
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
		// The second press of a double-click zooms instead of dragging.
		if (event.detail > 1) return;
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

	/**
	 * Native menu bar clicks (desktop shell only): the Rust side emits
	 * `menu-action` with the item id. The frontend keeps its own key
	 * handlers for the browser runtime, where no menu exists — and on
	 * macOS the menu consumes its accelerators before the webview ever
	 * sees them, so the two paths don't double-fire.
	 */
	async function listenMenuActions(): Promise<void> {
		if (!tauriBackendAvailable()) return;
		try {
			await listen<string>("menu-action", (event) => {
				const action = event.payload;
				if (action === "settings") {
					toggleSettingsPanel();
					if (!settingsOpen) pulseCursor();
				} else if (action === "new-chat") {
					doNewChat();
				} else if (action === "delete-chat") {
					dropChat(chat.id);
					editor?.focus();
				} else if (action === "toggle-sidebar") {
					toggleSidebar();
					if (!settings.sidebarCollapsed) focusFirstSideChat();
				} else if (action === "next-chat") {
					stepChat(1);
				} else if (action === "prev-chat") {
					stepChat(-1);
				} else if (action === "shortcuts") {
					shortcutsOpen = true;
				} else if (action === "share-sheet") {
					void shareCurrentChat();
				} else if (action === "print-sheet") {
					printCurrentChat();
				} else if (action === "bigger-text") {
					adjustFontScale(0.1);
				} else if (action === "smaller-text") {
					adjustFontScale(-0.1);
				}
			});
		} catch (error) {
			console.warn(
				"Menu events unavailable:",
				error instanceof Error ? error.message : String(error)
			);
		}
	}

	/**
	 * `ccez://` deep links (desktop shell only): `ccez://chat/<id>`
	 * opens the chat when it exists (unknown ids are ignored, never
	 * an error toast), `ccez://new` mints a chat. Cold-start links
	 * wait in the backend drain slot; live ones arrive as events.
	 */
	async function wireDeepLinks(): Promise<void> {
		if (!tauriBackendAvailable()) return;
		try {
			await listenDeepLinks((link) => {
				if (link.kind === "new-chat") {
					doNewChat();
					return;
				}
				const exists = chatState.chats.some((c) => c.id === link.chatId);
				if (!exists) return;
				saveDraftAnnotations(chatState.activeChatId, annotations, chatState.chats.map((c) => c.id));
				selectChat(chatState, link.chatId as ChatId);
				annotations = loadDraftAnnotations(link.chatId);
				enterEditMode();
			});
		} catch (error) {
			console.warn(
				"Deep-link events unavailable:",
				error instanceof Error ? error.message : String(error)
			);
		}
	}

	/**
	 * Share the visible chat as a study sheet: the backend writes the
	 * file for native share-out, then the OS sheet / clipboard /
	 * download fallback presents it. One toast names the outcome.
	 */
	async function shareCurrentChat(): Promise<void> {
		const lines = chat.messages.map((m) => ({ role: m.role, content: m.content }));
		const title = sheetTitle(lines);
		const markdown = studySheetMarkdown(title, lines);
		const saved = await exportStudySheet(title, lines);
		const outcome = await shareStudySheet(title, markdown);
		if (outcome === "shared") {
			flashToast(saved ? `Study sheet shared (${saved})` : "Study sheet shared");
		} else if (outcome === "copied") {
			flashToast("Study sheet copied — paste it anywhere");
		} else if (outcome === "downloaded") {
			flashToast("Study sheet downloaded");
		} else {
			flashToast("Sharing is unavailable here");
		}
	}

	/**
	 * Print the visible chat as a study sheet (`#study-sheet-print`
	 * is the only node the print stylesheet shows; Save as PDF in
	 * that dialog writes the file).
	 */
	function printCurrentChat(): void {
		if (!printStudySheet()) flashToast("Printing is unavailable here");
	}

	/**
	 * Double-click the title strip zooms the window (fills the screen):
	 * the macOS titlebar behavior, next to the green light that goes
	 * fullscreen instead. Clicks on controls keep their own actions.
	 */
	/**
	 * Double-click the empty gutters beside the centered column opens
	 * the nearby sidebar: left gutter the chat list, right gutter
	 * settings. Clicks on messages and controls keep their own
	 * actions (double-click still selects words); clicks inside the
	 * column but between messages do nothing.
	 */
	function gutterDoubleClick(event: MouseEvent): void {
		const target = event.target;
		if (!(target instanceof HTMLElement) || !scrollBox) return;
		if (
			target.closest(
				"article, button, input, select, textarea, a, summary, details, .sel-menu, .translate-panel, .review, .ann-pop"
			)
		) {
			return;
		}
		let left = Infinity;
		let right = -Infinity;
		scrollBox.querySelectorAll("article, .empty-state").forEach((el) => {
			const box = el.getBoundingClientRect();
			left = Math.min(left, box.x);
			right = Math.max(right, box.x + box.width);
		});
		if (left === Infinity) return;
		if (event.clientX < left) {
			if (settings.sidebarCollapsed) {
				settings.sidebarCollapsed = false;
				persistSettings();
			}
		} else if (event.clientX > right) {
			if (!settingsOpen) openSettingsPanel();
		}
	}

	function zoomWindow(event: MouseEvent): void {
		if (!tauriBackendAvailable()) return;
		const target = event.target;
		if (target instanceof HTMLElement && target.closest("button, input, select, textarea, a")) {
			return;
		}
		try {
			getCurrentWindow()
				.toggleMaximize()
				.catch((error: unknown) => {
					const message = error instanceof Error ? error.message : String(error);
					console.warn("Window zoom failed:", message);
				});
		} catch (error) {
			console.warn(
				"Window zoom failed:",
				error instanceof Error ? error.message : String(error)
			);
		}
	}

	onMount(() => {
		try {
			// iOS rides the same phone UI (touch composer, no hover,
			// native voice picker): the name is historical. Touch
			// tablets join it too: iPads in desktop-mode Safari report
			// a Macintosh UA, so touch points plus the coarse pointer
			// and screen size pick them up (see isTouchTablet).
			androidUI = isAndroidUserAgent(navigator.userAgent) || isIOSUserAgent(navigator.userAgent)
				|| isTouchTablet({
					ua: navigator.userAgent,
					coarse: isCoarsePointer((q) => window.matchMedia(q)),
					maxTouchPoints: navigator.maxTouchPoints ?? 0,
					smallestScreenDim: Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0)
				});
			iosUI = isIOSUserAgent(navigator.userAgent);
		} catch {
			androidUI = false;
			iosUI = false;
		}
		// Shortcuts-modal labels: navigator.platform with User-Agent
		// Client Hints winning (see currentPlatform). Unknown platforms
		// read as non-Mac, so the Ctrl/Alt labels show.
		isMac = currentPlatform().isMac;
		// One engine everywhere, pinned silently (the desktop engine
		// picker is gone): system voices when the bridge is up, web
		// voices when it is not. The settings panel repeats the probe
		// for its picker; this is the silent path.
		void nativeTtsSupported().then((supported) => {
			const want = supported ? "native" : "web";
			if (settings.voiceEngine !== want) {
				settings.voiceEngine = want;
				persistSettings();
			}
		});
		// External-text bridge (Android OS selection menu): the entry
		// comes from the AnnotateAction manifest alias, so the text it
		// carries is either a share from another app or the selection
		// just made in-app. A pick matching the live web selection
		// opens the annotation popover for it; anything else prefills
		// the composer. The web row itself is untouched.
		if (tauriBackendAvailable()) {
			try {
				void listen<{ text: string | null }>("annotate-external", (event) => {
					const text = event.payload?.text ?? null;
					const live = window.getSelection()?.toString() ?? "";
					if (text && text !== live.trim()) {
						if (!chatState.activeChatId) newChat(chatState);
						editor?.setText(joinExternalDraft(editor?.getText() ?? "", text));
						editor?.focus();
						return;
					}
					if (text) placeSelMenu();
					if (selMenu?.quote.trim()) annotate();
					else flashToast("Select text first, then Annotate.");
				}).then(() => {
					// Cold start: a share that arrived before setup parked
					// in Rust — the listener is registered now, so drain it.
					void invoke("drain_pending_external").catch(() => {});
				});
			} catch (error) {
				console.warn(
					"External-text events unavailable:",
					error instanceof Error ? error.message : String(error)
				);
			}
		}
		// File Handling launch: a .md file opened with the app lands
		// its text in the composer (blank-line joined like shared
		// text); anything else rides the attachments path. Where
		// launchQueue is missing no launch can arrive, and the
		// consumer stays unset.
		const launchQueue =
			(window as unknown as { launchQueue?: LaunchQueueLike }).launchQueue ?? null;
		consumeLaunchFiles(launchQueue, async (files) => {
			const { markdown, rest } = splitLaunchFiles(files);
			for (const file of markdown) {
				try {
					const text = await file.text();
					if (!chatState.activeChatId) newChat(chatState);
					editor?.setText(joinExternalDraft(editor?.getText() ?? "", text));
				} catch (error) {
					attachError = error instanceof Error ? error.message : String(error);
				}
			}
			if (markdown.length > 0) {
				editor?.focus();
				flashToast(
					markdown.length === 1
						? "Opened file in the composer"
						: "Opened files in the composer"
				);
			}
			if (rest.length > 0) await addFiles(rest);
		});
		// A pill-owned voice must not leak past its chat: when the
		// launch chat carries no reply pill and nobody pinned the
		// field, the voice falls back to the system default — new
		// chats start in English, pill chats reinstall their own.
		const launchChat =
			chatState.chats.find((c) => c.id === chatState.activeChatId) ?? null;
		if (!settings.voiceLangPinned && !launchChat?.replyLang) {
			const fallback = systemLocale();
			if (settings.voiceLang !== fallback) {
				settings.voiceLang = fallback;
				persistSettings();
			}
		}
		// Edge swipes toggle the sidebars on touch screens (Android
		// milestone): rightward from the left edge for chats, leftward
		// from the right edge for settings. Toggle, not open-only: with
		// no keyboard or Esc key, a swipe is the touch user's only way
		// back out. Multi-touch cancels, and the mostly-horizontal rule
		// keeps scrolling and code-block pans to themselves. Passive:
		// the app never blocks a scroll.
		/**
		 * Mid-screen swipe target (phone only): like the edge rule, but for
		 * strokes starting in the middle of the conversation. Gated on the
		 * Android UA so touchscreen laptops never see it, and suppressed
		 * while text is selected (handle-dragging), while starting in an
		 * editable, or while the shortcuts modal owns the screen.
		 */
		function middleSwipeTarget(
			start: { x: number; y: number; clean: boolean },
			ended: { clientX: number; clientY: number }
		): EdgePanel | null {
			if (!androidUI || !start.clean || shortcutsOpen || inspectChar) return null;
			if (window.getSelection()?.isCollapsed === false) return null;
			return contentSwipeTarget(start.x, start.y, ended.clientX, ended.clientY);
		}
		/**
		 * Shared edge-stroke outcome (touch swipes and desktop mouse
		 * drags): dismiss first, summon second. A rightward stroke with
		 * settings open closes settings; a leftward stroke with chats
		 * open closes the sheet. Gutter double-click stays as-is.
		 */
		function applyEdgeTarget(target: EdgePanel | null): void {
			if (target === "chats") {
				if (settingsOpen) toggleSettingsPanel();
				// Touch: a left-to-right swipe opens the chats sidebar
				// (with its search box); the toggle still dismisses via
				// the same stroke when already open.
				else toggleSidebar();
			} else if (target === "settings") {
				// A leftward stroke never closes settings once open —
				// only a rightward stroke (the "chats" branch) dismisses.
				if (settingsOpen) return;
				if (!settings.sidebarCollapsed) {
					settings.sidebarCollapsed = true;
					persistSettings();
				} else toggleSettingsPanel();
			}
		}
		/**
		 * Desktop mouse edge-drag: the desktop analog of the touch edge
		 * swipe — press near the screen edge and drag horizontally to
		 * summon or dismiss the sidebars. Touch hardware rides the touch
		 * path above, so this is mouse-only and desktop-only. Text
		 * selection drags never count: a stroke that changed the
		 * selection, or started in an editable or on a control, is
		 * ignored. Passive: the app never blocks the drag.
		 */
		let edgeMouse: { x: number; y: number; clean: boolean; sel: string } | null = null;
		window.addEventListener("pointerdown", (event) => {
			if (androidUI || event.pointerType !== "mouse" || event.button !== 0) return;
			const target = event.target;
			const clean =
				!(target instanceof Element) ||
				target.closest(
					".cm-content, input, textarea, select, [contenteditable='true'], button, a"
				) === null;
			edgeMouse = {
				x: event.clientX,
				y: event.clientY,
				clean,
				sel: window.getSelection()?.toString() ?? ""
			};
		});
		window.addEventListener("pointerup", (event) => {
			const start = edgeMouse;
			edgeMouse = null;
			if (!start || !start.clean || androidUI) return;
			if (event.pointerType !== "mouse" || event.button !== 0) return;
			if ((window.getSelection()?.toString() ?? "") !== start.sel) return;
			applyEdgeTarget(
				edgeSwipeTarget(start.x, start.y, event.clientX, event.clientY, window.innerWidth)
			);
		});
		let edgeTouch: {
			id: number;
			x: number;
			y: number;
			clean: boolean;
			rowSwipe: boolean;
			msgId: ChatMsgId | null;
		} | null = null;
		window.addEventListener(
			"touchstart",
			(event) => {
				if (event.touches.length > 1) {
					edgeTouch = null;
					return;
				}
				const touch = event.touches[0];
				if (!touch) return;
				// Mid-screen swipes must never steal text entry: a swipe
				// starting in the composer or a field is cursor/scroll work.
				const target = event.target;
				const clean =
					!(target instanceof Element) ||
					target.closest(".cm-content, input, textarea, select, [contenteditable='true']") === null;
				// Message the stroke starts on (for swipe-to-fold). The
				// article id carries the viewChat index (see msg-{i}).
				const art = target instanceof Element ? articleOf(target) : null;
				const msgIndex = art ? Number(art.id.slice(4)) : NaN;
				const msgId =
					Number.isInteger(msgIndex) ? (viewChat.messages[msgIndex]?.id ?? null) : null;
				// A stroke starting on the action row is the row's own
				// scroll: scrolling an overflowing row must never fold
				// the message or summon a sidebar.
				const rowSwipe = target instanceof Element && target.closest(".actions") !== null;
				edgeTouch = { id: touch.identifier, x: touch.clientX, y: touch.clientY, clean, rowSwipe, msgId };
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchend",
			(event) => {
				const start = edgeTouch;
				edgeTouch = null;
				if (!start) return;
				let ended: { identifier: number; clientX: number; clientY: number } | null = null;
				for (let i = 0; i < event.changedTouches.length; i++) {
					const candidate = event.changedTouches[i];
					if (candidate && candidate.identifier === start.id) ended = candidate;
				}
				if (!ended) return;
				// Phone: a rightward stroke starting on a message folds it
				// (a rightward stroke elsewhere dismisses settings or does
				// nothing — the fold only wins on a message). An active
				// text selection wins — folding mid-select would eat the
				// highlight.
				const foldDx = ended.clientX - start.x;
				const foldDy = ended.clientY - start.y;
				if (
					androidUI &&
					start.msgId &&
					!start.rowSwipe &&
					foldDx >= 64 &&
					Math.abs(foldDy) < Math.abs(foldDx) &&
					window.getSelection()?.isCollapsed !== false
				) {
					toggleFold(start.msgId);
					return;
				}
				const target = start.rowSwipe
					? null
					: (edgeSwipeTarget(start.x, start.y, ended.clientX, ended.clientY, window.innerWidth) ??
						middleSwipeTarget(start, ended));
				applyEdgeTarget(target);
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchcancel",
			() => {
				edgeTouch = null;
			},
			{ passive: true }
		);
		// Touch text selection: a long-press selects natively, but the
		// compatibility mouse sequence trailing it looks like a stale
		// click (mousedown snapshots the already-made selection, mouseup
		// clears it as "unchanged"), so the menu never appears. Handle
		// touchend directly — a lift over message text with a NEW
		// selection summons the menu — and the guard in onMouseUp
		// swallows the compat mouseup behind it. Multi-touch gestures
		// claim their own sequences; taps matching the pre-touch
		// selection are handle nudges, not new picks.
		let touchMenuAt = 0;
		let multiTouchSeen = false;
		let selTouchStart: { x: number; y: number; sel: string } | null = null;
		window.addEventListener(
			"touchstart",
			(event) => {
				if (event.touches.length > 1) {
					multiTouchSeen = true;
					selTouchStart = null;
					return;
				}
				const first = event.touches[0];
				selTouchStart = first
					? { x: first.clientX, y: first.clientY, sel: window.getSelection()?.toString() ?? "" }
					: null;
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchend",
			(event) => {
				const start = selTouchStart;
				selTouchStart = null;
				if (event.touches.length === 0) {
					const claimed = multiTouchSeen;
					multiTouchSeen = false;
					if (claimed) return;
				} else if (multiTouchSeen) {
					return;
				}
				if (!androidUI || shortcutsOpen || inspectChar || !start) return;
				const touch = event.changedTouches[0];
				if (!touch) return;
				// No travel limit: dragging the selection handles across
				// lines ends far from where the touch began, and that lift
				// is exactly the multi-line pick the menu must serve. Scrolls
				// can't summon it (they leave the selection unchanged, so the
				// equality check below filters them), and lifts outside text
				// fail the .rendered check.
				const el = document.elementFromPoint(touch.clientX, touch.clientY);
				if (!el?.closest(".messages .rendered")) return;
				const live = window.getSelection()?.toString() ?? "";
				if (live === "" || live === start.sel) return;
				placeSelMenu(touch.clientX);
				touchMenuAt = Date.now();
				// Headphones in: the fresh selection reads itself aloud
				// on release (when a voice fits). The menu stays up, so
				// Annotate is still one tap away after listening.
				// Phones never do this: every selection would talk.
				if (!androidUI && settings.autoSpeakSelection) {
					const fresh = currentQuote();
					if (fresh) void speakQuote(fresh.quote, fresh.messageId, true);
				}
			},
			{ passive: true }
		);
		// A dead highlight drops its menu at once: taps elsewhere (and
		// handle collapses) clear the selection without touching the
		// mouse/touch summon paths, so without this the menu stranded
		// until the 4.5s timer. Presses that began in the menu stand
		// down (see menuPressAt): the button's own release collapses
		// the highlight, and Annotate runs off the stored quote.
		document.addEventListener("selectionchange", () => {
			if (!selMenu) return;
			if (Date.now() - menuPressAt < 1000) return;
			const live = window.getSelection();
			if (!live || live.isCollapsed || live.toString() === "") selMenu = null;
		});
		// Two-finger horizontal swipe steps chats (right = newer, left =
		// older, no focus: the keyboard stays down); a two-finger double
		// tap toggles the chats sidebar on Android; a double three-finger
		// tap deletes the current chat. All start away from controls,
		// drawers, and the modal, and the swipe's pinch veto (see
		// twoFingerSwipeDir) keeps page zoom.
		let twoTrack: { start: [FingerTrack, FingerTrack]; end: [FingerTrack, FingerTrack] } | null =
			null;
		let threeTrack: { x: number; y: number; moved: number; at: number } | null = null;
		let lastThreeTapAt = 0;
		let twoTapAt = 0;
		let lastTwoTapAt = 0;
		const gestureClean = (event: TouchEvent): boolean => {
			if (!androidUI || shortcutsOpen) return false;
			const target = event.target;
			return (
				!(target instanceof Element) ||
				target.closest(
					".cm-content, input, textarea, select, [contenteditable='true'], button, aside, .settings-panel, .modal, .sel-menu"
				) === null
			);
		};
		const trackOf = (t: Touch): FingerTrack => ({ id: t.identifier, x: t.clientX, y: t.clientY });
		window.addEventListener(
			"touchstart",
			(event) => {
				if (event.touches.length === 2) {
					const a = event.touches[0];
					const b = event.touches[1];
					twoTrack =
						a && b && gestureClean(event)
							? { start: [trackOf(a), trackOf(b)], end: [trackOf(a), trackOf(b)] }
							: null;
					// A clean two-finger press starts the double-tap clock.
					twoTapAt = twoTrack ? Date.now() : 0;
					threeTrack = null;
				} else if (event.touches.length === 3) {
					const first = event.touches[0];
					threeTrack =
						first && gestureClean(event)
							? { x: first.clientX, y: first.clientY, moved: 0, at: Date.now() }
							: null;
					twoTrack = null;
				} else {
					twoTrack = null;
				}
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchmove",
			(event) => {
				if (threeTrack) {
					const first = event.touches[0];
					if (first) {
						threeTrack.moved = Math.max(
							threeTrack.moved,
							Math.hypot(first.clientX - threeTrack.x, first.clientY - threeTrack.y)
						);
					}
				}
				if (twoTrack) {
					for (const t of Array.from(event.touches)) {
						const slot = twoTrack.end.find((e) => e.id === t.identifier);
						if (slot) {
							slot.x = t.clientX;
							slot.y = t.clientY;
						}
					}
				}
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchend",
			(event) => {
				if (twoTrack) {
					for (const t of Array.from(event.changedTouches)) {
						const slot = twoTrack.end.find((e) => e.id === t.identifier);
						if (slot) {
							slot.x = t.clientX;
							slot.y = t.clientY;
						}
					}
					if (event.touches.length === 0) {
						const dir = twoFingerSwipeDir(twoTrack.start, twoTrack.end);
						const now = Date.now();
						const moved = Math.max(
							Math.hypot(
								twoTrack.end[0].x - twoTrack.start[0].x,
								twoTrack.end[0].y - twoTrack.start[0].y
							),
							Math.hypot(
								twoTrack.end[1].x - twoTrack.start[1].x,
								twoTrack.end[1].y - twoTrack.start[1].y
							)
						);
						twoTrack = null;
						if (dir !== null) stepChat(dir, false);
						// Still two-finger taps pair into a sidebar toggle
						// (Android): swipes take the step path instead.
						else if (androidUI && twoTapAt > 0 && moved <= 12 && now - twoTapAt <= 400) {
							if (now - lastTwoTapAt < 600) {
								lastTwoTapAt = 0;
								// The open keyboard would cover the sidebar.
								(document.activeElement as HTMLElement | null)?.blur?.();
								toggleSidebar();
							} else lastTwoTapAt = now;
						}
					}
				}
				if (threeTrack && event.touches.length === 0) {
					const track = threeTrack;
					threeTrack = null;
					const now = Date.now();
					if (isThreeFingerTap(3, track.moved, now - track.at)) {
						if (now - lastThreeTapAt < 600) {
							lastThreeTapAt = 0;
							dropChat(chatState.activeChatId);
							flashToast("Chat deleted");
						} else {
							lastThreeTapAt = now;
						}
					}
				}
			},
			{ passive: true }
		);
		window.addEventListener(
			"touchcancel",
			() => {
				twoTrack = null;
				threeTrack = null;
			},
			{ passive: true }
		);
		if (!promptEl) return;
		// Android gets the plain-textarea composer: no measurement cache
		// (no collapse) and no compositor layer games (no tap ghost).
		editor = androidUI
			? createTextareaEditor(promptEl, promptOptions())
			: createPromptEditor(promptEl, promptOptions());
		editor.setPlaceholder(promptPlaceholder());
		// Desktop lands in the prompt on launch; phones don't — popping
		// the keyboard on every cold start is the mobile annoyance.
		if (!androidUI) {
			editor.focus();
			// Mount-time focus can lose to hydration churn; retry on next
			// frame so a fresh window and a new chat both land in the prompt.
			requestAnimationFrame(() => editor?.focus());
		}
		// First paint can measure while the webview is still settling
		// (window restore, DPR): cached line boxes go stale and the prompt
		// snaps to a new height on the next measure. Settle it up front,
		// after paint, like the window-focus path does.
		requestAnimationFrame(() => requestAnimationFrame(() => editor?.remeasure()));

		const onKey = (event: KeyboardEvent) => {
			// Fullscreen-hold tracking rides above every Escape path:
			// the keydown dismiss behavior below is untouched (a tap
			// still dismisses exactly as today); the keyup handler
			// exits fullscreen only past the hold threshold.
			if (event.key === "Escape" && !event.repeat) escDownAt = Date.now();
			const inEditor = (event.target as HTMLElement | null)?.closest(".cm-content, .ta-input");
			if ((event.metaKey || event.ctrlKey) && (event.key === "t" || event.key === "T")) {
				// Over selected message text the combo feeds the
				// translate lookup (S4 behavior, selection-triggered).
				// Everywhere else — including the prompt — it opens
				// the single-tab browser and lands focus in its
				// address bar.
				if (!inEditor && currentQuote()) {
					event.preventDefault();
					event.stopPropagation();
					void openTranslate();
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				if (!sideviewOpen) void setSideviewOpen(true, true);
				else focusBrowserAddress();
				return;
			}
			if (event.key === "Escape" && (shortcutsOpen || inspectChar)) {
				// A modal always wins Esc, even from inside the prompt.
				event.preventDefault();
				event.stopPropagation();
				shortcutsOpen = false;
				inspectChar = null;
				return;
			}
			if (event.key === "Escape" && searchOpen) {
				// The search palette wins Esc next, even from its input.
				event.preventDefault();
				event.stopPropagation();
				closeSearch();
				return;
			}
			if (event.key === "Escape" && sideviewOpen) {
				// The docked browser panel closes next, from
				// anywhere (it has no text worth cancelling).
				event.preventDefault();
				event.stopPropagation();
				void setSideviewOpen(false);
				return;
			}
			if (
				(event.metaKey || event.ctrlKey) &&
				!event.altKey &&
				!event.shiftKey &&
				event.code === "KeyP"
			) {
				// Full-text search palette across chats/annotations.
				// Browsers reserve Ctrl+P for print and may keep it; the
				// shell owns the combo and always delivers it.
				event.preventDefault();
				event.stopPropagation();
				if (searchOpen) closeSearch();
				else openSearch();
				return;
			}
			if (isSummonHotkey(event) && !inEditor) {
			// Summon chord (Cmd/Ctrl+Shift+Space): focus the composer
			// from anywhere outside it. Inside the editor the chord
			// stays unbound so Ctrl+Shift+Space still types a
			// non-breaking space; the OS-global half (desktop.rs)
			// skips focused windows for the same reason.
			event.preventDefault();
			event.stopPropagation();
			enterEditMode();
			return;
		}
		if (event.key === "Escape" && editingMsgId) {
				// An in-progress message edit cancels from anywhere,
				// including inside the prompt (capture phase pre-empts
				// the editor, which binds nothing to Esc).
				event.preventDefault();
				event.stopPropagation();
				cancelMessageEdit();
				return;
			}
			if (event.key === "Escape" && inEditor) {
				// ESC with the composer focused: drop the caret and
				// dismiss composer-adjacent overlays. Voice keeps playing
				// (it has its own toggle); modals, search, sideview, and
				// message edits keep their earlier branches above.
				event.preventDefault();
				event.stopPropagation();
				editor?.blur();
				selMenu = null;
				translate = null;
				openLangMenu = null;
				return;
			}
		if (event.key === "Escape" && !inEditor) {
				selMenu = null;
				inspectChar = null;
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
				setVoiceEnabled(!voiceOn());
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
					toggleSettingsPanel();
					return;
				}
				if (event.code === "KeyH") {
					// ⇧⌘H with settings open closes them and lands in the
					// prompt; otherwise it mirrors ⌘B for the chat list.
					event.preventDefault();
					event.stopPropagation();
					if (settingsOpen) {
						settingsOpen = false;
						enterEditMode();
						return;
					}
					toggleSidebar();
					if (!settings.sidebarCollapsed) focusFirstSideChat();
					return;
				}
				if (event.code === "KeyL") {
					// ⇧⌘L with the chat list open closes it and lands in
					// the prompt; otherwise it mirrors ⌘, for settings.
					event.preventDefault();
					event.stopPropagation();
					if (!settings.sidebarCollapsed) {
						settings.sidebarCollapsed = true;
						persistSettings();
						enterEditMode();
						return;
					}
					toggleSettingsPanel();
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
			if (
			(event.metaKey || event.ctrlKey) &&
			!event.altKey &&
			(event.key === "=" ||
				event.key === "+" ||
				event.key === "-" ||
				event.key === "_")
		) {
			// ⌘+ / ⌘- scales the whole UI (the app's own zoom — the
			// shell has no browser-chrome zoom to fall back on). With Shift
			// held the same chords widen/narrow the chat column instead.
			event.preventDefault();
			event.stopPropagation();
			const narrow = event.key === "-" || event.key === "_";
			if (event.shiftKey) adjustChatWidth(narrow ? -2 : 2);
			else adjustFontScale(narrow ? -0.1 : 0.1);
			return;
		}
		if (
			(event.metaKey || event.ctrlKey) &&
			!event.altKey &&
			event.shiftKey &&
			(event.key === "<" || event.key === ",")
		) {
			// ⇧⌘, mirrors ⌘, (Shift turns the comma key into "<" on US
			// layouts, so both spellings count) — toggles the panel.
			event.preventDefault();
			event.stopPropagation();
			toggleSettingsPanel();
			return;
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
					toggleSettingsPanel();
					return;
				}
				if (event.key === ",") {
					// ⌘, — the macOS Settings shortcut — toggles the panel.
					event.preventDefault();
					event.stopPropagation();
					toggleSettingsPanel();
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
			if (
				(event.key === "e" || event.key === "E") &&
				!inEditor &&
				hoveredIdx >= 0 &&
				!event.metaKey &&
				!event.ctrlKey &&
				!event.altKey &&
				!event.shiftKey &&
				!(event.target as HTMLElement | null)?.closest("input, textarea, select")
			) {
				// E pulls the hovered own message into the composer for
				// editing — same ownership rule as F, own messages only.
				const target = chat.messages[hoveredIdx];
				if (target?.role === "user") {
					event.preventDefault();
					editMessage(hoveredIdx);
					return;
				}
			}
		if (
			(event.key === "x" || event.key === "X") &&
			!inEditor &&
			hoveredIdx >= 0 &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			!event.shiftKey &&
			!(event.target as HTMLElement | null)?.closest("input, textarea, select")
		) {
				// X cuts the hovered message (copies, then deletes): the
				// Delete key below deletes without touching the clipboard.
				event.preventDefault();
				cutHoverMessage(hoveredIdx);
				return;
		}
		if (
			(event.key === "Delete" || event.key === "Backspace") &&
			!inEditor &&
			hoveredIdx >= 0 &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			!event.shiftKey &&
			!(event.target as HTMLElement | null)?.closest("input, textarea, select, button, a")
		) {
			// Bare Delete drops the hovered message and copies nothing
			// (X is the cut key). Buttons and links keep their own
			// keys — space and enter still activate a focused control.
			event.preventDefault();
			deleteMessage(chatState, hoveredIdx);
			return;
		}
		const inSidebar = (event.target as HTMLElement | null)?.closest("aside");
			if (!settings.sidebarCollapsed && inSidebar) {
				// Open chat list owns its keys: j/k walks chats AND
				// switches to each one (preview-as-you-go), space/l
				// enters the cursor chat, closes the list, and lands in
				// its prompt.
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
					const landed = chats[Math.min(Math.max(sideIdx, 0), chats.length - 1)];
					if (landed) transitionToChat(landed.id);
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
				if (
					!event.metaKey &&
					!event.ctrlKey &&
					!event.altKey &&
					!event.shiftKey &&
					(event.key === "Delete" || event.key === "Backspace")
				) {
					// Delete drops the focused chat and lands on the one
					// below (or a fresh blank when the list empties).
					event.preventDefault();
					deleteSideChat();
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
			if (focusMode !== "scroll" && !inEditor && !androidUI) {
				// Desktop scrolling with nothing selected: no message
				// selected (edit mode), no sidebar focus, no modal
				// owning the screen, and no typing target under the
				// key. Every existing binding above keeps its keys —
				// this branch only claims otherwise-unbound bare keys.
				const target = event.target as HTMLElement | null;
				const modalOpen = shortcutsOpen || searchOpen || inspectChar;
				const typing =
					inEditor || target?.closest("input, textarea, select, [contenteditable]") || inSidebar;
				if (!modalOpen && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
					const intent = unselectedScrollIntent(event.key, ggArmed(lastGAt, Date.now()));
					if (intent) {
						if (intent.kind === "gg-prefix") {
							lastGAt = Date.now();
						} else {
							lastGAt = 0;
							if (intent.kind === "line" || intent.kind === "half-page") {
								// Held keys glide via the rAF loop (no restart
								// stutter); the loop owns repeats until keyup.
								// Other line sources (arrows) keep stepping.
								const velocity = scrollBox ? scrollHoldVelocity(event.key) : null;
								if (velocity !== null) {
									if (!event.repeat) startScrollHold(event.key, velocity);
								} else if (intent.kind === "line") scrollChatBy(intent.dy);
								else if (scrollBox) scrollChatBy(halfPageDy(scrollBox.clientHeight, intent.dir));
							} else if (intent.kind === "top") scrollChatTop();
							else if (intent.kind === "bottom") scrollChatBottom();
							else if (intent.kind === "hovered-edge" && hoveredIdx >= 0) {
								scrollHoveredEdge(intent.edge);
							} else return;
						}
						event.preventDefault();
						return;
					}
					lastGAt = 0;
				}
			}
			if (focusMode !== "scroll" || inEditor) return;
			if (event.key === "j" || event.key === "ArrowDown") {
				event.preventDefault();
				lastGAt = 0;
				// Past the newest message drops back into the prompt:
				// scroll mode is for visiting history, not parking.
				if (selectedIdx >= chat.messages.length - 1) enterEditMode();
				else jumpTo(selectedIdx + 1);
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
		// keyboard path (Enter). Desktop Chrome eats the click that
		// trails a preventDefaulted mousedown, but iOS Safari fires
		// it — without the press stamp below, every tap opens the
		// menu on mousedown and toggles it straight shut on click.
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
			lastBadgePress = { id, at: Date.now() };
		};
		// Double-click summons the menu for the native word pick (the
		// pick finalizes after mouseup, so mouseup alone never sees it).
		// Triple-click keeps native paragraph selection: badges are
		// absolutely-positioned overlays with user-select:none, so they
		// no longer interrupt it the way inline marks did.
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
			placeSelMenu(event.clientX);
			if (androidUI) scrollActionsIntoView(event);
		};
		/**
		 * Double-tapping a message whose action row is off-screen
		 * scrolls the row into view: its buttons live below the fold
		 * and a phone has no hover to reveal them. Rows already
		 * visible never move (nearest), and desktop keeps word-select
		 * only. Own and assistant rows share the .actions class.
		 */
		const scrollActionsIntoView = (event: MouseEvent): void => {
			const target = event.target instanceof Element ? event.target : null;
			const actions = target?.closest("article")?.querySelector(".actions");
			const box = scrollBox;
			if (!(actions instanceof HTMLElement) || !(box instanceof HTMLElement)) return;
			const row = actions.getBoundingClientRect();
			const view = box.getBoundingClientRect();
			if (row.bottom > view.bottom || row.top < view.top) {
				actions.scrollIntoView({ block: "nearest", behavior: "smooth" });
			}
		};
		// No triple-click handler: native paragraph selection finalizes
		// on the third mouseup, where onSelectEnd already locks it to the
		// message and summons the menu.
		// Selection text at the last mousedown: a mouseup that changed
		// nothing started on blank space, so a stale highlight is dropped
		// instead of re-summoning the menu.
		let downSel = "";
		const snapSelection = (): void => {
			downSel = window.getSelection()?.toString() ?? "";
		};
		/**
		 * A press that starts outside message text must not eat a live
		 * highlight: dragging in from the gutter would otherwise collapse
		 * the selection at press time, before mouseup ever sees it. Only
		 * dead chrome qualifies — the prompt, sidebars, and controls keep
		 * their native press behavior (clicks still fire everywhere;
		 * this only skips the selection reset).
		 */
		const preserveMessageHighlight = (event: MouseEvent): void => {
			if (event.button !== 0) return;
			const target = event.target instanceof Element ? event.target : null;
			if (!target?.closest("main") || target.closest(".rendered, .prompt")) return;
			const live = window.getSelection();
			const anchor =
				live && !live.isCollapsed
					? live.anchorNode instanceof Element
						? live.anchorNode
						: live.anchorNode?.parentElement
					: null;
			if (!anchor?.closest(".messages .rendered")) return;
			event.preventDefault();
		};
		/** Press point for the drag-vs-click read in onMouseUp below. */
		let downClient: { x: number; y: number } | null = null;
		const noteDownPoint = (event: MouseEvent): void => {
			downClient = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
		};
		// A drag that starts in message text never highlights its
		// neighbors: while the button is down, any selection escaping
		// the anchor article trims back live (mouseup's lock only fixed
		// it after the fact, flashing two messages blue mid-drag).
		let selectingInMessage = false;
		// A drag that starts off-chat (gutter, margins, off-screen)
		// never highlights above the cursor's current line: while the
		// button is down, an anchor end outside message text pins back
		// to the focus line's start on every selection change.
		let offChatDragArmed = false;
		const armMessageDrag = (event: MouseEvent): void => {
			const target = event.target instanceof Element ? event.target : null;
			selectingInMessage = event.button === 0 && !!target?.closest(".messages .rendered");
			offChatDragArmed = event.button === 0 && !target?.closest(".messages .rendered");
		};
		const trimMessageDrag = (): void => {
			if (selectingInMessage) {
				const live = window.getSelection();
				if (live) lockSelectionToMessage(live, articleOf);
				return;
			}
			clampOffChatDrag();
		};
		const clampOffChatDrag = (): void => {
			if (!offChatDragArmed) return;
			try {
				const live = window.getSelection();
				if (!live || live.isCollapsed || live.rangeCount === 0) return;
				const anchorNode = live.anchorNode;
				const focusNode = live.focusNode;
				if (!anchorNode || !focusNode) return;
				const anchorEl = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
				const focusEl = focusNode instanceof Element ? focusNode : focusNode.parentElement;
				if (!focusEl?.closest(".messages .rendered")) return;
				// Anchors in controls or the prompt are their own
				// gesture (editor selections, button presses) — never
				// an off-chat message drag.
				if (anchorEl?.closest(".messages .rendered, .cm-content, input, textarea")) return;
				// Only the upward side clamps: an anchor below the
				// cursor highlights below it, which is allowed.
				let anchorAbove: boolean;
				if (anchorNode === focusNode) anchorAbove = live.anchorOffset < live.focusOffset;
				else {
					anchorAbove = !!(anchorNode.compareDocumentPosition(focusNode) & Node.DOCUMENT_POSITION_FOLLOWING);
				}
				if (!anchorAbove) return;
				if (anchorNode instanceof Text && anchorNode === focusNode) {
					const text = anchorNode.textContent ?? "";
					const fixed = clampDragAnchorToFocusLine(text, live.anchorOffset, live.focusOffset);
					if (fixed !== live.anchorOffset) {
						live.setBaseAndExtent(anchorNode, fixed, focusNode, live.focusOffset);
					}
					return;
				}
				// Cross-node: the anchor sits in earlier (or foreign)
				// content — pin it to the cursor line's start inside
				// the focus node, so nothing above that line stays
				// highlighted.
				if (focusNode instanceof Text) {
					const text = focusNode.textContent ?? "";
					const start = lineStartOffset(text, live.focusOffset);
					live.setBaseAndExtent(focusNode, start, focusNode, live.focusOffset);
				}
			} catch {
				// Selection trimming is cosmetic: never break the drag.
			}
		};
		const onMouseUp = (event: MouseEvent) => {
			selectingInMessage = false;
			offChatDragArmed = false;
			// Compat mouseup trailing a touch-handled selection: the menu
			// is already up, and the staleness check below would clear it
			// as a no-change click (touchMenuAt lives with the touchend
			// listener above).
			if (Date.now() - touchMenuAt < 800) return;
			// Ignore clicks that start inside the prompt, popups, or buttons —
			// only freshly selected message text summons the menu.
			if (event.button === 2) return; // right-click never summons the menu (or audio)
			// Non-element targets (synthetic document/window events) carry no
			// selection UI — real mouse-ups always target an Element.
			const target = event.target instanceof Element ? event.target : null;
			if (openLangMenu) {
				if (!target?.closest(".lang-menu")) openLangMenu = null;
			}
			if (target?.closest(".cm-content, .sel-menu, .ann-dock, .review, .translate-panel, button, input, textarea")) {
				// Clicking away into the prompt or a control clears a dead
				// highlight's menu with it — but never the menu's own clicks:
				// the Annotate button's click fires after this mouseup (the
				// phone composer's docked twin included).
				if ((window.getSelection()?.toString() ?? "") === "" && !target?.closest(".sel-menu, .ann-dock")) {
					selMenu = null;
				}
				return;
			}
			const live = window.getSelection();
			const liveText = live?.toString() ?? "";
			// Clicks clear stale highlights; drags never do — a press in
			// the gutter that travels into the chat keeps the highlight
			// it started with (the press itself is preserved above).
			const dragged = downClient
				? Math.hypot(event.clientX - downClient.x, event.clientY - downClient.y) > 4
				: false;
			if (!dragged && liveText === downSel && (event.detail <= 1 || event.detail >= 4)) {
				// A plain click changed nothing: blank space, a collapsed
				// caret, or inside the old highlight (the engine collapses
				// that only after mouseup dispatches, so the stale text
				// still reads "selected" here — re-summoning off it is what
				// stranded the menu on a cleared highlight). Drop any stale
				// highlight and never re-summon. Multi-click sequences
				// (detail 2–3) keep the old path: their picks finalize
				// around these events.
				if (liveText !== "") live?.removeAllRanges();
				selMenu = null;
				return;
			}
			if (!dragged && !target?.closest(".rendered") && liveText !== "" && liveText === downSel) {
				live?.removeAllRanges();
				selMenu = null;
				return;
			}
			onSelectEnd(event, event.clientX);
		};
		// Right-click never starts audio: the desktop speak path that
		// lived here (selection reads aloud, word under cursor) is gone
		// by decision — speech starts only from explicit speak buttons.
		// Capture stays registered for the Android long-press branch
		// below; desktop falls through to the native context menu.
		const onContextMenu = (event: MouseEvent) => {
			const target = event.target as HTMLElement | null;
			// Android long-press fires contextmenu mid-hold, before
			// touchend: summon the menu off the live selection without
			// consuming the event, so the native callout (Copy) still
			// appears.
			if (androidUI && target?.closest(".messages .rendered")) {
				if (currentQuote()) {
					placeSelMenu(event.clientX);
					touchMenuAt = Date.now();
				}
			}
		};
		// Holding Option morphs the send button into "Add +" (stage).
		const onAlt = (event: KeyboardEvent) => {
			if (event.key === "Alt") altHeld = event.type === "keydown";
		};
		/**
		 * Escape keyup: a HOLD past the threshold exits fullscreen; a
		 * tap does nothing here (the keydown path above already
		 * dismissed menus/overlays exactly as today).
		 */
		const onEscapeUp = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			const held = isEscapeHold(escDownAt, Date.now());
			escDownAt = 0;
			if (held) {
				event.preventDefault();
				void exitFullscreenFromHold();
			}
		};
		const onBlur = () => {
			altHeld = false;
			escDownAt = 0;
			stopScrollHold();
		};
		// Coming back to the window lands you in the prompt (pill box when
		// annotating), so Tab continues from there. Never yank focus out of
		// a field that already holds it.
		const onWinFocus = () => {
			// Back from background: the reply was seen, drop its badge.
			clearStudyBadge();
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
		// Voice inventory arrives async (slow on phones): the first
		// getVoices() kicks the load, voiceschanged bumps the gates.
		try {
			if (typeof speechSynthesis !== "undefined") {
				speechSynthesis.getVoices();
				speechSynthesis.onvoiceschanged = () => {
					webVoiceVersion++;
				};
				// Already loaded (desktop): still re-render once so the
				// gates read the real inventory, not the first empty one.
				if (speechSynthesis.getVoices().length > 0) webVoiceVersion++;
			}
		} catch {
			// Speech stays gated off, as before.
		}
		window.addEventListener("focus", onWinFocus);
		// Soft-keyboard transitions resize the visual viewport without
		// ever touching the document, and old phone WebViews time
		// CodeMirror's own ResizeObserver unreliably around them — the
		// emptied composer can strand at zero height after send until
		// the next keystroke re-measures. A settled viewport re-measures
		// up front instead (typing would heal it anyway; this heals it
		// before the next keystroke).
		let viewportTimer: number | undefined;
		const onViewportResize = (): void => {
			if (viewportTimer !== undefined) window.clearTimeout(viewportTimer);
			viewportTimer = window.setTimeout(() => {
				viewportTimer = undefined;
				// Phone keyboard without resizes-content: the layout
				// viewport doesn't shrink, so the full-height flex
				// column (and the latest messages) slides under the
				// keyboard with no way to reach it. Pin .app to the
				// visual height while the keyboard is open, and expose
				// the overlap as --kb-height so the composer reflows
				// just above it. Modern Chrome tracks via the viewport
				// meta, so the heights agree and this stays inert — it
				// is the pre-108 fallback. Desktop and keyboard-closed
				// phones keep stylesheet height.
				if (androidUI && appEl && window.visualViewport) {
					const vv = window.visualViewport;
					const overlap = keyboardOverlapPx(window.innerHeight, vv.height, vv.offsetTop);
					if (isKeyboardOpen(window.innerHeight, vv.height, vv.offsetTop)) {
						appEl.style.height = `${vv.height}px`;
						appEl.style.setProperty("--kb-height", `${overlap}px`);
					} else {
						appEl.style.height = "";
						appEl.style.setProperty("--kb-height", "0px");
					}
				}
				editor?.remeasure();
			}, 250);
		};
		window.visualViewport?.addEventListener("resize", onViewportResize);
		window.visualViewport?.addEventListener("scroll", onViewportResize);
		void listenMenuActions();
		void wireDeepLinks();
		window.addEventListener("keydown", onKey, true);
		window.addEventListener("keydown", onAlt);
		window.addEventListener("keyup", onAlt);
		window.addEventListener("keyup", onEscapeUp);
		window.addEventListener("keyup", releaseScrollHold);
		window.addEventListener("blur", onBlur);
		window.addEventListener("focusin", onFocusIn);
		window.addEventListener("mousedown", onBadgePress, true);
		window.addEventListener("mousedown", preserveMessageHighlight, true);
		window.addEventListener("mousedown", snapSelection, true);
		window.addEventListener("mousedown", noteDownPoint, true);
		window.addEventListener("mousedown", armMessageDrag, true);
		document.addEventListener("selectionchange", trimMessageDrag);
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
		window.addEventListener("contextmenu", onContextMenu, true);
		return () => {
			window.visualViewport?.removeEventListener("resize", onViewportResize);
			window.visualViewport?.removeEventListener("scroll", onViewportResize);
			if (viewportTimer !== undefined) window.clearTimeout(viewportTimer);
			window.removeEventListener("focus", onWinFocus);
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("keydown", onAlt);
			window.removeEventListener("keyup", onAlt);
			window.removeEventListener("keyup", onEscapeUp);
		window.removeEventListener("keyup", releaseScrollHold);
			window.removeEventListener("blur", onBlur);
			window.removeEventListener("focusin", onFocusIn);
			window.removeEventListener("mousedown", onBadgePress, true);
			window.removeEventListener("mousedown", preserveMessageHighlight, true);
			window.removeEventListener("mousedown", snapSelection, true);
			window.removeEventListener("mousedown", noteDownPoint, true);
			window.removeEventListener("mousedown", armMessageDrag, true);
			document.removeEventListener("selectionchange", trimMessageDrag);
			window.removeEventListener("scroll", onFadeScroll, true);
			window.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("dblclick", onDoubleClick);
			window.removeEventListener("contextmenu", onContextMenu, true);
			window.clearTimeout(scrollIdleTimer);
			stopSpeaking();
			stopNative();
			releaseStudyWake();
			stopDictation?.();
			editor?.destroy();
			editor = null;
		};
	});
</script>

<svelte:head>
	<title>Ccez LLM</title>
</svelte:head>

<div
	class="app"
	bind:this={appEl}
	data-focus-mode={focusMode}
	data-shell={tauriBackendAvailable() ? "tauri" : "browser"}
	data-android={androidUI || null}
	data-ios={iosUI || null}
	style="--font-scale: {androidUI ? Math.min(4, settings.fontScale) : settings.fontScale}; --chat-width: {androidUI ? 46 : (settings.chatWidth ?? 36)}"
	data-mac={isMac && !androidUI || null}
>
	<aside class:collapsed={settings.sidebarCollapsed} inert={settings.sidebarCollapsed} data-fade-scroll>
		<div class="side-head" data-tauri-drag-region aria-hidden="true" onmousedown={dragWindow} ondblclick={zoomWindow}>
		</div>
		<!-- Sidebar search: a swipe left-to-right opens the list on this
		box; tapping it focuses with the keyboard up (a real input, never
		auto-focused on open, so the keyboard only comes on tap). -->
		<div class="side-search-wrap">
			<input
				type="search"
				class="side-search"
				bind:this={sideSearchEl}
				bind:value={sideSearch}
				placeholder="Search chats"
				aria-label="Search chats"
				inputmode="search"
				enterkeyhint="search"
				autocomplete="off"
				onclick={() => focusSideSearch()}
			/>
			{#if sideSearch}
				<button
					type="button"
					class="side-search-clear"
					aria-label="Clear chat search"
					onclick={() => {
						sideSearch = "";
						focusSideSearch();
					}}>×</button
				>
			{/if}
		</div>
		<ul onmouseleave={() => (previewChatId = null)}>
			{#each sideVisibleChats() as item (item.id)}
				<li>
					<button
						type="button"
						class="side-chat"
						class:active={item.id === chatState.activeChatId}
						onmouseenter={() => (previewChatId = item.id)}
						onmouseleave={() => {
							if (previewChatId === item.id) previewChatId = null;
						}}
						onclick={() => {
							previewChatId = null;
							sideIdx = chatState.chats.findIndex((c) => c.id === item.id);
							transitionToChat(item.id);
						}}
					>
						{chatLabel(item.createdAt, visibleMessageCount(chatState, item))}
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
			title={tip(isMac ? "New chat (⌘N or ⇧⌘N)" : "New chat (Ctrl+N or Ctrl+Shift+N)", "New chat")}
			aria-label="New chat"
			onclick={() => doNewChat()}
		>
			+
		</button>
	</aside>

	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions, a11y_no_noninteractive_element_interactions -->
	<!-- Click-off closes the settings panel (keyboard users get Esc and ⌘,). -->
	<main
		class:empty={viewChat.messages.length === 0}
		class:hide-messages={settings.hideMessages}
		class:hide-buttons={settings.hideButtons}
		class:overlay-actions={settings.overlayActions}
		class:plain-user={!settings.ownBubble}
		class:hover-user={settings.hoverUserActions}
		class:hover-assistant={settings.hoverAssistantActions}
		class:scale-actions={settings.scaleActionsWithFont}
		class:alt={altHeld}
		onpointerdown={noteMainDown}
		onclick={closeSettingsFromMain}
	>
		{#if toast}
			<button type="button" class="toast" title="Click to copy" aria-live="polite" transition:fade={{ duration: 160 }} onclick={copyToast}>{toast}</button>
		{/if}
		<!-- Slim title strip: app name plus the reply-language pill's
		anchor (token count lives in the settings panel now, and
		Settings itself moved to the menu bar). Double-click zooms. -->
		<header role="toolbar" aria-label="App" tabindex="-1" onmousedown={dragWindow} ondblclick={zoomWindow}>
			<span class="app-title">Ccez Studio</span>
			<span class="tokens-wrap">
				{#if activeReplyLang}
					<span class="lang-chip-float" transition:fade={{ duration: 90 }}>
						<button
							type="button"
							class="lang-chip"
							title="{activeReplyLang.name} — click to clear"
							aria-label="Reply language {activeReplyLang.name} — click to clear"
							onclick={clearReplyLang}
						>
							<span aria-hidden="true">{activeReplyLang.badge}</span> <ActionIcon kind="close" />
						</button>
					</span>
				{/if}
			</span>
			<!-- Browser side panel: Cmd+T docks a single-tab browser
			right in the same window. Shortcut-only on purpose (no
			toggle button): the combo opens from anywhere, including
			the prompt, and lands focus in the address bar. -->
			<span class="sideview-bar">
				{#if sideviewOpen}
					<form
						class="browser-address"
						onsubmit={(event) => {
							event.preventDefault();
							void submitBrowserAddress();
						}}
					>
						<input
							bind:this={browserInputEl}
							type="text"
							aria-label="Browser address"
							placeholder="Search or address"
							autocomplete="off"
							autocapitalize="off"
							spellcheck={false}
							bind:value={browserAddress}
						/>
						<button type="submit" aria-label="Go to address">Go</button>
					</form>
				{/if}
				<button
					type="button"
					class="export-btn"
					title="Export chat as Markdown"
					aria-label="Export chat as Markdown"
					onclick={() => void exportCurrentChat()}
				>
					Export
				</button>
			</span>
		</header>

		{#if points.length > 3 && !settingsOpen && !previewing}
			<nav aria-label="Waypoints">
				{#if wpOpen}
					<!-- Sheet backdrop: a press outside the sheet (which is
					outside .wp-wrap) also trips the pinned-menu closer. -->
					<button type="button" class="wp-veil" tabindex={-1} aria-label="Close message list" transition:fade={{ duration: 150 }} onclick={() => (wpOpen = false)}></button>
				{/if}
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
					<div
						class="wp-menu"
						role="menu"
						tabindex={-1}
						aria-label="Waypoints"
						data-fade-scroll
						ontouchstart={(e) => (wpTouchY = e.touches[0]?.clientY ?? null)}
						ontouchend={(e) => {
							const start = wpTouchY;
							wpTouchY = null;
							const end = e.changedTouches[0]?.clientY;
							if (start == null || end == null) return;
							const menu = e.currentTarget as HTMLElement;
							if (menu.scrollTop <= 0 && end - start > 56) wpOpen = false;
						}}
					>
						<div class="wp-sheet-head">
							<span>Jump to a message</span>
							<button type="button" aria-label="Close message list" onclick={() => (wpOpen = false)}>×</button>
						</div>
						{#each points as index, n (index)}
							{@const target = chat.messages[index]}
							<button
								type="button"
								role="menuitem"
								aria-current={n === wpPos - 1}
								title={waypointLabel(target?.content ?? "", 200)}
								onclick={() => {
									jumpTo(index);
									wpOpen = false;
								}}
							>
								<span class="wp-dot" data-role={target?.role ?? "user"} aria-hidden="true"></span>
								{waypointLabel(target?.content ?? "") || `Message ${index + 1}`}
							</button>
						{/each}
					</div>
				</div>
			</nav>
		{/if}

		<div
			class="messages"
			class:step-newer={androidUI && chatStepDir === 1}
			class:step-older={androidUI && chatStepDir === -1}
			bind:this={scrollBox}
			onscroll={noteScrolling}
			ontouchstart={freezeScroll}
			ontouchend={releaseScroll}
			ontouchcancel={releaseScroll}
			ondblclick={gutterDoubleClick}
			onanimationend={(e) => {
				if (e.target === e.currentTarget) chatStepDir = null;
			}}
		>
			{#if viewChat.messages.length === 0}
				<div class="empty-state">
					<h1 class="hero">What can I do for you?</h1>
					{#if useMock}
						<p class="mock-note"><strong>Mock provider active.</strong></p>
					{/if}
				</div>
			{/if}
			{#each viewChat.messages as msg, i (msg.id)}
				{@const sentRefs = annRefsFor(msg.content)}
				{@const refsOnly = sentRefs ? sentRefs.text.trim() === "" : false}
				{@const isFolded = foldedIds.has(msg.id)}
				{@const script = detectScript(sentRefs ? sentRefs.text : msg.content)}
				{@const aidId = script ? MODEL_AID_FOR_SCRIPT[script] : null}
				{@const localKinds = offeredLocalAids(sentRefs ? sentRefs.text : msg.content)}
				{@const streamingThis =
					chatState.sending &&
					viewChat.id === chatState.sendingChatId &&
					msg.role === "assistant" &&
					i === viewChat.messages.length - 1}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
				<!-- Option-click is mouse-only by design; keyboard users get the Fold button below. -->
				<article
					id="msg-{i}"
					class:user={msg.role === "user"}
					class:assistant={msg.role === "assistant"}
					class:selected={focusMode === "scroll" && selectedIdx === i}
					class:speaking={speakingId === msg.id}
					class:speaking-sel={speakingSelection === msg.id}
					class:aid-loading={aidBusy.has(msg.id) || vocalizing.has(msg.id)}
					data-actions-open={shownActionsId === msg.id}
					data-actions-above={actionsAbove || null}
					onclick={(e) => {
						if (e.altKey) toggleFold(msg.id);
						toggleMessageActions(msg.id, e);
					}}
					onmouseenter={() => (hoveredIdx = i)}
					onmouseleave={(event) => onArticleLeave(event, msg, i)}
				>
					{#if msg.attachments && msg.attachments.length > 0}
					<!-- Sent-message attachment chips: above the message
					and before (left of) the annotation marker, so files
					sent with the turn read as its head, not its tail. -->
					<div class="sent-files">
						{#each msg.attachments as att (att.id)}
							<span class="sent-chip" title="{att.name} · ~{att.tokens} tokens">
								<ActionIcon kind="attach" /> {att.name}
							</span>
						{/each}
					</div>
				{/if}
				{#if sentRefs}
						<!-- Baked annotation block, collapsed above the
						message: the count stays visible like the composer
						pill; hovering (or tabbing to) the number itself
						reveals the saved quotes. Provider context is
						unaffected — only the display is redacted. A
						refs-only message always shows the pill: unfolded,
						its body is just an em-dash (see REFS_ONLY_BODY). -->
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
										<button
											type="button"
											class="ann-refs-copy"
											title="Copy annotation"
											aria-label="Copy annotation {ref.n}"
											onclick={() => copyAnnotation(ref.quote, ref.comment)}
										>
											<ActionIcon kind="copy" />
										</button>
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
							onBadgeClick={openBadgeClick}
							onToast={flashToast}
							onFoldToggle={(index: number) => togglePasteFold(msg, index)}
							textOverride={aidedTextFor(msg)}
							contentOverride={sentRefs ? (refsOnly && !isFolded ? REFS_ONLY_BODY : sentRefs.text) : null}
							aidPreview={aidPeek?.id === msg.id && !aidPin.has(msg.id)}
							aidKinds={localAidsOverrideFor(msg)}
							aidPreferred={preferredLocalAid(activeReplyCode)}
							onAidLoadingChange={(loading: boolean) => setAidBusy(msg.id, loading)}
							onAidError={(_id: ChatMsgId, reason?: string) => aidFailed(msg.id, reason)}
						/>
					</div>
					{#if !(streamingThis && msg.content.trim() === "") && !previewing}
					<div
						class="actions"
						role="group"
						aria-label="Message actions"
						onmouseleave={releaseRowFocus}
						onpointerdown={holdActionsOpen}
						onpointerup={releaseActionsHold}
						onpointercancel={releaseActionsHold}
					>
						<button
							type="button"
							class="icon-btn"
							class:folded={isFolded}
							data-tip={tip(isMac ? "Fold this message (F or Option-click)" : "Fold this message (F or Alt-click)", "Fold this message")}
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
							data-tip={tip(isMac ? "Delete this message (⌘D)" : "Delete this message", "Delete this message")}
							aria-label={tip(isMac ? "Delete this message (⌘D)" : "Delete this message", "Delete this message")}
							onclick={() => deleteMessage(chatState, i)}
						>
							<ActionIcon kind="delete" />
						</button>
						<button
							type="button"
							class="icon-btn"
							class:active={speakingId === msg.id}
							data-tip={messageSpeakable(msg) ? speakTitle(msg) : "No voice for this language"}
							aria-label={messageSpeakable(msg) ? speakTitle(msg) : "No voice for this language"}
							aria-pressed={speakingId === msg.id}
							disabled={speakingId !== msg.id && !messageSpeakable(msg)}
							onclick={() => {
								if (speakingId === msg.id) stopVoice();
								else void speakReply(msg);
							}}
						>
							<ActionIcon kind="speak" />
						</button>
						{#if msg.role === "assistant" && !streamingThis}
							<!-- Reading aids live here, right of speak: hover
							previews, click pins (show original unpins). Model
							and local aids sit side by side on mixed messages;
							a model pin composes with local pins (the model revert drops
						only the vocalized text), while furigana and pinyin pin
						independently. -->
							{#if aidId || localKinds.length > 0}
								{#if aidId}
									{#if aidModelPin.has(msg.id)}
										<button
											type="button"
											data-tip={MODEL_AIDS[aidId]?.revertTip ?? "Show original"}
											onclick={() => unpinModelAid(msg)}
										>
											{MODEL_AIDS[aidId]?.revert ?? "show original"}
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
								{/if}
								{#if localKinds.length > 0}
								<!-- One button per aid, pinned independently: each
								swaps in place to its own show-original, so the
								row never shuffles when the other pins. -->
								{#each localKinds as localKind (localKind)}
									{@const showOriginal = LOCAL_AID_SHOW_ORIGINAL[localKind]}
									{#if pinnedKinds(msg.id).includes(localKind)}
											{@const furiganaBusy = localKind === "furigana" && aidBusy.has(msg.id)}
											<button
												type="button"
												data-tip={furiganaBusy ? `${LOCAL_AID_BUTTON[localKind]}...` : showOriginal}
												onclick={() => unpinLocalAid(msg, localKind)}
											>
												{showOriginal}{#if furiganaBusy}<span class="tdots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>{/if}
											</button>
									{:else}
										<button
											type="button"
											data-tip={LOCAL_AID_ADD_TITLE[localKind]}
											onmouseenter={() => peekAid(msg, null, localKind)}
											onmouseleave={() => unpeekAid(msg)}
											onclick={() => pinLocalAid(msg, localKind)}
										>
											{LOCAL_AID_BUTTON[localKind]}{#if localKind === "furigana" && aidBusy.has(msg.id)}<span class="tdots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>{/if}
										</button>
									{/if}
								{/each}
								{/if}
							{/if}
						{/if}
						{#if msg.role === "user"}
							<button
								type="button"
								class="icon-btn"
								data-tip="Edit"
								aria-label="Edit this message"
								onclick={() => editMessage(i)}
							>
								<ActionIcon kind="pencil" />
							</button>
							<button
								type="button"
								class="icon-btn"
								data-tip="Rerun"
								aria-label="Rerun"
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
			{#if isSending(chatState)}
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
						openSettingsPanel();
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
						openSettingsPanel();
						pulseCursor();
					}}
					>
						open Settings</button
					>.
				{/if}
			</p>
		{/if}

		{#if attachments.length > 0 || attachError}
			<ul class="attachments" class:composer-idle={promptIdle}>
				{#each attachments as att (att.id)}
					<li class:card={att.kind === "image" && !!att.dataUrl}>
						{#if att.kind === "image" && att.dataUrl}
							<button
								type="button"
								class="thumb"
								title="Toggle preview"
								aria-label="Toggle image preview"
								aria-pressed={previewId === att.id}
								onclick={() => (previewId = previewId === att.id ? null : att.id)}
							>
								<img src={att.dataUrl} alt="" />
							</button>
						{:else}
							<span class="file-kind" aria-hidden="true">FILE</span>
						{/if}
						<span class="name" title="{att.name} · ~{att.tokens} tokens">{att.name}</span>
						<span class="tok">~{att.tokens}</span>
						<button
							type="button"
							class="card-btn"
							aria-label="Copy attachment"
							title="Copy attachment"
							onclick={() => copyAttachment(att)}
						>
							<ActionIcon kind="copy" />
						</button>
						{#if att.kind === "image" && att.dataUrl}
							<button
								type="button"
								class="ocr-btn"
								aria-label="Recognize text in image"
								title="Recognize text in image"
								disabled={ocrBusyId === att.id}
								onclick={() => void recognizeAttachment(att)}
							>
								{ocrBusyId === att.id ? "…" : "OCR"}
							</button>
						{/if}
						<button
							type="button"
							class="card-btn"
							aria-label="Remove attachment"
							title="Remove attachment"
							onclick={() => removeAttachment(att.id)}
						>
							<ActionIcon kind="close" />
						</button>
					</li>
				{/each}
			</ul>
			{#if previewId}
				{#each attachments.filter((a) => a.id === previewId) as att (att.id)}
					{#if att.dataUrl}
						<img class="preview" class:composer-idle={promptIdle} src={att.dataUrl} alt={att.name} />
					{/if}
				{/each}
			{/if}
			{#if attachError}
				<p class="error attach-error" class:composer-idle={promptIdle} role="alert">{attachError}</p>
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
			class:has-mic={canMic && settings.micEnabled}
			class:prompt-hidden={!!annPop && androidUI && !iosUI}
			class:prompt-idle={promptIdle}
			bind:this={promptEl}
			onclick={focusPromptFloor}
			ondragover={(e) => e.preventDefault()}
			ondrop={(e) => {
				e.preventDefault();
				const files = dropFilesFromDataTransfer(e.dataTransfer);
				if (files.length > 0) void addFiles(files);
			}}
		>
			<div class="prompt-tools">
				{#if points.length > 3 && !(selMenu && androidUI)}
					<!-- Touch jump-to-message trigger: an icon in the tools
					cluster, styled like attach/mic (desktop keeps ticks).
					On phones the selection dock takes this slot instead —
					both side by side crowd the placeholder. -->
					<button
						type="button"
						class="wp-jump"
						title="Jump to a message"
						aria-label="Jump to a message"
						aria-haspopup="true"
						aria-expanded={wpOpen}
						onclick={() => (wpOpen = !wpOpen)}
					>
						<ActionIcon kind="jump" />
					</button>
				{/if}
				{#if androidUI && selMenu && !previewing}
					<!-- Phone selection dock: the highlight menu lives in the
					composer tools, not floating over the text (the native
					callout owns that space on both phones). Same handlers
					as the desktop floating menu it replaces — and the same
					click-away exemption in onMouseUp, or the tap collapses
					the highlight and clears the menu before onclick fires.
					Inspect docks beside Annotate for single Han characters
					with the setting on. -->
					<button
						type="button"
						class="ann-dock"
						aria-label="Annotate selection"
						transition:fade={{ duration: 150 }}
						onmousedown={noteMenuPress}
						ontouchstart={noteMenuBtnTouch}
						ontouchend={annotateTouch}
						onclick={annotate}
					>Annotate</button>
					{#if shouldShowInspect(selMenu.quote, settings.inspectEnabled)}
						<button
							type="button"
							class="ann-dock"
							aria-label="Inspect character"
							transition:fade={{ duration: 150 }}
							onmousedown={noteMenuPress}
							ontouchstart={noteMenuBtnTouch}
							ontouchend={inspectTouch}
							onclick={openInspect}
						>Inspect</button>
					{/if}
				{/if}
				{#if annotations.length > 0}
					<div class="ann-wrap" class:pinned={reviewOpen}>
						<button
							type="button"
							class="ann-pill"
							bind:this={annPill}
							title="Review annotations"
							aria-label={annotations.length === 1 ? "1 annotation" : `${annotations.length} annotations`}
							aria-expanded={reviewOpen}
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
											class="review-copy"
											title="Copy annotation"
											aria-label="Copy annotation {n + 1}"
											onclick={() => copyAnnotation(ann.quote, ann.comment)}
										>
											<ActionIcon kind="copy" />
										</button>
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
											<textarea rows="2" bind:this={editBox} bind:value={editDraft} placeholder="Add an optional comment…"
												aria-label="Edit annotation note. Enter saves, Shift+Enter adds a line, Escape cancels."
												onkeydown={(e) => {
													const action = reviewEditKey(e.key, e.shiftKey);
													if (action === "save") {
														e.preventDefault();
														saveEdit(ann.id);
													} else if (action === "cancel") {
														e.preventDefault();
														editingId = null;
														highlightAnnId = null;
														focusPill();
													}
												}}
											></textarea>
										</label>
										<div class="review-edit-actions">
											<button type="button" onclick={() => saveEdit(ann.id)}>Save</button>
											<button
												type="button"
												onclick={() => {
													editingId = null;
													highlightAnnId = null;
													// Cancel unmounts the focused textarea:
													// park focus on the pill or the
													// overlay drops on touch.
													focusPill();
												}}>Cancel</button
											>
										</div>
									{:else}
										<div class="review-head">
											<span class="review-label">note:</span>
											<span class="review-comment">{ann.comment || "—"}</span>
											<button
												type="button"
												class="review-pencil"
												title="Edit comment"
												aria-label="Edit comment for annotation {n + 1}"
												onclick={() => {
													editingId = ann.id;
													editDraft = ann.comment;
													// The pencil unmounts with the edit
													// box: move focus into the new
													// textarea or it drops to <body>
													// and the overlay closes on touch.
													void tick().then(() =>
														editBox?.focus({ preventScroll: true })
													);
												}}
											>
												<ActionIcon kind="pencil" />
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
				{#if androidUI && clipboardReadAvailable()}
					<!-- Touch paste-images: no Ctrl+V on a phone, so the
					Async Clipboard feeds the same attachments path. -->
					<button
						type="button"
						class="paste-btn"
						title="Paste images from the clipboard"
						aria-label="Paste images from the clipboard"
						disabled={pasting}
						onclick={() => void pasteImagesFromClipboard()}
					>
						<ActionIcon kind="paste" />
					</button>
				{/if}
				{#if screenshotCaptureAvailable()}
					<!-- Screenshot-to-chat: one screen frame into the
					attachments path. Hidden where getDisplayMedia is
					missing (plain contexts without capture support). -->
					<button
						type="button"
						class="shot-btn"
						title="Capture a screenshot into the chat"
						aria-label="Capture a screenshot into the chat"
						disabled={screenshotting}
						onclick={() => void captureScreenshot()}
					>
						Shot
					</button>
				{/if}
				{#if canMic && settings.micEnabled}
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
					class:on={voiceOn()}
					title={speakingId !== null ? "Stop reading aloud" : tip(`Toggle voice readback (Ctrl+${altm}+S)`, "Toggle voice readback")}
					aria-label={speakingId !== null ? "Stop reading aloud" : "Toggle voice readback"}
					aria-pressed={voiceOn()}
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
				title={altHeld ? `Stage (${altm}+Enter)` : "Send (Enter)"}
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
			<!-- Top notice, not the bottom banner: speech errors arrive
			while the eyes are on the message, and a tap dismisses. -->
			<button type="button" class="voice-error" title="Dismiss" transition:fade={{ duration: 160 }} onclick={() => setVoiceError(null)}>
				<span role="alert">{voiceError}</span>
			</button>
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

	{#if sideviewOpen && sideviewFallback}
		<!-- No Tauri shell here (plain browser dev, e2e): there is no
		second-OS-webview host, so the panel degrades to a docked
		strip with an external link instead of crashing. The link
		follows the same address-bar resolve as the native tab. -->
		<aside
			class="sideview-fallback"
			aria-label="Browser panel"
			style="width: {Math.round(settings.sideviewWidthPx)}px"
		>
			<div
				class="browser-resize"
				aria-hidden="true"
				onpointerdown={(event) => {
					(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
					sideviewDrag = { startX: event.clientX, startW: settings.sideviewWidthPx };
				}}
				onpointermove={(event) => {
					if (sideviewDrag) dragSideviewTo(event.clientX);
				}}
				onpointerup={() => {
					if (sideviewDrag) {
						sideviewDrag = null;
						saveSettingsNow();
					}
				}}
				onpointercancel={() => {
					sideviewDrag = null;
				}}
			></div>
			<div class="sideview-fallback-head">
				<strong>Browser</strong>
				<button
					type="button"
					aria-label="Close browser panel"
					title="Close (Esc)"
					onclick={() => void setSideviewOpen(false)}
				>
					×
				</button>
			</div>
			<p>The browser panel needs the desktop app for its second webview. Here it stays a link.</p>
			{#if sideviewError}
				<p class="browser-error">{sideviewError}</p>
			{/if}
			<a href={sideviewUrl} target="_blank" rel="external noopener noreferrer">
				Open {browserAddress.trim() ? sideviewUrl : "browser home"} in a browser tab
			</a>
		</aside>
	{/if}

	{#if selMenu && !previewing && !androidUI}
		<div
			class="sel-menu"
			style="left: {selMenu.x}px; top: {selMenu.y}px"
			role="menu"
			tabindex="-1"
			transition:fade={{ duration: 150 }}
			onmousedown={noteMenuPress}
			ontouchstart={noteMenuPress}
		>
			<!-- Desktop only: Annotate floats above the highlight while
			the OS bubble keeps its own slot. Phones dock it in the
			composer instead (the native callout owns the text space).
			Copy and Read Aloud live on the message action rows
			instead of doubling here. Inspect joins Annotate only for
			a single kanji/hanzi highlight with the setting on. -->
			<button
				type="button"
				onclick={annotate}
				ontouchstart={noteMenuBtnTouch}
				ontouchend={annotateTouch}
			>Annotate</button>
			{#if shouldShowInspect(selMenu.quote, settings.inspectEnabled)}
				<button
					type="button"
					aria-label="Inspect character"
					onmousedown={noteMenuPress}
					ontouchstart={noteMenuBtnTouch}
					ontouchend={inspectTouch}
					onclick={openInspect}
				>Inspect</button>
			{/if}
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
				{#if canMic && settings.micEnabled}
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
				{#if canMic && settings.micEnabled}
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
			onToast={flashToast}
			onClose={() => {
			settingsOpen = false;
			pulseCursor();
		}}
			onShortcuts={() => (shortcutsOpen = true)}
			tokensLabel="{formatTokens(split.prompt)} in / {formatTokens(split.completion)} out"
			tokensTitle="{total} tokens total this chat"
			androidUI={androidUI}
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
					<h2 id="shortcuts-heading">{androidUI ? "Touch gestures" : "Keyboard shortcuts"}</h2>
					<button
						type="button"
						aria-label="Close shortcuts"
						title={tip(isMac ? "Close (⇧⌘/)" : "Close (Ctrl+Shift+/)", "Close")}
						onclick={() => (shortcutsOpen = false)}
					>
						×
					</button>
				</div>
				{#if androidUI}
					<!-- Android milestone: key chords don't exist on a phone,
					so the same modal teaches the touch equivalents. -->
					<dl class="keys">
						<div><dt>Chats list</dt><dd>Swipe right from the left edge or two-finger double-tap</dd></div>
					<div><dt>Newer / older chat</dt><dd>Two-finger swipe right / left</dd></div>
					<div><dt>Delete current chat</dt><dd>Double three-finger tap</dd></div>
						<div><dt>Annotate</dt><dd>Select text and tap Annotate in the prompt</dd></div>
						<div><dt>Message buttons</dt><dd>Tap a message</dd></div>
						<div><dt>Fold a message</dt><dd>Swipe right on it</dd></div>
					</dl>
				{:else}
				<dl class="keys">
					<div><dt>New line</dt><dd>Shift+Enter</dd></div>
					<div><dt>Stage message</dt><dd>{altm}+Enter</dd></div>
					<div><dt>Shortcuts show/hide</dt><dd>{isMac ? "⇧⌘/" : "Ctrl+Shift+/"}</dd></div>
					<div><dt>Switch model / key</dt><dd>Ctrl+{altm}+← / →</dd></div>
					<div><dt>Thinking level</dt><dd>Ctrl+{altm}+↓ / ↑ (cycles levels)</dd></div>
					<div><dt>Scroll messages</dt><dd>J / K · gg top · G bottom · Ctrl+U / Ctrl+D skip</dd></div>
					<div><dt>Scroll chat (nothing selected)</dt><dd>J / K · D / U fast · gg top · G bottom · z / Z hovered top / bottom</dd></div>
					<div><dt>Exit fullscreen</dt><dd>Hold Esc (a tap still closes menus)</dd></div>
					<div><dt>Chat list</dt><dd>{isMac ? "⌘B" : "Ctrl+B"}, then J / K · Space or L enters its prompt</dd></div>
					<div><dt>Search chats</dt><dd>{isMac ? "⌘P" : "Ctrl+P"}</dd></div>
					<div><dt>Newer / older chat</dt><dd>{isMac ? "⇧⌘J / ⇧⌘K" : "Ctrl+Shift+J / Ctrl+Shift+K"} (J mints one past the newest)</dd></div>
					<div><dt>Voice readback on/off</dt><dd>Ctrl+{altm}+S</dd></div>
					<div><dt>Speak hovered word</dt><dd>Right click word</dd></div>
					<div><dt>Speak highlight</dt><dd>Select text, then right click</dd></div>
					<div><dt>Thoughts show/hide</dt><dd>Ctrl+O</dd></div>
					<div><dt>Translate selection</dt><dd>{isMac ? "⌘T" : "Ctrl+T"} over message text (to English, feeds annotation)</dd></div>
					<div><dt>Browser side panel</dt><dd>{isMac ? "⌘T" : "Ctrl+T"} anywhere (address bar takes focus), Esc closes (one tab)</dd></div>
					<div><dt>Stop voice / close menus</dt><dd>Esc (outside the prompt)</dd></div>
					<!-- ⌘D is meta-only (Ctrl+D skips in scroll mode), so Windows names Delete alone. -->
					<div><dt>Delete a message</dt><dd>{isMac ? "Hover the message, then ⌘D or Delete" : "Hover the message, then Delete"}</dd></div>
					<div><dt>Fold / unfold message</dt><dd>Hover the message, then F or {isMac ? "Option" : "Alt"}-click</dd></div>
					<div><dt>Rerun a prompt</dt><dd>Rerun button (deletes everything after; Branch keeps it)</dd></div>
					<div><dt>Reply language</dt><dd>{isMac ? "⌘1…⌘0" : "Ctrl+1…Ctrl+0"} (repeat the key to clear)</dd></div>
					<div><dt>Delete this chat</dt><dd>{isMac ? "⇧⌘Delete" : "Ctrl+Shift+Delete"}</dd></div>
					<div><dt>Delete every chat</dt><dd>{isMac ? "⌥⇧⌘Delete" : "Ctrl+Shift+Alt+Delete"}</dd></div>
					<div><dt>Cut / delete hovered message</dt><dd>X cuts (copies first) · Delete deletes</dd></div>
					<div><dt>Text size up / down</dt><dd>{mod}+ / {mod}−</dd></div>
					<div><dt>Chat width + / −</dt><dd>⇧{mod}+ / ⇧{mod}−</dd></div>
				</dl>
				{/if}
			</div>
		</div>
	{/if}

	{#if searchOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<!-- Command palette: full-text search across chats/annotations. -->
		<div
			class="modal-veil"
			onclick={(e) => {
				if (e.target === e.currentTarget) closeSearch();
			}}
		>
			<div class="modal search-palette" role="dialog" aria-modal="true" aria-label="Search chats">
				<div class="modal-head">
					<input
						type="search"
						class="search-input"
						bind:this={searchInputEl}
						bind:value={searchQuery}
						oninput={runSearchQuery}
						placeholder="Search chats and annotations"
						aria-label="Search chats and annotations"
						inputmode="search"
						enterkeyhint="search"
						autocomplete="off"
						onkeydown={(e) => {
							if (e.key === "ArrowDown") {
								e.preventDefault();
								moveSearchCursor(1);
							} else if (e.key === "ArrowUp") {
								e.preventDefault();
								moveSearchCursor(-1);
							} else if (e.key === "Enter") {
								e.preventDefault();
								const hit = searchHits[searchCursor];
								if (hit) enterSearchHit(hit);
							}
						}}
					/>
					<button type="button" aria-label="Close search" title="Close (Esc)" onclick={closeSearch}>
						×
					</button>
				</div>
				<div class="search-results" data-fade-scroll role="listbox" aria-label="Search results">
					{#if searchBusy}
						<p class="search-status" role="status">Searching…</p>
					{:else if searchQuery.trim() && searchHits.length === 0}
						<p class="search-status">No matches.</p>
					{:else}
						{#each searchHits as hit, n (hit.doc.chatId + (hit.doc.msgId ?? "") + hit.doc.kind)}
							<button
								type="button"
								role="option"
								aria-selected={n === searchCursor}
								class="search-hit"
								class:cursor={n === searchCursor}
								onmouseenter={() => (searchCursor = n)}
								onclick={() => enterSearchHit(hit)}
							>
								<span class="search-kind">{hit.doc.kind}</span>
								<span class="search-snippet">{hit.snippet}</span>
							</button>
						{/each}
					{/if}
				</div>
			</div>
		</div>
	{/if}
	{#if inspectChar && inspectData}
		<!-- Character Inspect overlay: same modal-veil/modal pattern as
		the shortcuts overlay. Radicals come from the offline curated
		table (radicals.ts); count + definition from the compact offline
		table (inspect.ts). The stroke preview is schematic (stepped by
		stroke count) until per-character vector data lands. -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<!-- Backdrop click only; keyboard users get Esc and the × button. -->
		<div
			class="modal-veil"
			onclick={(e) => {
				if (e.target === e.currentTarget) inspectChar = null;
			}}
		>
			<div class="modal inspect-modal" role="dialog" aria-modal="true" aria-labelledby="inspect-heading" data-fade-scroll>
				<div class="modal-head">
					<h2 id="inspect-heading">Inspect <span lang="ja">{inspectData.char}</span></h2>
					<button
						type="button"
						aria-label="Close character inspect"
						title="Close (Esc)"
						onclick={() => (inspectChar = null)}
					>
						×
					</button>
				</div>
				<div class="inspect-body">
					<div class="inspect-char" lang="ja" aria-hidden="true">{inspectData.char}</div>
					<div class="inspect-facts">
						{#if inspectData.components.length > 0}
							<p><strong>Radicals:</strong> {inspectData.components.join(" + ")}</p>
						{:else}
							<p class="note">Radical breakdown unavailable offline for this character.</p>
						{/if}
						{#if inspectData.strokeCount !== null}
							<p><strong>Strokes:</strong> {inspectData.strokeCount}</p>
						{:else}
							<p class="note">Stroke count unavailable offline for this character.</p>
						{/if}
						{#if inspectData.definition !== null}
							<p><strong>Definition:</strong> {inspectData.definition}</p>
						{:else}
							<p class="note">Unihan definition unavailable offline for this character.</p>
						{/if}
					</div>
				</div>
				{#if inspectData.strokeCount !== null}
					<div class="inspect-stroke" aria-label="Schematic stroke preview">
						<div class="inspect-step" aria-live="polite">
							Stroke {Math.min(inspectStroke, inspectData.strokeCount)} of {inspectData.strokeCount}
						</div>
						<div class="inspect-bar" aria-hidden="true">
							<div
								class="inspect-fill"
								style="width: {(Math.min(inspectStroke, inspectData.strokeCount) / inspectData.strokeCount) * 100}%"
							></div>
						</div>
						<p class="note">Schematic preview — full stroke-order animation needs vector path data (follow-up).</p>
					</div>
				{/if}
			</div>
		</div>
	{/if}
	<!-- Print-only study sheet: hidden on screen, the sole visible
	node under `@media print` (File → Print Study Sheet…, or Save as
	PDF from that dialog). Plain text on purpose — the PDF is a study
	artifact, not a theme snapshot. -->
	<section id="study-sheet-print" aria-hidden="true">
		<h1>{sheetTitle(chat.messages)}</h1>
		<p class="sheet-sub">Ccez Studio study sheet — {chat.messages.length} message{chat.messages.length === 1 ? "" : "s"}.</p>
		{#each chat.messages as msg (msg.id)}
			<h2>{msg.role === "user" ? "You" : "Ccez"}</h2>
			<p>{msg.content}</p>
		{/each}
	</section>
</div>

<style>
	/* Root opt-out of WebView algorithmic darkening: the page paints
	its own dark theme (gated on html[data-theme] below), so an old
	Android WebView must not "help" by darkening light text into
	invisibility. Without this the chat list reads fine on desktop
	but vanishes on the phone in dark mode. */
	:global(html) {
		--strong: #1c1c1e;
		--sel-tint: rgba(99, 102, 241, 0.28);
		--ok: #1f7a4d;
		--hl: #eef4ff;
		--hover-wash: #ececf1;
		--dim: #6e6e73;
		--alarm: #c0362c;
		--panel: #fafafc;
		--field: #fff;
		--invert: #1c1c1e;
		--invert-ink: #fff;
		--danger: #94250a;
		color-scheme: light dark;
		--bg: #fff;
		--bg-raised: #fff;
		--bg-wash: #f1f1f4;
		--ink: #1c1c1e;
		--muted: #6e6e73;
		--line: #c7c7cc;
		--line-soft: #e5e5ea;
		--line-hover: #8e8e93;
		--focus: #3a3a3c;
	}
	:global(html[data-theme="light"]) {
		--strong: #1c1c1e;
		--sel-tint: rgba(99, 102, 241, 0.28);
		--ok: #1f7a4d;
		--hl: #eef4ff;
		--hover-wash: #ececf1;
		--dim: #6e6e73;
		--alarm: #c0362c;
		--panel: #fafafc;
		--field: #fff;
		--invert: #1c1c1e;
		--invert-ink: #fff;
		--danger: #94250a;
		color-scheme: light;
		--bg: #fff;
		--bg-raised: #fff;
		--bg-wash: #f1f1f4;
		--ink: #1c1c1e;
		--muted: #6e6e73;
		--line: #c7c7cc;
		--line-soft: #e5e5ea;
		--line-hover: #8e8e93;
		--focus: #3a3a3c;
	}
	:global(html[data-theme="dark"]) {
		--strong: #aeaeb2;
		--sel-tint: rgba(129, 140, 248, 0.4);
		--ok: #7cc3a3;
		--hl: #12233d;
		--hover-wash: #2c2c2e;
		--dim: #aeaeb2;
		--alarm: #e89a90;
		--panel: #1c1c1e;
		--field: #101013;
		--invert: #f2f2f7;
		--invert-ink: #1c1c1e;
		--danger: #e89a90;
		--bg: #17171a;
		--bg-raised: #1c1c1e;
		--bg-wash: #2c2c2e;
		--ink: #f2f2f7;
		--muted: #98989f;
		--line: #48484a;
		--line-soft: #38383a;
		--line-hover: #636366;
		--focus: #aeaeb2;
	}
	:global(body) {
		margin: 0;
	}
	.app {
		display: flex;
		height: 100vh;
		height: 100dvh;
		font-family:
			-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
		color: #1c1c1e;
		color: var(--ink);
		background: #fff;
		background: var(--bg);
		color-scheme: light dark;
		/* Phones never pan sideways: a horizontal drift is a gesture,
		not a scroll (it used to open settings by accident). clip, not
		hidden, so fixed drawers stay viewport-relative. */
		overflow-x: clip;
	}
	:global(html),
	:global(body) {
		/* The document itself never scrolls: every pane (.messages,
		drawers, sheets) scrolls inside .app. Without this, iOS pans
		the whole page up to reveal the focused composer, parking the
		header pill under the island until the keyboard closes. */
		overflow: hidden;
		height: 100%;
	}
	/* Overlay drawer: the chat list slides over the main column instead
	of squeezing it — the main chat keeps full width whether sidebars
	are open or not. */
	aside {
		position: fixed;
		left: 0;
		top: 0;
		bottom: 0;
		width: 13rem;
		z-index: 55;
		background: #fff;
		background: var(--bg);
		box-shadow: 8px 0 24px rgba(0, 0, 0, 0.12);
		border-right: 1px solid #e5e5ea;
		border-right-color: var(--line-soft);
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
		position: relative;
	}
	aside li button:first-child {
		flex: 1;
		text-align: left;
	}
	/* The row × overlays instead of reserving its slot, so the chat
	pill spans the full row width flush with the + button below it.
	Keyboard focus brings it back (focus-within); touch has no hover,
	so the × stays in flow there. */
	aside li .del {
		position: absolute;
		right: 0;
		top: 50%;
		transform: translateY(-50%);
		opacity: 0;
		pointer-events: none;
	}
	aside li:hover .del,
	aside li:focus-within .del {
		opacity: 1;
		pointer-events: auto;
	}
	@media (hover: none) {
		aside li .del {
			position: static;
			transform: none;
			opacity: 1;
			pointer-events: auto;
		}
		/* Thumb-sized new-chat button (44px target). */
		aside .new {
			width: 100%;
			min-height: 2.75rem;
			font-size: 1.15rem;
			padding: 0.6rem;
		}
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
	/* The current chat wears a marker bar, never a background — so the
	hover wash reads on every row including the current one. */
	aside ul button.side-chat {
		position: relative;
		/* Same ButtonText trap as .sel-menu: pin the color explicitly. */
		color: #1c1c1e;
		color: var(--ink);
	}
	aside button.active {
		background: transparent;
		font-weight: 650;
	}
	aside button.active::before {
		content: "";
		position: absolute;
		left: 0.12rem;
		top: 50%;
		transform: translateY(-50%);
		width: 0.22rem;
		height: 1.05rem;
		border-radius: 999px;
		background: #5a9bf7;
	}
	aside ul button:hover {
		background: #ececf1;
		background: var(--hover-wash);
	}
	aside .new:hover {
		border-color: #3a3a3c;
		border-color: var(--focus);
	}
	aside .del:hover {
		color: #c0362c;
		color: var(--alarm);
	}

	aside .new {
		border-color: #c7c7cc;
		border-color: var(--line);
	}
	.side-head {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		/* 0.8rem aside padding + 0.1rem here = the header's 0.9rem. */
		margin-top: 0.1rem;
		/* No sidebar controls left (⌘B/⌘N live on keys only now): keep
		a grabbable drag strip where the button row was. */
		min-height: 1.25rem;
	}
	/* Sidebar search box (search-mobile): full-width field under the
	drag strip; the clear button sits inside on the right. */
	.side-search-wrap {
		position: relative;
		margin: 0.25rem 0 0.35rem;
	}
	.side-search {
		width: 100%;
		font: inherit;
		font-size: 0.82rem;
		padding: 0.4rem 1.6rem 0.4rem 0.6rem;
		border: 1px solid #c7c7cc;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
		background: var(--field);
		color: inherit;
	}
	.side-search-clear {
		position: absolute;
		right: 0.15rem;
		top: 50%;
		transform: translateY(-50%);
		border: none;
		min-width: 1.5rem;
	}
	aside {
		/* One duration for slide and fade: the old 0.12s opacity
		finished first, so closes read as a fade while the slide ran
		invisibly. Drawers slide both ways now. */
		transition:
			transform 0.22s ease,
			opacity 0.22s ease;
		overflow: hidden;
	}
	aside.collapsed {
		transform: translateX(-105%);
		opacity: 0;
	}
	/* Overlay drawer, right side: same contract as the chat list —
	the main chat never squeezes. */
	.settings-panel {
		position: fixed;
		right: 0;
		/* The chat-list drawer rule parks asides left: reset it here or
		the right-docked panel over-constrains and left wins. */
		left: auto;
		top: 0;
		bottom: 0;
		width: 22rem;
		z-index: 55;
		box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
		border-left: 1px solid #e5e5ea;
		border-left-color: var(--line-soft);
		padding: 1.2rem 0.7rem 2rem;
		overflow-y: auto;
		overflow-x: hidden;
		background: #fff;
		background: var(--bg);
		/* Same drawer contract as the chat list (see aside): the
		fade used to finish first and swallow the closing slide. */
		transition:
			transform 0.22s ease,
			opacity 0.22s ease;
	}
	.settings-panel.closed {
		transform: translateX(105%);
		opacity: 0;
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
		max-height: min(38rem, calc(100dvh - 3rem));
		overflow-y: auto;
		background: #fff;
		background: var(--bg);
		color: #1c1c1e;
		color: var(--ink);
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
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
		border-color: var(--line);
		border-radius: 8px;
		background: none;
		cursor: pointer;
		padding: 0.15rem 0.55rem;
		color: #3a3a3c;
		color: var(--focus);
		transition:
			border-color 0.15s ease,
			background-color 0.15s ease,
			color 0.15s ease;
	}
	/* Search palette (search-mobile): pinned to the top so the phone
	keyboard never covers the input; hits read as full-width rows. */
	.search-palette {
		align-self: flex-start;
		margin-top: 8vh;
		margin-top: 8dvh;
		padding: 0.7rem 0.9rem 0.8rem;
	}
	.search-palette .modal-head {
		align-items: center;
	}
	.search-input {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: 0.95rem;
		padding: 0.5rem 0.7rem;
		border: 1px solid #c7c7cc;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: #fff;
		background: var(--field);
		color: inherit;
	}
	.search-results {
		max-height: 50vh;
		max-height: 50dvh;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.search-hit {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		text-align: left;
		font: inherit;
		font-size: 0.85rem;
		padding: 0.45rem 0.6rem;
		border: 1px solid transparent;
		border-radius: 8px;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.search-hit.cursor {
		background: #eef4ff;
		background: var(--hl);
		border-color: #e5e5ea;
		border-color: var(--line-soft);
	}
	.search-kind {
		flex: none;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #6e6e73;
		color: var(--dim);
	}
	.search-snippet {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.search-status {
		font-size: 0.85rem;
		color: #6e6e73;
		color: var(--dim);
		padding: 0.6rem;
		margin: 0;
	}
	.modal-head button:hover {
		border-color: #1c1c1e;
		border-color: var(--strong);
	}
	/* Character Inspect overlay: narrow modal, big glyph beside the
	facts, schematic stroke progress below. */
	.inspect-modal {
		width: min(28rem, calc(100vw - 3rem));
	}
	.inspect-body {
		display: flex;
		gap: 1.1rem;
		align-items: flex-start;
		margin: 0.4rem 0 0.6rem;
	}
	.inspect-char {
		font-size: 3.4rem;
		line-height: 1.1;
	}
	.inspect-facts {
		flex: 1;
		min-width: 0;
	}
	.inspect-facts p {
		margin: 0.3rem 0;
	}
	.inspect-modal .note {
		color: #6e6e73;
		color: var(--muted);
		font-size: 0.85rem;
	}
	.inspect-step {
		font-variant-numeric: tabular-nums;
		margin-bottom: 0.3rem;
	}
	.inspect-bar {
		height: 0.45rem;
		border-radius: 999px;
		background: #e5e5ea;
		background: var(--line-soft);
		overflow: hidden;
	}
	.inspect-fill {
		height: 100%;
		background: #1c1c1e;
		background: var(--strong);
		transition: width 0.5s ease;
	}
	@media (prefers-reduced-motion: reduce) {
		.inspect-fill {
			transition: none;
		}
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
		border-top-color: var(--line-soft);
		font-size: 0.8rem;
	}
	/* Two-column grid: the whole first row skips the divisor. */
	.keys div:nth-child(-n + 2) {
		border-top: 0;
	}
	.keys dt {
		flex: 0 0 8rem;
		color: #3a3a3c;
		color: var(--focus);
	}
	.keys dd {
		margin: 0;
		font-family: ui-monospace, monospace;
		font-size: 0.75rem;
		color: #1c1c1e;
		color: var(--ink);
		overflow-wrap: anywhere;
	}
	aside .del {
		color: #6e6e73;
		color: var(--dim);
	}

	main {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	/* Slim title strip: an empty drag surface, no bar. Tall enough to
	clear the traffic lights, borderless so it reads as window chrome
	instead of UI. */
	header {
		display: flex;
		align-items: center;
		gap: 1rem;
		min-height: 1.75rem;
		padding: 0 1.4rem;
		font-size: 0.82rem;
		/* Chrome, not content: no I-beam, no text selection for the
		native window-drag region to fight over. Buttons keep their
		own pointer cursor. */
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
	}
	/* App name in the title strip: quiet chrome beside the drag
	surface, never interactive (double-click still zooms). */
	.app-title {
		font-weight: 600;
		letter-spacing: 0.01em;
		color: #6e6e73;
		color: var(--muted);
		pointer-events: none;
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
	/* The title strip stays a drag surface everywhere except controls
	(see dragWindow); the token tally (now in the settings panel) and
	the reply-language pill keep their own copyable treatment. */
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
	/* Touch-only waypoint chrome: toolbar jump icon, sheet backdrop,
	sheet head, current-item mark. Display none on pointer devices,
	where the hover ticks and floating card stay. Role dots ride both
	menus. */
	.wp-jump,
	.wp-veil,
	.wp-sheet-head {
		display: none;
	}
	.wp-dot {
		display: inline-block;
		flex-shrink: 0;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		margin-right: 0.55rem;
		transform: translateY(-1px);
		background: #0a84ff;
	}
	.wp-dot[data-role="assistant"] {
		background: #30d158;
	}
	.wp-menu button[aria-current="true"] {
		background: #f1f1f4;
		background: var(--bg-wash);
		font-weight: 600;
	}
	/* Touch waypoint rules live after the base waypoint block (later in
	this file): equal-specificity overrides must come second to win. */
	@keyframes wp-sheet-in {
		from {
			transform: translateY(1rem);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	/* Anchor for the reply-language pill: the pill floats beside the
	anchor instead of sitting in flow, so popping it in never moves
	the strip. The float (not the button) carries the fade, leaving
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
	.lang-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font: inherit;
		font-size: 0.78rem;
		color: #1c1c1e;
		color: var(--ink);
		border: 1px solid #1c1c1e;
		border-color: var(--strong);
		border-radius: 999px;
		background: none;
		cursor: pointer;
		padding: 0.2rem 0.7rem;
		white-space: nowrap;
	}
	.lang-chip :global(.action-glyph) {
		height: 0.8rem;
	}
	/* Browser panel chrome recedes like the language pill. The bar
	docks right in the title strip; the panel is shortcut-only, so
	this only shows the address bar while it is open. */
	.sideview-bar {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.browser-address {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.browser-address input {
		font: inherit;
		font-size: 0.78rem;
		color: inherit;
		background: none;
		border: 1px solid #1c1c1e;
		border-color: var(--strong);
		border-radius: 999px;
		padding: 0.2rem 0.6rem;
		width: 13rem;
		max-width: 38vw;
	}
	.browser-address input::placeholder {
		opacity: 0.55;
	}
	.browser-address button {
		font: inherit;
		font-size: 0.78rem;
		color: #1c1c1e;
		color: var(--ink);
		border: 1px solid #1c1c1e;
		border-color: var(--strong);
		border-radius: 999px;
		background: none;
		cursor: pointer;
		padding: 0.2rem 0.7rem;
		white-space: nowrap;
		opacity: 0.55;
		transition: opacity 0.18s ease;
	}
	.browser-address button:hover,
	.browser-address button:focus-visible {
		opacity: 1;
	}
	.export-btn {
		font: inherit;
		/* The open strip is a fixed drawer (z-index 55) covering the
		top bar: without its own stacking the toggle sinks under it
		and can never be clicked shut. */
		position: relative;
		z-index: 56;
		font-size: 0.78rem;
		color: #1c1c1e;
		color: var(--ink);
		border: 1px solid #1c1c1e;
		border-color: var(--strong);
		border-radius: 999px;
		background: none;
		cursor: pointer;
		padding: 0.2rem 0.7rem;
		white-space: nowrap;
		opacity: 0.55;
		transition: opacity 0.18s ease;
	}
	.export-btn:hover,
	.export-btn:focus-visible {
		opacity: 1;
	}
	/* Fallback strip (browser dev, no shell webview): docks right
	like the native tab does in the shell. Overrides the left
	chat-list drawer above (same element, opposite edge). Width is
	the memorized panel width (inline style); this is the floor. */
	.sideview-fallback {
		left: auto;
		right: 0;
		min-width: 17.5rem;
		max-width: 90vw;
		border-right: 0;
		border-left: 1px solid #e5e5ea;
		border-left-color: var(--line-soft);
		box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
	}
	/* Edge-drag resize handle: a slim strip on the panel's left
	edge; dragging it memorizes the width into settings. */
	.browser-resize {
		position: absolute;
		top: 0;
		bottom: 0;
		left: -5px;
		width: 10px;
		cursor: ew-resize;
		touch-action: none;
	}
	.browser-error {
		color: var(--danger, #b3261e);
	}
	.sideview-fallback-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.sideview-fallback p {
		font-size: 0.85rem;
		margin: 0;
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
	/* Android is a Tauri shell with no traffic lights and no window
	drag: drop the desktop clearance and the empty drag strip. */
	.app[data-android] header {
		padding-left: 1.4rem;
		padding-top: 0;
		/* The strip stays: with the webview reporting a zero top inset,
		its 28px is the status-clock clearance, not spare room. */
	}
	.app[data-android] .side-head {
		margin-left: 0;
		margin-top: 0;
		min-height: 0;
	}
	/* Notch and home-indicator clearance: the reply pill stops riding
	under the status clock, the composer clears the gesture bar. env()
	is 0 where the webview already insets, so this no-ops there. */
	.app[data-android] header {
		padding-top: env(safe-area-inset-top, 0px);
	}
	.app[data-android] main {
		padding-bottom: env(safe-area-inset-bottom, 0px);
	}
	/* Original spacing stands: the header strip plus the list's own
	inset keep the first message clear of the island. Trimming it
	(any of three tries) slid text under the clock — the first-message
	gap was never worth chasing. */
	.app[data-android] .messages {
		padding-top: calc(1rem + env(safe-area-inset-top, 0px));
	}
	/* Full-width settings sheet on phones: no sliver to tap, no
	weird one-tap-close strip. left+right with auto width fills
	exactly (a 100% width would add the padding on top and overflow).
	The inner column centers itself. */
	.app[data-android] .settings-panel {
		left: 0;
		width: auto;
		padding-top: calc(1.2rem + env(safe-area-inset-top, 0px));
	}
	.app[data-android] .settings-inner {
		width: auto;
		max-width: 26rem;
		margin-left: auto;
		margin-right: auto;
	}
	/* Chats with messages lift the composer off the bottom and give
	it more rows: the empty state's hero layout keeps its own rhythm.
	No font-size here — CodeMirror caches line metrics, and a size
	change out from under it collapses the editor to zero height. */
	/* iOS zooms into any text field under 16px on focus (and the
	zoom is what unlocks sideways panning): phone fields floor at
	16px. Desktop keeps its optical sizes. */
	.app[data-android] .prompt :global(.ta-input) {
		font-size: 16px;
	}
	.app[data-android] main:not(.empty) .prompt {
		margin-bottom: 1.8rem;
		min-height: 7.25rem;
	}
	/* Touch has no hover: tooltips only ever appear as a clipped
	flash on long-press (the fold button's runs off-screen). */
	.app[data-android] .actions [data-tip]::after {
		display: none;
	}
	/* Thumb-sized Cancel targets on phones: the annotation review and
	pill buttons plus the chat-row ×. Message-row icons stay tight so
	the row never overflows the phone width. */
	.app[data-android] .review-edit-actions button {
		padding: 0.6rem 1.2rem;
		min-height: 2.75rem;
	}
	.app[data-android] .ann-cancel,
	.app[data-android] .ann-save {
		min-height: 2.75rem;
	}
	.app[data-android] aside li .del {
		padding: 0.6rem;
		min-width: 2.75rem;
		min-height: 2.75rem;
		/* The box grew already; the glyph itself stays text-sized. */
		font-size: 1.15rem;
	}
	/* Phones thumb-reach the chat list: it slides up from the bottom
	instead of in from the left. Desktop keeps the left drawer; the
	settings panel keeps its right drawer (one sidebar at a time). */
	.app[data-android] aside:not(.settings-panel) {
		left: 0;
		right: 0;
		top: auto;
		bottom: 0;
		width: auto;
		max-height: 62vh;
		overflow-y: auto;
		border-right: 0;
		border-top: 1px solid #e5e5ea;
		border-radius: 16px 16px 0 0;
		box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.16);
		padding-bottom: calc(0.8rem + env(safe-area-inset-bottom, 0px));
	}
	.app[data-android] aside:not(.settings-panel).collapsed {
		transform: translateY(105%);
	}
	/* Four region menus share one row on a phone: no wrap, tighter
	chrome. Desktop keeps the wrapping rhythm. */
	.app[data-android] .lang-menus {
		flex-wrap: nowrap;
		gap: 0.4rem;
	}
	.app[data-android] .lang-menu > button {
		font-size: 0.75rem;
		padding: 0.3rem 0.55rem;
		white-space: nowrap;
	}
	/* The gestures list goes single-column on phones: two columns
	overflow a 360px viewport by ~60px, clipping the very text that
	teaches the gestures. Touch descriptions are prose, not key
	chords, so they drop the monospace too. */
	.app[data-android] .keys {
		grid-template-columns: 1fr;
	}
	.app[data-android] .keys div:nth-child(2) {
		border-top: 1px solid #e5e5ea;
	}
	.app[data-android] .keys dd {
		font-family: inherit;
		font-size: 0.8rem;
	}
	nav {
		display: flex;
		gap: 0.3rem;
		padding: 0.4rem 1.2rem;
		border-bottom: 1px solid #e5e5ea;
		border-bottom-color: var(--line-soft);
		overflow-x: auto;
	}
	nav button {
		font-size: 0.75rem;
		min-width: 1.6rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 999px;
		background: #fff;
		background: var(--bg-raised);
		/* No unclassed button renders inside nav today, but ButtonText
		would strike here the moment one does. */
		color: #1c1c1e;
		color: var(--ink);
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
		border-color: var(--line);
		border-radius: 16px;
		background: #fff;
		background: var(--bg-raised);
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
		color: var(--ink);
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
		background: color-mix(in oklab, var(--ink) 6%, transparent);
		background: var(--bg-wash);
	}
	.messages {
		flex: 1;
		/* Flex items default to min-height: auto, which lets growing
		content stretch this pane and squeeze the composer instead of
		scrolling inside it — the prompt shrank and juddered with
		every streamed chunk. Zero lets it scroll like it should. */
		min-height: 0;
		overflow-y: auto;
		/* Jumped-to rows never park flush under the top edge (jumpTo,
		double-tap): programmatic scrolls keep this breathing room. */
		scroll-padding-top: 1rem;
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
		/* Classic scrollbars never shove the column when they appear. */
		scrollbar-gutter: stable;
		transition: scrollbar-color 0.6s ease;
		/* Tight top: the header already separates chrome from text. */
		padding: 0.5rem 1.2rem 1rem;
		display: flex;
		flex-direction: column;
		/* Pairs hug: a message sits close to its reply; the wider
		separation lands between pairs (see article.user below). */
		gap: 0.35rem;
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
	/* The two drawers slide on transform (plus their collapse widths),
	which the shared fade shorthand above would replace: restate the
	full lists here so the scrollbar fade joins instead of killing the
	slide. Every list keeps transform, or closes read as a fade. */
	aside[data-fade-scroll] {
		transition:
			transform 0.22s ease,
			width 0.22s ease,
			opacity 0.22s ease,
			padding 0.22s ease,
			border-width 0.22s ease,
			scrollbar-color 0.6s ease;
	}
	.settings-panel[data-fade-scroll] {
		transition:
			transform 0.22s ease,
			width 0.22s ease,
			opacity 0.22s ease,
			padding 0.22s ease,
			border-color 0.22s ease,
			scrollbar-color 0.6s ease;
	}
	aside[data-fade-scroll]:global(.scrolling) {
		transition:
			transform 0.22s ease,
			width 0.22s ease,
			opacity 0.22s ease,
			padding 0.22s ease,
			border-width 0.22s ease,
			scrollbar-color 0.12s ease;
	}
	.settings-panel[data-fade-scroll]:global(.scrolling) {
		transition:
			transform 0.22s ease,
			width 0.22s ease,
			opacity 0.22s ease,
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
	/* Touch waypoint: the tick strip is pointer-sized and parked on the
	wrong edge for thumbs, so touch gets a jump icon in the composer
	tools opening a bottom sheet. Desktop keeps its hover ticks and
	floating card untouched. Later than the base waypoint rules, so
	equal-specificity ties win. */
	@media (hover: none) {
		.wp-btn {
			display: none;
		}
		/* Touch has no hover intent: a tap's sticky :hover/:focus would
		paint the sheet over the pill before the click lands, stealing
		it. Closed-only (the :not guard), so the open sheet survives the
		sticky hover + pill focus that opening by tap leaves behind. The
		sheet opens on wpOpen only; keyboard/AT activation is a click,
		so it still opens. */
		.wp-wrap:not(.open):hover .wp-menu,
		.wp-wrap:not(.open):focus-within .wp-menu {
			opacity: 0;
			visibility: hidden;
			transition:
				opacity 0.18s ease,
				visibility 0s linear 0.18s;
		}
		nav[aria-label="Waypoints"] {
			top: auto;
			right: 0;
			left: 0;
			bottom: 0;
			transform: none;
			pointer-events: none;
		}
		/* Jump icon joins the tools cluster like attach/mic, with a
		full-size touch target that keeps the cluster's footprint (the
		negative margin offsets the extra padding). */
		.wp-jump {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			line-height: 0;
			color: #6e6e73;
			border: 0;
			background: none;
			cursor: pointer;
			padding: 0.65rem;
			margin: -0.45rem;
			transition: color 0.18s ease;
			user-select: none;
			-webkit-user-select: none;
		}
		.wp-veil {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 60;
			border: 0;
			/* Full-bleed square corners: without this the legacy
			`nav button` pill radius turns the backdrop into an oval. */
			border-radius: 0;
			background: rgba(0, 0, 0, 0.32);
			pointer-events: auto;
		}
		.wp-menu {
			position: fixed;
			left: 0.75rem;
			right: 0.75rem;
			bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
			top: auto;
			z-index: 62;
			min-width: 0;
			max-width: none;
			max-height: 55vh;
			border-radius: 20px;
			padding: 0.25rem 0.4rem 0.5rem;
			pointer-events: auto;
		}
		.wp-wrap.open .wp-menu {
			animation: wp-sheet-in 0.18s ease-out;
		}
		.wp-sheet-head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 0.35rem 0.1rem 0.35rem 0.7rem;
			font-size: 0.8rem;
			color: #8e8e93;
		}
		.wp-menu .wp-sheet-head button {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 2.75rem;
			height: 2.75rem;
			padding: 0;
			font-size: 1.4rem;
			line-height: 1;
			color: inherit;
		}
		.wp-menu button[role="menuitem"] {
			padding: 0.75rem 0.7rem;
			font-size: 0.9rem;
		}
	}
	main.empty .messages {
		justify-content: center;
		/* Roomy hero zone: on the empty screen the prompt and pills sit
		below the fold of the hero, neither middle nor bottom. */
		max-height: 60%;
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
		text-wrap: balance;
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
	/* Mac desktop only: lift the language buttons clear of the
	composer (the default gap reads stranded under macOS chrome).
	A pure visual shift — layout never moves, so nothing overlaps.
	Eyeball the exact offset on a Mac; touch layouts are untouched. */
	.app[data-mac] main.empty .lang-menus {
		transform: translateY(-1.5rem);
	}
	.lang-menu {
		position: relative;
	}
	.lang-menu > button {
		font-size: 0.82rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 10px;
		background: none;
		cursor: pointer;
		padding: 0.4rem 0.8rem;
		color: #1c1c1e;
		color: var(--ink);
		transition: border-color 0.15s ease;
	}
	.lang-menu > button:hover {
		border-color: #1c1c1e;
		border-color: var(--strong);
	}
	.lang-list {
		position: absolute;
		z-index: 40;
		/* Open upward over the composer, never down past it. */
		bottom: calc(100% + 0.35rem);
		left: 0;
		/* Shrink-wrap the longest name: a fixed min-width leaves dead
		space right of every short option and pushes right-edge menus
		(like African) off-screen. */
		min-width: 0;
		width: max-content;
		max-width: calc(100vw - 1rem);
		/* Full extent, never a scrollbar: the longest menu is 15 items
		and the list opens upward over the messages. */
		display: flex;
		flex-direction: column;
		padding: 0.3rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 10px;
		background: #fff;
		background: var(--bg-raised);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
	}
	@media (hover: none) {
		/* A phone can't fit the 15-item list above the pills, so it
		gets a capped sheet with its own scroll instead of flying off
		the top of the screen. Desktop keeps full extent, no scrollbar. */
		.lang-list {
			max-height: 52vh;
			overflow-y: auto;
		}
		/* Phone menus must not trail off-screen: middle menus center
		under their button, while the edge menus hug their own edge
		(Europe's list spilled left, Classics' right). The capped
		max-width still bounds every list to the viewport. */
		.lang-menu .lang-list {
			left: 50%;
			right: auto;
			transform: translateX(-50%);
		}
		.lang-menu:first-child .lang-list {
			left: 0;
			transform: none;
		}
		.lang-menu:last-child .lang-list {
			left: auto;
			right: 0;
			transform: none;
		}
	}
	/* The last menu (Classics) hugs the right edge: a left-anchored
	list of long nowrap names trails off the page there. Right-anchor
	it instead (all viewports — narrow desktop windows clip it too). */
	.lang-menu:last-child .lang-list {
		left: auto;
		right: 0;
	}
	.lang-list button {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.82rem;
		border: 0;
		border-radius: 7px;
		background: none;
		cursor: pointer;
		padding: 0.35rem 0.45rem;
		text-align: left;
		color: #1c1c1e;
		color: var(--ink);
		white-space: nowrap;
		transition: background-color 0.15s ease;
	}
	.lang-list button:hover,
	.lang-list button:focus-visible {
		background: #f1f1f4;
		background: var(--bg-wash);
	}
	.lang-list button.selected {
		font-weight: 650;
		background: #f1f1f4;
		background: var(--bg-wash);
	}
	.badge {
		display: inline-block;
		min-width: 2rem;
		text-align: center;
		font-size: 0.7rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: #3a3a3c;
		color: var(--focus);
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 6px;
		padding: 0.1rem 0.3rem;
	}
	article {
		position: relative;
		border-radius: 10px;
		padding: 0.6rem 0.8rem;
		/* Flex items default to min-width:auto: a nowrap folded preview
		refuses to shrink and shoves the whole chat sideways (stray
		scrollbars). Zero lets the ellipsis bite instead. */
		min-width: 0;
		/* Text starts only at the message body: dragging anywhere else
		(empty space, action rows) is a plain pointer drag, never an
		I-beam selection. .rendered re-enables both below. */
		user-select: none;
		-webkit-user-select: none;
		cursor: default;
	}
	/* A user message opens a new pair, so it carries the
	between-pair separation on top; replies hug underneath. */
	article.user {
		margin-top: 0.45rem;
	}
	article:first-of-type {
		margin-top: 0;
	}
	/* Even wrapping reads better in a chat column; one line, and
	engines without it just wrap normally. Assistant only: on short
	own messages pretty balances the lines into even halves, reshaping
	the bubble (a lone "paragraphs." gets "Japanese" pulled down to
	join it) — own text keeps its natural ragged wrap. */
	.messages article.assistant :global(.rendered) {
		text-wrap: pretty;
	}
	article.user {
		align-self: flex-end;
		/* Shrink-wrap so short prompts don't stretch into empty space.
		Beats the centered-column rule's width:100% on specificity;
		margin-right keeps the right edge on the chat-width column. */
		width: fit-content;
		max-width: min(85%, calc(var(--chat-width, 36) * 1rem));
		margin-right: max(0rem, calc((100% - var(--chat-width, 36) * 1rem) / 2));
		/* No background or padding here: the bubble wraps the text only,
		so the action row below sits outside it. */
		padding: 0;
	}
	/* Own-message bubble: shrink-wraps the text (never the wider action
	row underneath) and docks hard right, so the side padding matches on
	both sides. Text stays left-aligned inside the right-docked bubble;
	long text wraps at 85% instead of going full-bleed, so a wrapped
	message keeps a visible left gutter and still reads as right-docked.
	Slightly tighter on top, where the text sat low. */
	article.user .bubble {
		background: #f1f1f4;
		background: var(--bg-wash);
		border-radius: 1.75rem;
		padding: 0.45rem 1rem 0.55rem;
		text-align: left;
		width: fit-content;
		/* 100%, not 85%: the article already caps at min(85%, chat-width),
		and 85% here resolves against the shrink-wrapped article itself —
		squeezing short prompts into an early wrap with dead space left. */
		max-width: 100%;
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
		/* Assistant text packs tight: the list gap already separates
		messages, so no vertical padding here (desktop and touch). */
		padding-top: 0;
		padding-bottom: 0;
	}
	/* Unshaded own messages read like replies: no bubble, but the same
	right-docked flow — alignment never changes with the background.
	Shrink-wrap + auto margin docks short messages hard right (a full
	width here would strand them left with dead space on the right). */
	main.plain-user article.user .bubble {
		background: none;
		/* No bottom pad: the action row below sits as close as the
		assistant's (its margin is the whole gap). Same 85% wrap cap
		as the shaded bubble, so plain text keeps its right dock. */
		padding: 0.5rem 0 0;
		text-align: left;
		width: fit-content;
		max-width: 85%;
		margin-left: auto;
	}
	article.selected {
		outline: 2px solid #3a3a3c;
		outline-color: var(--focus);
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
		margin-bottom: 0.35rem;
		font-size: 0.75rem;
		color: #6e6e73;
		color: var(--muted);
	}
	/* Attachment chips: icon + name in a quiet pill (no emoji — the
	attach glyph matches the composer's icon-only treatment). */
	.sent-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 999px;
		padding: 0.15rem 0.6rem;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sent-chip :global(.action-glyph) {
		height: 0.85em;
		flex-shrink: 0;
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
		top: -1.2rem;
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
		/* The count tracks the chat text size like badges do (dampened:
		never compounding rem, just the message scale). */
		font-size: calc(0.72rem * var(--font-scale, 1));
		font-weight: 650;
		line-height: 1.4;
		padding: 0 0.1rem;
		cursor: default;
	}
	/* Opens overlapping its number pill (flush with the row's bottom
	edge): the cursor is already inside the card the moment it
	appears, so hovering the number never needs a travel gap. The
	invisible bridge below stays as backstop for the fade. */
	.ann-refs-pop {
		position: absolute;
		bottom: 0;
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
	/* Per-annotation copy in the sent-refs card: icon only, no text,
	pushed to the row's end like the panel's delete button. */
	.ann-refs-copy {
		margin-left: auto;
		flex: none;
		align-self: center;
		display: inline-flex;
		border: 0;
		background: none;
		color: #c7c7cc;
		cursor: pointer;
		padding: 0.1rem;
		border-radius: 6px;
	}
	.ann-refs-copy :global(.action-glyph) {
		height: 0.75rem;
	}
	.ann-refs-copy:hover {
		color: #fff;
	}
	/* Attachment strip: same 1.2rem column edges as the composer (never
	a full-bleed row), one scrolling row when many — pills never wrap
	into a tall stack and never spill past the column. */
	.attachments {
		list-style: none;
		display: flex;
		flex-wrap: nowrap;
		gap: 0.4rem;
		margin: 0 1.2rem;
		padding: 0.5rem 0 0.25rem;
		box-sizing: border-box;
		max-width: calc(100% - 2.4rem);
		overflow-x: auto;
		scrollbar-width: thin;
	}
	.attachments li {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
		font-size: 0.78rem;
		background: #eef4ff;
		background: var(--hl);
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
		color: var(--muted);
	}
	.attachments button {
		border: 0;
		background: none;
		cursor: pointer;
		color: #3a3a3c;
	}
	.attachments .thumb {
		border: 0;
		background: none;
		cursor: pointer;
		line-height: 0;
		padding: 0;
	}
	/* Image cards: thumbnail preview up top, token/copy/OCR/X footer
	below (the strip itself stays one scrolling row — only the card
	wraps internally). */
	.attachments li.card {
		flex-wrap: wrap;
		row-gap: 0.3rem;
		border-radius: 12px;
		padding: 0.4rem 0.5rem;
		max-width: 12rem;
		align-items: center;
	}
	.attachments li.card .thumb {
		flex: 1 1 100%;
	}
	.attachments .thumb img {
		display: block;
		width: 100%;
		height: 4.5rem;
		object-fit: cover;
		border-radius: 8px;
	}
	/* Card buttons are icon-only (message-button copy glyph, close
	glyph), sized to the card's font so they track it. */
	.attachments .card-btn {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem;
		font-size: 0.78rem;
	}
	.attachments .card-btn :global(.action-glyph) {
		height: 1em;
	}
	.attachments .ocr-btn {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		padding: 0.15rem 0.3rem;
		border-radius: 6px;
	}
	.attachments .ocr-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.preview {
		display: block;
		max-width: 16rem;
		max-height: 12rem;
		margin: 0.4rem 1.2rem 0;
		border-radius: 8px;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
	}
	.toast {
		position: fixed;
		/* Clear of the camera hole even when the WebView reports no
		safe-area (env() = 0): 3.5rem sits below the island either way. */
		top: max(3.5rem, calc(0.5rem + env(safe-area-inset-top, 0px)));
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
	/* Speech errors ride under the toast: top of the screen, big
	enough to notice, same dark-red pairing as the old banner so it
	reads in both themes. A tap dismisses; silence still expires it. */
	.voice-error {
		position: fixed;
		top: max(6.75rem, calc(3rem + env(safe-area-inset-top, 0px)));
		left: 50%;
		transform: translateX(-50%);
		z-index: 100;
		max-width: min(30rem, calc(100vw - 2rem));
		background: #3d1008;
		color: #ffb4a2;
		font: inherit;
		font-size: 0.95rem;
		line-height: 1.4;
		padding: 0.7rem 1.1rem;
		border: 0;
		border-radius: 12px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		cursor: pointer;
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
		background: var(--sel-tint);
	}
	/* …tinted amber on the message a speak-aloud selection came from,
	restored automatically when speech ends. */
	article.speaking-sel ::selection {
		background: rgba(245, 158, 11, 0.45);
	}
	.hidden-input {
		display: none;
	}
	/* System-callout look: one translucent pill, hairline dividers, no
	gaps. On iOS this IS the selection menu (the native callout is
	suppressed over messages), so it should feel at home there — a
	generic pill with text buttons, no Apple marks. */
	.sel-menu {
		position: fixed;
		z-index: 50;
		display: flex;
		align-items: stretch;
		padding: 0;
		border: 0;
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.88);
		-webkit-backdrop-filter: blur(18px) saturate(1.6);
		backdrop-filter: blur(18px) saturate(1.6);
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
		overflow: hidden;
		/* The menu is chrome, not text: dragging across it must not
		start a selection of its own label. */
		user-select: none;
		-webkit-user-select: none;
	}
	:global(html[data-theme="dark"]) .sel-menu {
		background: rgba(30, 30, 32, 0.88);
	}
	.sel-menu button {
		font-size: 0.95rem;
		border: 0;
		border-radius: 0;
		background: none;
		/* Buttons resolve color to system ButtonText, never inheritance:
		pin it or dark mode reads phone-default black. */
		color: #1c1c1e;
		color: var(--ink);
		cursor: pointer;
		padding: 0.55rem 0.95rem;
		white-space: nowrap;
	}
	/* Single-button menu (Annotate alone): no dividers; Inspect adds
	a hairline between the two when a single Han character qualifies. */
	.sel-menu button + button {
		border-left: 1px solid #e5e5ea;
		border-left-color: var(--line-soft);
	}
	.sel-menu button:hover {
		background: #f1f1f4;
		background: var(--bg-wash);
	}
	.sel-menu button:active {
		opacity: 0.55;
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
		/* Clip: without it, selection wash and focus paint square past
		the rounded corners on phones. Shadows paint outside, so they
		are unaffected. */
		overflow: hidden;
		width: 24rem;
		/* Border-box: without it the padding and border stack outside
		the rem width and the vw clamp (content-box), spilling past
		the viewport edge on phones. The responsive units only
		contain the card on every OS with this set. */
		box-sizing: border-box;
		max-width: calc(100vw - 1rem);
		padding: 1rem 1.1rem 0.9rem;
		border: 1px solid #38383a;
		border-radius: 20px;
		/* Tall boxes read over-rounded at a full pill radius, so a
		grown box (see growPill's tall flag) drops to a smaller one. */
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
	/* :global — toggled from growPill via classList (see the tall
	flag there), so the compiler can't see the use site. Covers the
	edit card and the fresh pill alike: a grown create-box drops
	out of its 999px capsule to the same smaller radius. */
	.ann-pop:global(.tall),
	.ann-pop.fresh:global(.tall) {
		border-radius: 12px;
	}
	.ann-pop textarea {
		display: block;
		width: 100%;
		/* Flooded unbroken text (pasted URLs, romaji runs) must wrap
		inside the box instead of spilling past its edge: break
		anywhere only when nothing else fits, so normal words wrap
		as before. */
		overflow-wrap: anywhere;
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
		/* Cap mirrors growPill's 168px: with field-sizing the CSS owns
		the height and the JS stands down (see guard there). */
		max-height: 168px;
		field-sizing: content;
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
		/* On the base (not :hover) so the hover animates symmetrically
		in and back out, instead of snapping one way. */
		transition:
			filter 0.15s ease,
			transform 0.15s ease;
	}
	.ann-save:hover {
		filter: brightness(1.08);
		transform: scale(1.03);
	}
	.ann-save:active {
		transform: scale(1);
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
		border-color: var(--line-soft);
		border-radius: 10px;
		padding: 0.6rem 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		background: #fafafc;
		background: var(--panel);
	}
	.review-item {
		border-radius: 8px;
		padding: 0.35rem 0.5rem;
	}
	.review-item.highlight {
		background: #eef4ff;
		background: var(--hl);
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
		color: var(--muted);
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0;
	}
	.review-head button:hover {
		color: #1c1c1e;
		color: var(--ink);
		text-decoration: underline;
	}
	.review-num {
		font-weight: 700;
	}
	.review-label {
		color: #6e6e73;
		color: var(--muted);
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
		color: inherit;
		background: #fff;
		background: var(--field);
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 10px;
		padding: 0.4rem 0.6rem;
		resize: vertical;
	}
	.review textarea:focus {
		outline: none;
		border-color: #1c1c1e;
		border-color: var(--strong);
	}
	/* The edit box stays readable in dark mode: the near-black field
	surface swallows typed text under dim panels, so edits ride a
	raised surface with light ink instead. */
	:global(html[data-theme="dark"]) .review textarea {
		background: #3a3a3c;
		color: #f2f2f7;
		border-color: #636366;
	}
	:global(html[data-theme="dark"]) .review textarea::placeholder {
		color: #aeaeb2;
	}
	/* Save is the solid primary pill (same fill as the send button);
	Cancel is quiet text — the two never look like twins. */
	.review-edit-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin-top: 0.35rem;
	}
	.review-edit-actions button {
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		border-radius: 999px;
		padding: 0.28rem 0.9rem;
		border: 1px solid #1c1c1e;
		border-color: var(--invert);
		background: #1c1c1e;
		background: var(--invert);
		color: #fff;
		color: var(--invert-ink);
		/* On the base (not :hover) so Save and Cancel animate
		symmetrically in and back out, instead of snapping one way. */
		transition:
			opacity 0.15s ease,
			color 0.15s ease,
			background-color 0.15s ease,
			border-color 0.15s ease;
	}
	.review-edit-actions button:hover {
		opacity: 0.8;
	}
	.review-edit-actions button:last-child {
		border-color: transparent;
		background: none;
		color: #6e6e73;
		color: var(--muted);
		font-weight: 400;
	}
	.review-edit-actions button:last-child:hover {
		opacity: 1;
		color: #1c1c1e;
		color: var(--ink);
		text-decoration: underline;
	}
	/* Merged pill: the wrap carries the single border; the count and ×
	buttons inside are bare segments. Later than the prompt tool buttons
	so the bare look wins (dark overrides below only recolor). */
	.ann-wrap {
		position: relative;
		display: inline-flex;
		align-items: center;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
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
		color: var(--muted);
		cursor: pointer;
		/* Controls, not content: labels stay out of selections. */
		user-select: none;
		-webkit-user-select: none;
	}
	.ann-wrap > button:hover {
		color: #1c1c1e;
		color: var(--ink);
	}
	.ann-pill {
		font-weight: 650;
	}
	/* Clear-all heads the popup, top-right. */
	.review-tools {
		display: flex;
		justify-content: flex-end;
		padding: 0.35rem 0.2rem 0.1rem;
	}
	.review-tools button {
		border: 0;
		background: none;
		cursor: pointer;
		font-size: 0.75rem;
		color: #6e6e73;
		color: var(--muted);
		padding: 0.1rem 0.3rem;
	}
	.review-tools button:hover {
		color: #94250a;
		color: var(--danger);
	}
	/* Per-note edit is a pencil in the message-action style (same
	stroke icon, same quiet gray) instead of a text button. It rides
	right after the note text — not margin-left:auto at the card's far
	edge, where the cursor overshoots the card reaching it and the
	whole overlay drops. */
	.review-head button.review-pencil {
		display: inline-flex;
		align-items: center;
		align-self: center;
		margin-left: 0;
		flex-shrink: 0;
		color: #6e6e73;
		padding: 0.15rem;
		border-radius: 6px;
		/* On the base (not :hover) so the glow animates symmetrically
		in and back out, instead of snapping one way. */
		transition:
			color 0.15s ease,
			filter 0.15s ease;
	}
	.review-head button.review-pencil :global(.action-glyph) {
		height: 0.8rem;
	}
	/* Per-note copy rides next to the quote in the pencil's style:
	icon only, no text. margin-left:0 keeps it with the quote while
	the delete button's auto margin holds the row's right edge. */
	.review-head button.review-copy {
		display: inline-flex;
		align-items: center;
		margin-left: 0;
		flex-shrink: 0;
		color: #6e6e73;
		padding: 0.15rem;
		border-radius: 6px;
	}
	.review-head button.review-copy :global(.action-glyph) {
		height: 0.8rem;
	}
	.review-head button.review-copy:hover {
		color: #1c1c1e;
		color: var(--ink);
	}
	/* Hover glows accent-blue instead of going ink: the pencil is small
	and quiet-gray, so an ink hover read as disappearing. */
	.review-head button.review-pencil:hover {
		color: #5a9bf7;
		filter: drop-shadow(0 0 3px rgba(90, 155, 247, 0.8));
		text-decoration: none;
	}
	/* Annotation popover: collapsed to the pill, expands on hover,
	focus, or pinned click. Beats the centered-column group rule.
	Flush against the pill (no gap): the pointer travels straight
	from badge to popup without crossing dead hover space. */
	/* The pill sits at the prompt's right edge, so the card anchors
	right and grows up-and-left — growing right would run it off the
	column (and over the send button's airspace). It opens overlapping
	the pill itself (a hair past the wrap's bottom edge), so the cursor
	is already inside the card the moment it appears — no travel gap,
	no bridge to cross. Hover, keyboard focus, and touch-tap all open
	it through CSS alone; the pill button has no click action. */
	.ann-wrap .review {
		position: absolute;
		bottom: -0.1rem;
		right: 0;
		z-index: 60;
		width: max-content;
		min-width: 16rem;
		max-width: min(30rem, calc(100vw - 3rem));
		max-height: 18rem;
		overflow-y: auto;
		margin: 0;
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
		/* display:none can't fade: the card always lays out but sits
		invisible and untouchable until hover, focus, or pin. */
		visibility: hidden;
		opacity: 0;
		pointer-events: none;
		transition:
			opacity 0.16s ease,
			visibility 0.16s;
	}
	.ann-wrap .review-quote {
		overflow-wrap: anywhere;
	}
	.ann-wrap:hover .review,
	.ann-wrap:focus-within .review,
	.ann-wrap.pinned .review {
		visibility: visible;
		opacity: 1;
		pointer-events: auto;
	}
	/* Phone: the card anchors left of the paperclip by default — nudge
	it right so it covers the tools cluster instead of the draft. */
	.app[data-android="true"] .ann-wrap .review {
		right: -2.4rem;
	}
	.muted {
		font-size: 0.82rem;
		color: #6e6e73;
		color: var(--muted);
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
	/* Desktop rows may outgrow the column at very large text sizes
	(400%): wrap instead of clipping. Phones keep their own sideways
	scroll treatment below, so this stays off the touch rules. */
	.app:not([data-android]) .actions {
		flex-wrap: wrap;
		row-gap: 0.35rem;
	}
	@media (hover: none) {
		/* Aid labels (show original) can outgrow the message: the row
		scrolls sideways inside itself instead of spilling out and
		dragging the whole chat along. Vertical drags still reach the
		chat; the bar stays clean with no scrollbar of its own. */
		.actions {
			max-width: 100%;
			overflow-x: auto;
			overscroll-behavior-x: contain;
			scrollbar-width: none;
		}
		.actions::-webkit-scrollbar {
			display: none;
		}
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
	/* Same while an aid loads (tashkeel run, furigana conversion):
	the row summoned the work, so it stays until the work lands. */
	main.hover-user article.user.aid-loading .actions,
	main.hover-assistant article.assistant.aid-loading .actions {
		opacity: 1;
	}
	@media (hover: none) {
		main.hover-user article.user .actions,
		main.hover-assistant article.assistant .actions {
			opacity: 1;
		}
	}
	/* Hide-messages mode (touch option): bodies and baked quote blocks
	stay hidden until their message is tapped open; the open row shows
	text and buttons for 3s. Later than the hover rules so it wins ties;
	the open-row attr outranks them outright. */
	main.hide-messages article :global(.rendered),
	main.hide-messages article .ann-refs {
		display: none;
	}
	main.hide-messages article .actions {
		opacity: 0;
	}
	main.hide-messages article[data-actions-open="true"] :global(.rendered),
	main.hide-messages article[data-actions-open="true"] .ann-refs {
		display: block;
	}
	main.hide-messages article[data-actions-open="true"] .actions {
		opacity: 1;
	}
	/* Touch default: action rows hide until their message is tapped open
	(the open row shows for 3s). Bodies always show — only hideMessages
	hides those. Android-scoped, so desktop keeps its hover rhythm;
	later than the hover rules and outranking them, so it wins ties. */
	/* Phones sit the row tighter under the text. */
	.app[data-android] .actions {
		margin-top: 0.2rem;
	}
	/* Hide-buttons rows float: never in flow, so closed rows reserve
	no space and open rows push nothing — the row fades over the
	content below for its 3s instead. will-change keeps the fade
	shimmer-free, same as the hover rows. Invisible rows must not
	eat taps: reveals tap the article, not the row. The gap comes
	from the overlay's own offset, so toggling the bubble never
	moves the text. */
	.app[data-android] main.hide-buttons.overlay-actions article {
		position: relative;
	}
	.app[data-android] main.hide-buttons.overlay-actions article .actions {
		position: absolute;
		top: 100%;
		left: 0;
		right: auto;
		/* Snug pill, not full width: with nothing left of the buttons
		the bar collapses instead of holding a dead span. */
		width: fit-content;
		max-width: 100%;
		z-index: 5;
		margin-top: 0.15rem;
		padding: 0.2rem 0.3rem;
		background: #fff;
		background: var(--bg-raised);
		border: 1px solid #e5e5ea;
		border-color: var(--line-soft);
		border-radius: 12px;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
		opacity: 0;
		pointer-events: none;
		will-change: opacity;
		transition: opacity 0.18s ease;
	}
	/* Own rows pack right, so their pill anchors right too. */
	.app[data-android] main.hide-buttons.overlay-actions article.user .actions {
		left: auto;
		right: 0;
	}
	/* The idle speaking dot takes no slot in the overlay: it joins
	the pill only while actually speaking (in-flow rows keep their
	reserved slot, mirroring desktop). */
	.app[data-android] main.hide-buttons.overlay-actions article .actions .speaking-dot:not(.on) {
		display: none;
	}
	.app[data-android] main.hide-buttons.overlay-actions article[data-actions-open="true"] .actions {
		opacity: 1;
		pointer-events: auto;
		overflow-x: auto;
	}
	/* Last rows have no room below (scroll containers clip the
	overlay): the row flips above the message instead. */
	.app[data-android]
		main.hide-buttons.overlay-actions
		article[data-actions-open="true"][data-actions-above="true"]
		.actions {
		top: auto;
		bottom: 100%;
		margin-top: 0;
		margin-bottom: 0.15rem;
	}
	/* Overlay off: the row sits in flow and always reserves its line,
	like the desktop rows — hidden is opacity only, so revealing
	pushes nothing. No pill chrome of its own. will-change pre-creates
	the fade layer in both states (same shimmer fix as the hover rows):
	without it the icons re-rasterize mid-fade and visibly shiver. */
	.app[data-android] main.hide-buttons:not(.overlay-actions) article .actions {
		opacity: 0;
		pointer-events: none;
		will-change: opacity;
	}
	.app[data-android] main.hide-buttons:not(.overlay-actions) article[data-actions-open="true"] .actions {
		opacity: 1;
		pointer-events: auto;
	}
	/* No bubble, no bubble padding: text keeps its horizontal place
	(only the background disappears), and the tighter vertical rhythm
	drops the text closer to its buttons. */
	.app[data-android] main.plain-user article.user .bubble {
		padding: 0.25rem 1rem 0;
	}
	/* Message text never spills sideways off a phone: inner scrollers
	(code blocks, aid-label rows) keep their own axes. */
	.app[data-android] .messages {
		overflow-x: clip;
	}
	/* Chat-step slide: the incoming chat glides in from the swipe
	side (newer from the right, older from the left). Phone-only;
	reduced-motion keeps the instant switch. */
	@keyframes step-in-right {
		from {
			transform: translateX(2.5rem);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	@keyframes step-in-left {
		from {
			transform: translateX(-2.5rem);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	.app[data-android] .messages.step-newer {
		animation: step-in-right 0.18s ease-out;
	}
	.app[data-android] .messages.step-older {
		animation: step-in-left 0.18s ease-out;
	}
	@media (prefers-reduced-motion: reduce) {
		.app[data-android] .messages.step-newer,
		.app[data-android] .messages.step-older {
			animation: none;
		}
	}
	/* dir=auto puts Arabic paragraphs at the right edge; the chat
	reads left-aligned, so alignment follows the column while the
	base direction (selection, drag) stays with the text. */
	.app[data-android] :global(.rendered [dir="auto"]) {
		text-align: left;
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
		.wp-wrap.open .wp-menu {
			animation: none;
		}
		aside,
		.settings-panel {
			transition: none;
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
		color: var(--muted);
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0.15rem 0.5rem;
		flex-shrink: 0;
		white-space: nowrap;
	}
	.actions button:hover {
		color: #1c1c1e;
		color: var(--ink);
		text-decoration: none;
	}
	/* Opt-in (Settings): message buttons grow with the text-size
	setting instead of holding their fixed 0.75rem. */
	main.scale-actions .actions button {
		font-size: calc(0.75rem * var(--font-scale, 1));
	}
	/* Same opt-in for the logo icons: the glyph holds its fixed
	1.05rem height otherwise, so larger text leaves tiny icons. */
	main.scale-actions .actions .icon-btn :global(.action-glyph) {
		height: calc(1.05rem * var(--font-scale, 1));
	}
	/* Loading buttons hold their look while the dots pulse. */
	.actions button:disabled {
		cursor: default;
		opacity: 0.8;
	}
	/* A speak button with no voice for the language dims further: it is
	off, not busy (vocalizing aids keep the rule above). */
	.actions .icon-btn:disabled {
		opacity: 0.35;
	}
	.actions .icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 0;
		padding: 0.2rem;
		color: #6e6e73;
		color: var(--muted);
		text-decoration: none;
	}
	.actions .icon-btn:hover {
		color: #1c1c1e;
		color: var(--ink);
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
		/* Status reading text: tracks the text-size setting like messages. */
		font-size: calc(0.85rem * var(--font-scale, 1));
	}
	/* Loading dots exist only while busy, so an idle aid button is
	exactly its visible label — hover and spacing never cover text
	that isn't there. */
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
	.prompt.prompt-hidden {
		/* Annotating on Android: the comment box owns the keyboard,
		so the composer gets out of the way entirely (messages gain
		the room). Restores the moment the box closes. */
		display: none;
	}
	/* Idle-hide: with no input for the configured timeout the prompt
	slides down until hidden, giving the chat the full column. Any
	input restores it instantly (JS drops the class on the event,
	so the return trip runs the same ramp in reverse). Visibility
	flips at the end of the ramp so the slide reads, then the box
	stops taking pointer hits. */
	.prompt.prompt-idle {
		transform: translateY(calc(100% + 2rem));
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
	}
	.prompt {
		position: relative;
		margin: 0.6rem 1.2rem 1.1rem;
		/* First-line reservation for the absolute tools cluster
		(count badge + attach/shot/mic/voice): remeasured Sep 2026 —
		the Shot text button (~2.7rem) never fit the old 4.6rem base,
		so draft text slid under the cluster. Combos below only widen
		it; .wp-jump adds via --tools-extra so every combo composes. */
		--tools-pad: 6.8rem;
		--tools-extra: 0rem;
		border: 1px solid #c7c7cc;
		border-color: var(--line);
		border-radius: 12px;
		padding: 0 0.8rem 2.3rem;
		background: #fff;
		/* Raised, not flat: dark keeps the #1c1c1e card on the #17171a page. */
		background: var(--bg-raised);
		/* Fixed floor so mounting the editor never shifts layout.
		CodeMirror itself sets no minimum — this floor is ours, at
		about three text lines plus the tools row. */
		min-height: 6.4rem;
		box-sizing: border-box;
		/* Ease the outline both in and out of hover, plus the
		idle-hide slide (visibility flips delayed on hide so the
		ramp reads, instant on restore). */
		transition:
			border-color 0.18s ease,
			transform 0.35s ease,
			opacity 0.35s ease,
			visibility 0s linear 0.35s;
	}
	/* Restoring from idle drops the class on the input event itself:
	visibility must flip at once (no delay), while the slide and
	fade still ramp back in. */
	.prompt:not(.prompt-idle) {
		transition:
			border-color 0.18s ease,
			transform 0.35s ease,
			opacity 0.35s ease,
			visibility 0s;
	}
	/* Idle-hide covers the attachment strip too (pills, preview
	image, error): it rides the same slide/fade as the prompt so no
	image bubble lingers over the chat, and restores with it on the
	next input (the class drops together with prompt-idle). */
	.attachments,
	.preview,
	.attach-error {
		transition:
			transform 0.35s ease,
			opacity 0.35s ease,
			visibility 0s;
	}
	:is(.attachments, .preview, .attach-error).composer-idle {
		transform: translateY(calc(100% + 2rem));
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transition:
			transform 0.35s ease,
			opacity 0.35s ease,
			visibility 0s linear 0.35s;
	}
	/* No entrance animation on the composer: it used to glide down on the
	first message, exactly while the first tokens streamed in — on a slow
	phone GPU the overlap reads as flicker. The composer just stays put. */
	.send-btn {
		position: absolute;
		right: 0.6rem;
		bottom: 0.65rem;
		width: 1.7rem;
		height: 1.7rem;
		border-radius: 50%;
		border: 1px solid #1c1c1e;
		border-color: var(--invert);
		background: #1c1c1e;
		background: var(--invert);
		color: #fff;
		color: var(--invert-ink);
		font-size: 0.95rem;
		font-weight: 700;
		line-height: 1;
		cursor: pointer;
		/* The arrow glyph sits high and thin at normal weight: bold
		adds the missing stroke, top padding walks it down to center. */
		padding: 0.12rem 0 0;
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
	.paste-btn,
	.voice-float,
	.mic-btn,
	.wp-jump {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		line-height: 0;
		color: #6e6e73;
		border: 0;
		background: none;
		cursor: pointer;
		padding: 0.2rem;
		/* Pinned seat so the glyph em below resolves against the
		tools row, not whatever font lands on the button. */
		font-size: 1rem;
		transition: color 0.18s ease;
	}
	/* Tool glyphs ride the row's font size (em, not the component's
	fixed rem): paperclip, mic, voice, and jump icons scale with the
	composer instead of staying tiny at large text. */
	.prompt-tools :global(.action-glyph) {
		height: 1.05em;
	}
	.paste-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	/* Screenshot-to-chat: text treatment in the tools rhythm, muted
	until hover like the icon buttons around it. */
	.shot-btn {
		border: 0;
		background: none;
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: 600;
		color: #6e6e73;
		color: var(--muted);
		padding: 0.2rem 0.35rem;
		white-space: nowrap;
	}
	.shot-btn:hover {
		color: #1c1c1e;
		color: var(--ink);
	}
	.shot-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	/* iOS selection dock: the Annotate control lives in the composer
	tools while a highlight is up (a floating menu fights the native
	callout). Text treatment in the row's rhythm, action green so it
	reads as live, never chrome. */
	.ann-dock {
		border: 0;
		background: none;
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: 600;
		color: #1f7a4d;
		color: var(--ok);
		padding: 0.2rem 0.35rem;
		white-space: nowrap;
	}
	.attach-btn:hover,
	.paste-btn:hover,
	.voice-float:hover,
	.wp-jump:hover,
	.mic-btn:hover {
		color: #1c1c1e;
		color: var(--ink);
	}
	/* Split out of the shared tool rule below: attach/mic stay put
	in dark, only the voice toggle lifts. */
	.voice-float {
		color: #6e6e73;
		color: var(--muted);
	}
	.voice-float.on {
		color: #1f7a4d;
		color: var(--ok);
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
		/* Same stack as the chat text — the draft should look like the
		message it becomes, not a terminal. */
		font-family:
			-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
		padding-right: calc(var(--tools-pad) + var(--tools-extra));
		caret-color: #1c1c1e;
		caret-color: var(--ink);
	}
	/* The mic icon widens the tools cluster: hold the first line clear
	of it, but only while it is actually mounted. */
	.prompt.has-mic :global(.cm-content) {
		--tools-pad: 8.6rem;
	}
	/* Annotation count badge joins the tools cluster: hold the first
	line clear of the wider row while any annotations exist. */
	.prompt.has-anns :global(.cm-content) {
		--tools-pad: 9.5rem;
	}
	.prompt.has-mic.has-anns :global(.cm-content) {
		--tools-pad: 11.5rem;
	}
	/* Declarative mirrors of the has-mic/has-anns classes above: same
	seats, no JS. The classes stay as fallback. */
	.prompt:has(.mic-btn) :global(.cm-content) {
		--tools-pad: 8.6rem;
	}
	.prompt:has(.ann-wrap) :global(.cm-content) {
		--tools-pad: 9.5rem;
	}
	.prompt:has(.mic-btn):has(.ann-wrap) :global(.cm-content) {
		--tools-pad: 11.5rem;
	}
	/* Jump trigger joins the cluster in long threads: reserve its seat
	on top of whichever combo is live (var composition, not ×4 rules). */
	.prompt:has(.wp-jump) {
		--tools-extra: 1.8rem;
	}
	.prompt :global(.cm-editor) {
		/* Beats the CodeMirror theme's own font-size on specificity.
		Fixed size on purpose: the text-size setting scales reading
		(messages), never the input — typing at 400%+ shows a word or
		two per line. */
		font-size: 0.95rem;
		/* The prompt grows with typing, but never eats the messages:
		past this the editor scrolls internally. */
		max-height: 40vh;
	}
	/* Android textarea composer: fixed like the CodeMirror input above —
	the text-size setting scales reading, never typing. */
	.prompt :global(.ta-input) {
		font-family:
			-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
		font-size: 0.95rem;
		padding: 0.6rem calc(var(--tools-pad) + var(--tools-extra)) 0.6rem 0;
		caret-color: #1c1c1e;
		/* Mechanical twin of the cm rules: same pairs, Android-only node. */
		caret-color: var(--ink);
		width: 100%;
		box-sizing: border-box;
		border: 0;
		background: transparent;
		color: inherit;
		resize: none;
		/* Where supported the CSS owns the height (JS stands down —
		see autogrow in textarea-editor.ts) up to the same cap. */
		field-sizing: content;
		overflow-y: auto;
		max-height: 40vh;
		outline: none;
	}
	.prompt :global(.ta-input::placeholder) {
		color: #8e8e93;
		color: var(--line-hover);
	}
	.prompt.has-mic :global(.ta-input) {
		--tools-pad: 8.6rem;
	}
	.prompt.has-anns :global(.ta-input) {
		--tools-pad: 9.5rem;
	}
	.prompt.has-mic.has-anns :global(.ta-input) {
		--tools-pad: 11.5rem;
	}
	.prompt:has(.mic-btn) :global(.ta-input) {
		--tools-pad: 8.6rem;
	}
	.prompt:has(.ann-wrap) :global(.ta-input) {
		--tools-pad: 9.5rem;
	}
	.prompt:has(.mic-btn):has(.ann-wrap) :global(.ta-input) {
		--tools-pad: 11.5rem;
	}
	.prompt :global(.cm-placeholder) {
		color: #8e8e93;
		color: var(--line-hover);
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
	/* Dark theme, gated on the resolved scheme (<html data-theme>)
	instead of the OS query, so the settings switch can pin it. */
	/* Caret rides --ink, placeholders ride --line-hover. The ta-input
	twins are Android-only nodes with identical pairs. */
	/* The CM cursor node only mounts while focused, so its dark shade
	stays a pinned rule rather than an untestable token. */
	:global(html[data-theme="dark"]) :global(.cm-editor .cm-cursor) {
		border-left-color: #f2f2f7 !important;
	}
	/* !important throughout: the CodeMirror theme object injects its
	light rules after this stylesheet, so only importance wins. */
	:global(html[data-theme="dark"]) :global(.cm-paste-marker) {
		background: #2c2c2e !important;
		border-color: #48484a !important;
		color: #f2f2f7 !important;
	}
	:global(html[data-theme="dark"]) :global(.cm-fence-bar) {
		background: #2c2c2e !important;
		border-color: #48484a !important;
		color: #f2f2f7 !important;
	}
	:global(html[data-theme="dark"]) :global(.cm-fence-lang) {
		color: #98989f !important;
	}
	:global(html[data-theme="dark"]) :global(.cm-fence-end) {
		border-bottom-color: #48484a !important;
	}
	:global(html[data-theme="dark"]) :global(.cm-fence-collapsed) {
		color: #98989f !important;
	}
	:global(html[data-theme="dark"]) :global(.cm-fence-btn.copied) {
		color: #7bd3a6 !important;
	}
	/* Centered reading column on wide screens (DeepSeek-web rhythm).
	The cap rides --chat-width off .app (desktop slider, 36 = the default
	fixed width); the fallback keeps phones and older saves identical. */
	article,
	.empty-state,
	.sending {
		align-self: center;
		width: 100%;
		max-width: min(85%, calc(var(--chat-width, 36) * 1rem));
		box-sizing: border-box;
	}
	.prompt {
		/* Pinned to the default width: the composer never grows with the
		chat slider, but still shrinks on narrow columns. */
		width: calc(100% - 2.4rem);
		max-width: min(calc(var(--chat-width, 36) * 1rem), 36rem);
		margin-left: auto;
		margin-right: auto;
		box-sizing: border-box;
	}
	.lang-menus,
	.attachments,
	.review,
	.translate-panel,
	.error-banner {
		width: calc(100% - 2.4rem);
		max-width: calc(var(--chat-width, 36) * 1rem);
		margin-left: auto;
		margin-right: auto;
		box-sizing: border-box;
	}
	.prompt:focus-within {
		border-color: #3a3a3c;
		border-color: var(--focus);
	}
	.prompt:hover {
		border-color: #8e8e93;
		border-color: var(--line-hover);
	}
	.prompt:focus-within:hover {
		border-color: #3a3a3c;
		border-color: var(--focus);
	}

	/* Dark theme, gated on the resolved scheme (<html data-theme>)
	instead of the OS query, so the settings switch can pin it. */
	:global(html[data-theme="dark"]) {
		color-scheme: dark;
	}
	/* .app rides the --bg/--ink tokens now; no dark override needed. */
	/* aside rides the --bg/--line-soft tokens now; no dark override needed. */
	/* active is transparent in the base already; row/new/del ride
	--hover-wash/--focus/--alarm/--line/--dim now. */
	/* Sidebar text never rides on inheritance alone: old phone
	WebViews resolve button colors (ButtonText) against the wrong
	scheme, and the × had no dark color at all. */
	/* side-chat pins --ink (ButtonText trap); del rides --dim now. */
	/* header carries no border width, so its dark border-color was a
	no-op; .voice-float split out into --muted above (hover rides
	--ink with the other tool icons). */
	/* Selection tint rides --sel-tint now (pinned in the chrome paint test). */
	/* .voice-float.on rides --ok now. */
	/* .settings-panel rides the --bg/--line-soft tokens now; no dark override needed. */
	/* The overlay pill rides --bg-raised/--line-soft now; no dark override needed. */
	/* .modal rides the --bg/--ink/--line-soft tokens now; no dark override needed. */
	/* .modal-head button rides --line/--focus/--strong now. */
	/* The dark × hover lifts past every token to near-white: a lone
	declaration is cheaper than a single-use variable. */
	:global(html[data-theme="dark"]) .modal-head button:hover {
		color: #f2f2f7;
	}
	/* .keys ride --line-soft/--focus/--ink now. */
	:global(html[data-theme="dark"]) .app[data-android] .keys div:nth-child(2) {
		border-top-color: #38383a;
	}
	/* nav rides --line-soft; its buttons ride --bg-raised/--line/--ink now. */
	/* wp-menu rides --bg-raised/--line/--ink/--bg-wash now (sheet-head stays: touch-only). */
	:global(html[data-theme="dark"]) .wp-sheet-head {
		color: #98989f;
	}
	/* .bubble rides the --bg-wash token now; no dark override needed. */
	/* plain-user is background:none in the base already: nothing to override. */
	/* article.selected rides --focus now. */
	/* .actions buttons ride --muted/--ink now (icon-btn shares the hover). */
	/* The message being read aloud: green stop button, held on hover
	(the equal-specificity hover above would otherwise strip it). */
	:global(html[data-theme="dark"]) .actions .icon-btn.active,
	:global(html[data-theme="dark"]) .actions .icon-btn.active:hover {
		color: #7cc3a3;
	}
	/* tool-icon hovers ride --ink now. */
	:global(html[data-theme="dark"]) .error-banner {
		background: #3d1008;
		color: #ffb4a2;
	}
	/* sent-files/tok ride --muted; attachment pills ride --hl now.
	The pill × keeps its rule: light --focus against dark --ink. */
	:global(html[data-theme="dark"]) .attachments button {
		color: #f2f2f7;
	}
	/* .preview rides --line now. */
	/* ann-wrap rides --line/--muted/--ink; review-tools ride --muted/--danger now. */
	/* sel-menu rides --bg-raised/--line/--bg-wash/--ink;
	ann-pop is dark-always; review/translate-panel ride --panel/--line-soft. */
	/* .review-item.highlight rides --hl now. */
	/* review-head/label ride --muted/--ink; review textarea rides --field/--line/--strong. */
	/* Dark primary: light pill, dark text (mirrors the send
	button's inversion); Cancel stays quiet gray text. */
	/* edit-actions ride --invert/--invert-ink/--muted/--ink now. */
	/* .muted rides --muted now (sole use: the translating note). */
	/* .prompt rides --bg/--line/--line-hover/--focus now; no dark overrides needed. */
	/* Lang menus ride --ink/--strong/--line/--bg-raised/--bg-wash/--focus now. */
	/* .send-btn rides --invert/--invert-ink now. */
	/* Study-sheet print: the section stays out of layout on screen;
	the print dialog (File → Print Study Sheet…, Save as PDF there)
	shows only it — every other .app child hides. */
	#study-sheet-print {
		display: none;
	}
	@media print {
		.app > *:not(#study-sheet-print) {
			display: none !important;
		}
		#study-sheet-print {
			display: block !important;
			color: #000;
			background: #fff;
			padding: 24px;
		}
		#study-sheet-print h1 {
			font-size: 20px;
			margin: 0 0 4px;
		}
		#study-sheet-print .sheet-sub {
			color: #444;
			margin: 0 0 16px;
		}
		#study-sheet-print h2 {
			font-size: 15px;
			margin: 16px 0 4px;
		}
		#study-sheet-print p {
			white-space: pre-wrap;
			margin: 0 0 8px;
		}
	}
</style>
